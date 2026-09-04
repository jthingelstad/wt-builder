/**
 * Storage.
 *
 * One JSON document per row with a few derived columns (AGENTS.md, Stack). The
 * issue is a tree; normalizing it into an item table would mean reassembling it
 * on every read. `schema_version` on the document carries migrations, and
 * `user_version` on the database carries table migrations.
 */

import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Destination, IssueDoc, SendState } from '../shared/types.ts';
import { SCHEMA_VERSION } from '../shared/types.ts';
import { config } from './config.ts';

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
];

export function openDb(path = config.dbPath): Database.Database {
  if (db) return db;
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

export function saveIssue(doc: IssueDoc): IssueRow {
  const now = new Date().toISOString();
  const sends = doc.sends ?? {};
  const serialize = (d: Destination) =>
    sends[d] ? JSON.stringify(sends[d]) : null;

  openDb()
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
      doc: JSON.stringify(doc),
      send_buttondown: serialize('buttondown'),
      send_website: serialize('website'),
      send_podcast: serialize('podcast'),
      send_archive: serialize('archive'),
      now,
    });

  return getIssue(doc.issue.id)!;
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

export function deleteIssue(id: string): void {
  openDb().prepare('DELETE FROM issues WHERE id = ?').run(id);
  openDb().prepare('DELETE FROM events WHERE issue_id = ?').run(id);
}

// ── the event log ─────────────────────────────────────────────────────────

export interface IssueEvent {
  id: number;
  at: string;
  kind: string;
  summary: string;
}

/** Append one event. The log narrates; it never decides anything. */
export function logEvent(issueId: string, kind: string, summary: string): void {
  openDb()
    .prepare('INSERT INTO events (issue_id, at, kind, summary) VALUES (?, ?, ?, ?)')
    .run(issueId, new Date().toISOString(), kind, summary);
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
