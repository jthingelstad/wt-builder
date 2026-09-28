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

import type { Destination, IssueDoc, SendState, Verification } from '../shared/types.ts';
import { SCHEMA_VERSION } from '../shared/types.ts';
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
];

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

  const current = d.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const migrate = MIGRATIONS[v]!;
    d.transaction(() => {
        migrate(d);
        d.pragma(`user_version = ${v + 1}`);
      })();
    }

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

  /** Number, date, and status only — the seasonal lens needs no documents. */
  export function listIssueDates(): { number: number; publication_date: string; status: string }[] {
    return openDb()
      .prepare('SELECT number, publication_date, status FROM issues ORDER BY number DESC')
      .all() as { number: number; publication_date: string; status: string }[];
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
export function createIssueRow(doc: IssueDoc): IssueRow {
  const now = new Date().toISOString();
  try {
    openDb()
      .prepare(
        `INSERT INTO issues (id, number, publication_date, status, schema_version, doc, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        doc.issue.id, doc.issue.number, doc.issue.publication_date, doc.issue.status,
        doc.schema_version ?? SCHEMA_VERSION, JSON.stringify(doc), now, now,
      );
  } catch (err) {
    if (String((err as { code?: string }).code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      const holder = getIssue(doc.issue.id);
      throw new IssueExists(holder
        ? `${doc.issue.id} already exists (it is WT${holder.number} now) — pick another number`
        : `issue ${doc.issue.number} already exists`);
    }
    throw err;
  }
  return getIssue(doc.issue.id)!;
}

export function saveIssue(doc: IssueDoc): IssueRow {
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

/** Record one destination's send state without rewriting the whole document. */
export function recordSend(id: string, destination: Destination, state: SendState): IssueRow | null {
  const row = getIssue(id);
  if (!row) return null;
  row.doc.sends = { ...(row.doc.sends ?? {}), [destination]: state };

  // Published is derived, never clicked: the moment both reader-facing text
  // legs have gone out, the issue is out. Nothing sets it back — the archive
  // is authoritative after this, not the draft. Deriving it here is what
  // keeps `lastPublishedNumber()` and the website's prior-issues index true
  // after WT Builder's first real send.
  const sends = row.doc.sends;
  if (
    row.doc.issue.status === 'draft' &&
    sends.website?.status === 'sent' &&
    sends.buttondown?.status === 'sent'
  ) {
    row.doc.issue.status = 'published';
    logEvent(id, 'issue', `Published — WT${row.doc.issue.number}`);
  }

  openDb()
    .prepare(
      `UPDATE issues SET doc = ?, status = ?, ${SEND_COLUMN[destination]} = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      JSON.stringify(row.doc),
      row.doc.issue.status,
      JSON.stringify(state),
      new Date().toISOString(),
      id,
    );
  return getIssue(id);
}

/**
 * Record one leg's verification. Like recordSend, a targeted write that makes
 * no revision: verification describes the destination, not the issue's words.
 */
export function recordVerify(id: string, destination: Destination, v: Verification): IssueRow | null {
  const row = getIssue(id);
  if (!row) return null;
  row.doc.verify = { ...(row.doc.verify ?? {}), [destination]: v };
  openDb()
    .prepare('UPDATE issues SET doc = ? WHERE id = ?')
    .run(JSON.stringify(row.doc), id);
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

export interface IssueEvent {
  id: number;
  at: string;
  kind: string;
  summary: string;
  /** The item the event touched, when it touched one (since v4). */
  anchor?: string | null;
}

/** Append one event. The log narrates; it never decides anything. */
export function logEvent(issueId: string, kind: string, summary: string, anchor?: string): void {
  openDb()
    .prepare('INSERT INTO events (issue_id, at, kind, summary, anchor) VALUES (?, ?, ?, ?, ?)')
    .run(issueId, new Date().toISOString(), kind, summary, anchor ?? null);
}

/** Oldest first, every event — what the timing reads. */
export function allEvents(issueId: string): IssueEvent[] {
  return openDb()
    .prepare('SELECT id, at, kind, summary, anchor FROM events WHERE issue_id = ? ORDER BY id')
    .all(issueId) as IssueEvent[];
}

/** Newest first. */
export function listEvents(issueId: string, limit = 500): IssueEvent[] {
  return openDb()
    .prepare('SELECT id, at, kind, summary FROM events WHERE issue_id = ? ORDER BY id DESC LIMIT ?')
    .all(issueId, limit) as IssueEvent[];
}

export function closeDb(): void {
  db?.close();
  db = null;
}
