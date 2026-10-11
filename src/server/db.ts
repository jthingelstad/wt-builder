/**
 * Storage.
 *
 * One JSON document per row with a few derived columns (AGENTS.md, Stack). The
 * issue is a tree; normalizing it into an item table would mean reassembling it
 * on every read. `schema_version` on the document carries migrations, and
 * `user_version` on the database carries table migrations.
 */

import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import type { Destination, IssueDoc, SendState, Share, ShareDestination, Verification } from '../shared/types.ts';
import { SCHEMA_VERSION } from '../shared/types.ts';
import { actorOf, type EventInput, type IssueEvent } from '../shared/events.ts';
import { lastSent } from '../shared/sends.ts';
import { config, LIVE_DB_PATH, OFFLINE } from './config.ts';

export interface IssueRow {
  id: string;
  number: number;
  publication_date: string;
  status: string;
  updated_at: string;
  doc: IssueDoc;
}

let db: Database.Database | null = null;

function makeDatabaseFilesPrivate(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${path}${suffix}`;
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}

const MIGRATIONS: ((d: Database.Database) => void)[] = [
  // v1 — issues, stored as documents with derived columns for listing.
  (d) => {
    d.exec(`
      CREATE TABLE issues (
        id               TEXT PRIMARY KEY,
        number           INTEGER NOT NULL,
        publication_date TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'draft',
        schema_version   INTEGER NOT NULL,
        doc              TEXT NOT NULL,
        send_buttondown  TEXT,
        send_website     TEXT,
        send_podcast     TEXT,
        send_archive     TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE UNIQUE INDEX issues_number ON issues(number);
      CREATE INDEX issues_status ON issues(status, publication_date DESC);
    `);
  },
  // v2 — the per-issue event log. Its own table, not the document: events are
  // append-only and unbounded, and the document rewrites wholesale on every
  // save.
  (d) => {
    d.exec(`
      CREATE TABLE events (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id TEXT NOT NULL,
        at       TEXT NOT NULL,
        kind     TEXT NOT NULL,
        summary  TEXT NOT NULL
      );
      CREATE INDEX events_issue ON events(issue_id, id DESC);
    `);
  },
  // v3 — revisions. Every save of an existing issue first copies the document
  // it is replacing, so nothing Jamie typed is ever more than one row away.
  // Trimmed to the last REVISIONS_KEPT per issue; a document is ~100 KB, so
  // this is tens of MB per issue at most. Added after two Currently lines
  // were written over by a slow re-scan and there was nothing to roll back to
  // (2026-09-20).
  (d) => {
    d.exec(`
      CREATE TABLE revisions (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id  TEXT NOT NULL,
        saved_at  TEXT NOT NULL,
        doc       TEXT NOT NULL
      );
      CREATE INDEX revisions_issue ON revisions(issue_id, id DESC);
    `);
  },
  // v4 — an event can name the item it touched, so time can be attributed to
  // the part of the issue it was spent on (issue timing, 2026-09-26). Older
  // events have no anchor; the timing matches them by the name in the summary.
  (d) => {
    d.exec('ALTER TABLE events ADD COLUMN anchor TEXT');
  },
  // v5 — shares (docs/share-plan.md). Their own table, not the document: put
  // to bed freezes the document, and sharing is what happens after it, this
  // week or a year later.
  (d) => {
    d.exec(`
      CREATE TABLE shares (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id    TEXT NOT NULL,
        destination TEXT NOT NULL,
        state       TEXT NOT NULL DEFAULT 'draft',
        title       TEXT,
        text        TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        shared_at   TEXT,
        url         TEXT
      );
      CREATE INDEX shares_issue ON shares(issue_id, id DESC);
    `);
  },
  // v6 — the event log becomes the record (docs/event-log.md, 2026-10-11).
  // Every event says who made it happen (`actor`) and carries its facts as
  // JSON (`data`), so the timing, an item's history and the MCP read those
  // instead of parsing sentences. The kinds that held two things are split:
  // `sync` was both a write-back's outcome (now `write`, the service's) and
  // Jamie's decisions about a source (now `source`); `draft` was a wand that
  // failed (now `wand`, which logs the ones that come back too); a draft
  // share was logged as a `send`. Old events get the actor today's rules
  // give them; nothing else about them changes.
  (d) => {
    d.exec(`
      ALTER TABLE events ADD COLUMN actor TEXT;
      ALTER TABLE events ADD COLUMN data TEXT;
      CREATE INDEX events_anchor ON events(issue_id, anchor, id DESC);

      UPDATE events SET kind = 'write'
        WHERE kind = 'sync' AND (summary LIKE 'Write to %' OR summary LIKE 'Finished after restart%');
      UPDATE events SET kind = 'gone' WHERE kind = 'sync' AND summary LIKE 'Deleted at %';
      UPDATE events SET kind = 'source' WHERE kind = 'sync';
      UPDATE events SET kind = 'wand', data = '{"outcome":"failed"}' WHERE kind = 'draft';
      UPDATE events SET kind = 'share' WHERE kind = 'send' AND summary LIKE 'Draft share%';

      UPDATE events SET actor = CASE
        WHEN kind IN ('edit', 'structure', 'channels', 'settings', 'source', 'review', 'wand', 'share') THEN 'jamie'
        WHEN kind IN ('swept-in', 'refreshed', 'conflict', 'gone', 'held-out', 'put-back', 'moved') THEN 'source'
        WHEN kind = 'dropped' AND summary LIKE '%— deleted at %' THEN 'source'
        WHEN kind = 'issue' AND summary LIKE 'Published%' THEN 'wt-builder'
        WHEN kind = 'issue' THEN 'jamie'
        WHEN kind = 'send' AND (summary LIKE 'Send finished%' OR summary LIKE 'Send failed%') THEN 'wt-builder'
        WHEN kind = 'send' THEN 'jamie'
        WHEN kind = 'links' AND (summary LIKE 'Kept as it is%' OR summary LIKE 'Asking again%'
          OR summary LIKE 'Using %' OR summary LIKE 'Back to the bookmark%') THEN 'jamie'
        ELSE 'wt-builder'
      END;
    `);
  },
  // v7 — Another Thing, the podcast, as a second product (docs/decisions.md,
  // 2026-10-11). Episodes are their own documents in their own table, never
  // issues: nothing that lists, numbers, sweeps or sends an issue can meet
  // one. Their revisions are their own table too, so `npm run revisions
  // --restore` can never put an episode's document into `issues`. The event
  // log is shared: an episode's events carry its `at<N>`, as an issue's
  // carry `wt<N>`, and the Log sheet, the timing and the watcher read them
  // the same way.
  (d) => {
    d.exec(`
      CREATE TABLE episodes (
        id             TEXT PRIMARY KEY,
        number         INTEGER NOT NULL,
        status         TEXT NOT NULL DEFAULT 'draft',
        schema_version INTEGER NOT NULL,
        doc            TEXT NOT NULL,
        send_another   TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE UNIQUE INDEX episodes_number ON episodes(number);
      CREATE TABLE episode_revisions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id TEXT NOT NULL,
        saved_at   TEXT NOT NULL,
        doc        TEXT NOT NULL
      );
      CREATE INDEX episode_revisions_episode ON episode_revisions(episode_id, id DESC);
    `);
  },
];

/**
 * Bring a database up to `to` (every migration, by default), one transaction
 * per version. Exported so a test can stop at an old version, write rows the
 * way that version did, and watch the next migration carry them.
 */
export function migrate(d: Database.Database, to = MIGRATIONS.length): void {
  const current = d.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < to; v++) {
    const step = MIGRATIONS[v]!;
    d.transaction(() => {
      step(d);
      d.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export const REVISIONS_KEPT = 300;

/** Where a path really lands: symlinks in its directory resolved, if it exists. */
function landsAt(path: string): string {
  const abs = resolve(path);
  try {
    return join(realpathSync(dirname(abs)), basename(abs));
  } catch {
    return abs;
  }
}

/**
 * Offline is the tests' mode (config.ts). A test that forgot WT_BUILDER_DB
 * would otherwise open the live database: run boot migrations on it, and on a
 * server start, finishStrandedWrites. So offline refuses the live path and
 * says what to set instead (review 2026-09-27, §1.7).
 */
export function refuseLiveDbOffline(path: string): void {
  if (!OFFLINE) return;
  if (landsAt(path) !== landsAt(LIVE_DB_PATH)) return;
  throw new Error(
    `offline (WT_BUILDER_OFFLINE=1) refuses the live database ${LIVE_DB_PATH}; ` +
      'set WT_BUILDER_DB to a throwaway path',
  );
}

export function openDb(path = config.dbPath): Database.Database {
  if (db) return db;
  refuseLiveDbOffline(path);
  // Issue drafts and SQLite sidecars stay owner-only, including files SQLite
  // creates later in this process after the initial connection is open.
  process.umask(0o077);
  mkdirSync(dirname(path), { recursive: true });
  const d = new Database(path);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');

  migrate(d);

    makeDatabaseFilesPrivate(path);
    db = d;
    return d;
  }

  const SEND_COLUMN: Record<Destination, string> = {
    buttondown: 'send_buttondown',
    website: 'send_website',
    podcast: 'send_podcast',
    archive: 'send_archive',
  };

  function rowToIssue(row: Record<string, unknown>): IssueRow {
    return {
      id: row.id as string,
      number: row.number as number,
      publication_date: row.publication_date as string,
      status: row.status as string,
      updated_at: row.updated_at as string,
      doc: JSON.parse(row.doc as string) as IssueDoc,
    };
  }

  export function listIssues(): IssueRow[] {
    const rows = openDb()
      .prepare('SELECT * FROM issues ORDER BY number DESC')
      .all() as Record<string, unknown>[];
    return rows.map(rowToIssue);
  }

  /** Number, date, and status only — the new-issue date checks need no documents. */
  export function listIssueDates(): { number: number; publication_date: string; status: string }[] {
    return openDb()
      .prepare('SELECT number, publication_date, status FROM issues ORDER BY number DESC')
      .all() as { number: number; publication_date: string; status: string }[];
  }

  /** Id, number, date, and status, no documents: naming an issue (the MCP interface) costs one query. */
  export function listIssueHeads(): { id: string; number: number; publication_date: string; status: string }[] {
    return openDb()
      .prepare('SELECT id, number, publication_date, status FROM issues ORDER BY number DESC')
      .all() as { id: string; number: number; publication_date: string; status: string }[];
  }

  export function getIssue(id: string): IssueRow | null {
    const row = openDb().prepare('SELECT * FROM issues WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToIssue(row) : null;
  }

  export function getIssueByNumber(number: number): IssueRow | null {
    const row = openDb().prepare('SELECT * FROM issues WHERE number = ?').get(number) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToIssue(row) : null;
  }

  /**
   * The highest published issue number, which the next issue defaults past.
   *
   * Nine years of issues were published before WT Builder existed and are not
   * imported (docs/decisions.md), so an empty database would otherwise number the next issue
   * 1. `WT_BUILDER_LAST_PUBLISHED_ISSUE` carries that history as a floor; the
   * number stays editable either way.
   */
  export function lastPublishedNumber(): number {
    const row = openDb()
      .prepare("SELECT MAX(number) AS n FROM issues WHERE status = 'published'")
      .get() as { n: number | null };
    return Math.max(row.n ?? 0, config.lastPublishedIssue);
  }

/** A new issue whose id or number another row already holds. */
export class IssueExists extends Error {}

/**
 * Insert a new issue, and only insert. `saveIssue` is an upsert, and the id
 * is `wt<number>` for life while the number can be changed in Settings — so
 * creating 353 after 353 was renumbered 352 replaced WT352's row, send
 * record and all, with a blank draft (review 2026-09-27, §1.1). Here an id
 * or number already taken throws IssueExists and nothing is written.
 */
export function createIssueRow(doc: IssueDoc, events: EventInput[] = []): IssueRow {
  const now = new Date().toISOString();
  try {
    openDb().transaction(() => {
      openDb()
        .prepare(
          `INSERT INTO issues (id, number, publication_date, status, schema_version, doc, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          doc.issue.id, doc.issue.number, doc.issue.publication_date, doc.issue.status,
          doc.schema_version ?? SCHEMA_VERSION, JSON.stringify(doc), now, now,
        );
      for (const e of events) insertEvent(doc.issue.id, now, e);
    })();
  } catch (err) {
    // Only a taken id (the primary key) or number (its unique index) is
    // "already exists"; a NOT NULL or CHECK failure is a fault, not a clash.
    const code = (err as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const holder = getIssue(doc.issue.id);
      throw new IssueExists(holder
        ? `${doc.issue.id} already exists (it is WT${holder.number} now) — pick another number`
        : `issue ${doc.issue.number} already exists`);
    }
    throw err;
  }
  return getIssue(doc.issue.id)!;
}

export function saveIssue(doc: IssueDoc, events: EventInput[] = []): IssueRow {
  const now = new Date().toISOString();
  const sends = doc.sends ?? {};
  const serialize = (d: Destination) =>
    sends[d] ? JSON.stringify(sends[d]) : null;
  const d = openDb();

  d.transaction(() => {
    // Keep what is being replaced, unless it is byte-identical.
    const prev = d.prepare('SELECT doc, updated_at FROM issues WHERE id = ?').get(doc.issue.id) as
      | { doc: string; updated_at: string } | undefined;
    const serialized = JSON.stringify(doc);
    if (prev && prev.doc !== serialized) {
      d.prepare('INSERT INTO revisions (issue_id, saved_at, doc) VALUES (?, ?, ?)')
        .run(doc.issue.id, prev.updated_at, prev.doc);
      d.prepare(
        `DELETE FROM revisions WHERE issue_id = ? AND id NOT IN
           (SELECT id FROM revisions WHERE issue_id = ? ORDER BY id DESC LIMIT ?)`,
      ).run(doc.issue.id, doc.issue.id, REVISIONS_KEPT);
    }

    d
      .prepare(
        `INSERT INTO issues (id, number, publication_date, status, schema_version, doc,
                             send_buttondown, send_website, send_podcast, send_archive,
                             created_at, updated_at)
         VALUES (@id, @number, @publication_date, @status, @schema_version, @doc,
                 @send_buttondown, @send_website, @send_podcast, @send_archive,
                 @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           number = excluded.number,
           publication_date = excluded.publication_date,
           status = excluded.status,
           schema_version = excluded.schema_version,
           doc = excluded.doc,
           send_buttondown = excluded.send_buttondown,
           send_website = excluded.send_website,
           send_podcast = excluded.send_podcast,
           send_archive = excluded.send_archive,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: doc.issue.id,
        number: doc.issue.number,
        publication_date: doc.issue.publication_date,
        status: doc.issue.status,
        schema_version: doc.schema_version ?? SCHEMA_VERSION,
        doc: serialized,
        send_buttondown: serialize('buttondown'),
        send_website: serialize('website'),
        send_podcast: serialize('podcast'),
        send_archive: serialize('archive'),
        now,
      });
    // The events this save narrates, in its transaction and at its instant:
    // an event is never logged for a save that did not happen, and
    // versionBefore(event.at) is the issue just before the save it narrates.
    for (const e of events) insertEvent(doc.issue.id, now, e);
  })();

  return getIssue(doc.issue.id)!;
}

export interface Revision {
  id: number;
  saved_at: string;
  doc: IssueDoc;
}

/** Newest first. `saved_at` is when that version was written, not replaced. */
export function listRevisions(issueId: string, limit = REVISIONS_KEPT): Revision[] {
  return (openDb()
    .prepare('SELECT id, saved_at, doc FROM revisions WHERE issue_id = ? ORDER BY id DESC LIMIT ?')
    .all(issueId, limit) as { id: number; saved_at: string; doc: string }[])
    .map((r) => ({ id: r.id, saved_at: r.saved_at, doc: JSON.parse(r.doc) as IssueDoc }));
}

/**
 * Record one destination's send state without rewriting the whole document.
 *
 * A leg's last success rides along through `sending` and `failed` as
 * `last_sent`, taken from the state as it stands now (this function reads
 * fresh and writes without yielding, like savedFresh): a failed podcast
 * re-render once erased the episode's audio record, and a `sending`
 * Buttondown leg lost its draft id (review 2026-09-27 §2.1). One place,
 * so all four legs keep it. A `sent` state is its own last good send.
 */
export function recordSend(id: string, destination: Destination, state: SendState): IssueRow | null {
  const row = getIssue(id);
  if (!row) return null;
  const carried = state.status === 'sent' ? undefined : (state.last_sent ?? lastSent(row.doc.sends?.[destination]));
  const { last_sent: _given, ...rest } = state;
  state = carried ? { ...rest, last_sent: carried } : rest;
  row.doc.sends = { ...(row.doc.sends ?? {}), [destination]: state };

  // Published is derived, never clicked: the moment both reader-facing text
  // legs have gone out, the issue is out. Nothing sets it back — the archive
  // is authoritative after this, not the draft. Deriving it here is what
  // keeps `lastPublishedNumber()` and the website's prior-issues index true
  // after WT Builder's first real send. A leg has gone out once it has ever
  // sent (`lastSent`): a failed re-send of the Buttondown draft still leaves
  // the draft, and reading `status` kept such an issue a draft for good.
  const sends = row.doc.sends;
  let published = false;
  if (
    row.doc.issue.status === 'draft' &&
    lastSent(sends.website) &&
    lastSent(sends.buttondown)
  ) {
    row.doc.issue.status = 'published';
    published = true;
  }

  const now = new Date().toISOString();
  openDb().transaction(() => {
    openDb()
      .prepare(
        `UPDATE issues SET doc = ?, status = ?, ${SEND_COLUMN[destination]} = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(row.doc), row.doc.issue.status, JSON.stringify(state), now, id);
    if (published) insertEvent(id, now, { kind: 'issue', actor: 'wt-builder', summary: `Published — WT${row.doc.issue.number}`, data: { action: 'published' } });
  })();
  return getIssue(id);
}

/**
 * Record one leg's verification. Like recordSend, a targeted write that makes
 * no revision: verification describes the destination, not the issue's words.
 */
export function recordVerify(id: string, destination: Destination, v: Verification, events: EventInput[] = []): IssueRow | null {
  const row = getIssue(id);
  if (!row) return null;
  row.doc.verify = { ...(row.doc.verify ?? {}), [destination]: v };
  openDb().transaction(() => {
    openDb()
      .prepare('UPDATE issues SET doc = ? WHERE id = ?')
      .run(JSON.stringify(row.doc), id);
    for (const e of events) insertEvent(id, v.at, e);
  })();
  return getIssue(id);
}

/**
 * Drop an issue and its event log. Its revisions stay, and the document as it
 * stood is added to them first: they are the only way back from a delete
 * (`npm run revisions -- <id> --restore` recreates the row from the newest).
 * Which issues may be deleted is the route's call.
 */
export function deleteIssue(id: string): void {
  const d = openDb();
  d.transaction(() => {
    const last = d.prepare('SELECT doc, updated_at FROM issues WHERE id = ?').get(id) as
      | { doc: string; updated_at: string } | undefined;
    if (last) {
      d.prepare('INSERT INTO revisions (issue_id, saved_at, doc) VALUES (?, ?, ?)')
        .run(id, last.updated_at, last.doc);
      d.prepare(
        `DELETE FROM revisions WHERE issue_id = ? AND id NOT IN
           (SELECT id FROM revisions WHERE issue_id = ? ORDER BY id DESC LIMIT ?)`,
      ).run(id, id, REVISIONS_KEPT);
    }
    d.prepare('DELETE FROM issues WHERE id = ?').run(id);
    d.prepare('DELETE FROM events WHERE issue_id = ?').run(id);
  })();
}

// ── the event log ─────────────────────────────────────────────────────────

export type { IssueEvent } from '../shared/events.ts';

const EVENT_COLUMNS = 'id, at, kind, actor, summary, anchor, data';

function rowToEvent(row: Record<string, unknown>): IssueEvent {
  return {
    id: row.id as number,
    at: row.at as string,
    kind: row.kind as IssueEvent['kind'],
    actor: (row.actor ?? 'wt-builder') as IssueEvent['actor'],
    summary: row.summary as string,
    anchor: (row.anchor as string | null) ?? null,
    data: row.data ? JSON.parse(row.data as string) as Record<string, unknown> : null,
  };
}

/**
 * Append one event at a given instant. Exported for the podcast's store,
 * which writes an episode's events in its own save's transaction, the way
 * saveIssue does; everything else logs through `record` or a save.
 */
export function insertEvent(issueId: string, at: string, e: EventInput): number {
  const info = openDb()
    .prepare('INSERT INTO events (issue_id, at, kind, actor, summary, anchor, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(issueId, at, e.kind, actorOf(e), e.summary, e.anchor ?? null, e.data ? JSON.stringify(e.data) : null);
  return Number(info.lastInsertRowid);
}

/**
 * Append one event that narrates no save of the issue: a send starting, a
 * wand's draft, a verification. One that narrates a save goes to saveIssue
 * with it. The log narrates; it never decides anything. Returns its id, for
 * the service log line that carries the detail.
 */
export function record(issueId: string, e: EventInput): number {
  return insertEvent(issueId, new Date().toISOString(), e);
}

/** Oldest first, every event — what the timing reads. */
export function allEvents(issueId: string): IssueEvent[] {
  return (openDb()
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE issue_id = ? ORDER BY id`)
    .all(issueId) as Record<string, unknown>[]).map(rowToEvent);
}

/** Newest first. */
export function listEvents(issueId: string, limit = 500): IssueEvent[] {
  return (openDb()
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE issue_id = ? ORDER BY id DESC LIMIT ?`)
    .all(issueId, limit) as Record<string, unknown>[]).map(rowToEvent);
}

/** One item's (or section's) history, newest first. */
export function itemEvents(issueId: string, anchor: string, limit = 100): IssueEvent[] {
  return (openDb()
    .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE issue_id = ? AND anchor = ? ORDER BY id DESC LIMIT ?`)
    .all(issueId, anchor, limit) as Record<string, unknown>[]).map(rowToEvent);
}

/** When the first event after `id` happened, or null when none has yet. */
export function eventAfter(issueId: string, id: number): string | null {
  const row = openDb()
    .prepare('SELECT at FROM events WHERE issue_id = ? AND id > ? ORDER BY id LIMIT 1')
    .get(issueId, id) as { at: string } | undefined;
  return row?.at ?? null;
}

/**
 * The issue as it stood just before `before`: the newest version, kept or
 * live, written earlier than that instant. An event is logged before the save
 * it narrates, so "just before the next event" is the issue as the events up
 * to a cursor left it. Null when every version kept is newer (the revisions
 * are capped at REVISIONS_KEPT).
 */
export function versionBefore(issueId: string, before: string): { saved_at: string; doc: IssueDoc } | null {
  const d = openDb();
  const live = d.prepare('SELECT updated_at, doc FROM issues WHERE id = ?').get(issueId) as
    | { updated_at: string; doc: string } | undefined;
  if (live && live.updated_at < before) return { saved_at: live.updated_at, doc: JSON.parse(live.doc) as IssueDoc };
  const kept = d
    .prepare('SELECT saved_at, doc FROM revisions WHERE issue_id = ? AND saved_at < ? ORDER BY saved_at DESC, id DESC LIMIT 1')
    .get(issueId, before) as { saved_at: string; doc: string } | undefined;
  return kept ? { saved_at: kept.saved_at, doc: JSON.parse(kept.doc) as IssueDoc } : null;
}

/**
 * The first version that carried the review made at `reviewAt`: the words the
 * review read, give or take an edit made while it ran. The live document when
 * nothing has been saved since. Looks at a bounded number of versions.
 */
export function versionWithReview(issueId: string, reviewAt: string): { saved_at: string; doc: IssueDoc } | null {
  const d = openDb();
  const rows = d
    .prepare('SELECT saved_at, doc FROM revisions WHERE issue_id = ? AND saved_at >= ? ORDER BY saved_at, id LIMIT 20')
    .all(issueId, reviewAt) as { saved_at: string; doc: string }[];
  for (const r of rows) {
    const doc = JSON.parse(r.doc) as IssueDoc;
    if ((doc.review as { at?: string } | undefined)?.at === reviewAt) return { saved_at: r.saved_at, doc };
  }
  const live = d.prepare('SELECT updated_at, doc FROM issues WHERE id = ?').get(issueId) as
    | { updated_at: string; doc: string } | undefined;
  const doc = live ? (JSON.parse(live.doc) as IssueDoc) : undefined;
  return doc && (doc.review as { at?: string } | undefined)?.at === reviewAt ? { saved_at: live!.updated_at, doc } : null;
}

// ── shares ────────────────────────────────────────────────────────────────

function rowToShare(row: Record<string, unknown>): Share {
  const share: Share = {
    id: row.id as number,
    issue_id: row.issue_id as string,
    destination: row.destination as ShareDestination,
    state: row.state as Share['state'],
    text: row.text as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
  if (row.title) share.title = row.title as string;
  if (row.shared_at) share.shared_at = row.shared_at as string;
  if (row.url) share.url = row.url as string;
  return share;
}

/** One issue's shares, or every share when `issueId` is left out. Newest first. */
export function listShares(issueId?: string): Share[] {
  const rows = issueId
    ? openDb().prepare('SELECT * FROM shares WHERE issue_id = ? ORDER BY id DESC').all(issueId)
    : openDb().prepare('SELECT * FROM shares ORDER BY id DESC').all();
  return (rows as Record<string, unknown>[]).map(rowToShare);
}

export function getShare(id: number): Share | null {
  const row = openDb().prepare('SELECT * FROM shares WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToShare(row) : null;
}

export function createShare(issueId: string, destination: ShareDestination, text: string, title?: string): Share {
  const now = new Date().toISOString();
  const { lastInsertRowid } = openDb()
    .prepare('INSERT INTO shares (issue_id, destination, title, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(issueId, destination, title ?? null, text, now, now);
  return getShare(Number(lastInsertRowid))!;
}

/** Change a share's words, or record that it went. Only the fields given change. */
export function updateShare(
  id: number,
  patch: Partial<Pick<Share, 'title' | 'text' | 'state' | 'shared_at' | 'url'>>,
): Share | null {
  const current = getShare(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  openDb()
    .prepare('UPDATE shares SET title = ?, text = ?, state = ?, shared_at = ?, url = ?, updated_at = ? WHERE id = ?')
    .run(next.title || null, next.text, next.state, next.shared_at ?? null, next.url ?? null, new Date().toISOString(), id);
  return getShare(id);
}

export function deleteShare(id: number): void {
  openDb().prepare('DELETE FROM shares WHERE id = ?').run(id);
}

/**
 * Every blog post a share made. The Micro.blog sweep skips them: a post
 * announcing last week's issue lands inside this week's window, and must
 * never be offered to Journal (docs/share-plan.md).
 */
export function sharedBlogUrls(): string[] {
  return (openDb()
    .prepare("SELECT url FROM shares WHERE destination = 'blog' AND url IS NOT NULL")
    .all() as { url: string }[]).map((r) => r.url);
}

export function closeDb(): void {
  db?.close();
  db = null;
}
