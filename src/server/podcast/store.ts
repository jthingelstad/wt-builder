/**
 * Storage for Another Thing episodes: the `episodes` table (migration v7),
 * one JSON document per row, like an issue.
 *
 * The same rules as the issue's store, kept separately so the two products
 * cannot meet: every save keeps the version it replaces (in
 * `episode_revisions`), and the events a save narrates are written in its
 * transaction and at its instant. The event log itself is shared
 * (db.ts, insertEvent).
 */

import type { EventInput } from '../../shared/events.ts';
import { EPISODE_SCHEMA_VERSION, type EpisodeDoc } from '../../shared/podcast/types.ts';
import { lastSent } from '../../shared/sends.ts';
import type { SendState, Verification } from '../../shared/types.ts';
import { config } from '../config.ts';
import { insertEvent, openDb, REVISIONS_KEPT } from '../db.ts';

export interface EpisodeRow {
  id: string;
  number: number;
  status: string;
  updated_at: string;
  doc: EpisodeDoc;
}

function rowToEpisode(row: Record<string, unknown>): EpisodeRow {
  return {
    id: row.id as string,
    number: row.number as number,
    status: row.status as string,
    updated_at: row.updated_at as string,
    doc: JSON.parse(row.doc as string) as EpisodeDoc,
  };
}

export function listEpisodes(): EpisodeRow[] {
  return (openDb().prepare('SELECT * FROM episodes ORDER BY number DESC').all() as Record<string, unknown>[])
    .map(rowToEpisode);
}

export function getEpisode(id: string): EpisodeRow | null {
  const row = openDb().prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToEpisode(row) : null;
}

export function getEpisodeByNumber(number: number): EpisodeRow | null {
  const row = openDb().prepare('SELECT * FROM episodes WHERE number = ?').get(number) as Record<string, unknown> | undefined;
  return row ? rowToEpisode(row) : null;
}

/**
 * The number a new episode defaults to: past every episode here and past
 * `WT_BUILDER_LAST_PUBLISHED_EPISODE`, the episodes published before WT
 * Builder sent one. Editable on the episode until it is sent.
 */
export function nextEpisodeNumber(): number {
  const row = openDb().prepare('SELECT MAX(number) AS n FROM episodes').get() as { n: number | null };
  return Math.max(row.n ?? 0, config.lastPublishedEpisode) + 1;
}

/** A new episode whose id or number another row already holds. */
export class EpisodeExists extends Error {}

/** Insert, and only insert: an id or number already taken throws EpisodeExists. */
export function createEpisodeRow(doc: EpisodeDoc, events: EventInput[] = []): EpisodeRow {
  const now = new Date().toISOString();
  const d = openDb();
  try {
    d.transaction(() => {
      d.prepare(
        `INSERT INTO episodes (id, number, status, schema_version, doc, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(doc.episode.id, doc.episode.number, doc.episode.status, doc.schema_version ?? EPISODE_SCHEMA_VERSION,
        JSON.stringify(doc), now, now);
      for (const e of events) insertEvent(doc.episode.id, now, e);
    })();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new EpisodeExists(`episode ${doc.episode.number} already exists — pick another number`);
    }
    throw err;
  }
  return getEpisode(doc.episode.id)!;
}

function keepRevision(id: string): void {
  const d = openDb();
  const prev = d.prepare('SELECT doc, updated_at FROM episodes WHERE id = ?').get(id) as
    | { doc: string; updated_at: string } | undefined;
  if (!prev) return;
  d.prepare('INSERT INTO episode_revisions (episode_id, saved_at, doc) VALUES (?, ?, ?)').run(id, prev.updated_at, prev.doc);
  d.prepare(
    `DELETE FROM episode_revisions WHERE episode_id = ? AND id NOT IN
       (SELECT id FROM episode_revisions WHERE episode_id = ? ORDER BY id DESC LIMIT ?)`,
  ).run(id, id, REVISIONS_KEPT);
}

/**
 * Save an existing episode: the version it replaces goes to the revisions
 * unless byte-identical, and its events land in the same transaction. The
 * id is `at<N>` for life; a renumbered draft keeps its id, and the number
 * column moves with it.
 */
export function saveEpisode(doc: EpisodeDoc, events: EventInput[] = []): EpisodeRow {
  const now = new Date().toISOString();
  const d = openDb();
  const serialized = JSON.stringify(doc);
  try {
    d.transaction(() => {
      const prev = d.prepare('SELECT doc FROM episodes WHERE id = ?').get(doc.episode.id) as { doc: string } | undefined;
      if (!prev) throw new Error(`no episode ${doc.episode.id}`);
      if (prev.doc !== serialized) keepRevision(doc.episode.id);
      d.prepare(
        `UPDATE episodes SET number = ?, status = ?, schema_version = ?, doc = ?, send_another = ?, updated_at = ?
         WHERE id = ?`,
      ).run(doc.episode.number, doc.episode.status, doc.schema_version ?? EPISODE_SCHEMA_VERSION, serialized,
        doc.sends?.another ? JSON.stringify(doc.sends.another) : null, now, doc.episode.id);
      for (const e of events) insertEvent(doc.episode.id, now, e);
    })();
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new EpisodeExists(`episode ${doc.episode.number} already exists — pick another number`);
    }
    throw err;
  }
  return getEpisode(doc.episode.id)!;
}

/**
 * Record the send's state without rewriting the episode's words, carrying
 * the last good send through `sending` and `failed` (db.ts recordSend's
 * rule). Published is derived, never clicked: the first send that lands
 * publishes the episode, and nothing sets it back.
 */
export function recordEpisodeSend(id: string, state: SendState): EpisodeRow | null {
  const row = getEpisode(id);
  if (!row) return null;
  const carried = state.status === 'sent' ? undefined : (state.last_sent ?? lastSent(row.doc.sends?.another));
  const { last_sent: _given, ...rest } = state;
  const next: SendState = carried ? { ...rest, last_sent: carried } : rest;
  row.doc.sends = { ...(row.doc.sends ?? {}), another: next };

  let published = false;
  if (row.doc.episode.status === 'draft' && lastSent(next)) {
    row.doc.episode.status = 'published';
    published = true;
  }

  const now = new Date().toISOString();
  const d = openDb();
  d.transaction(() => {
    d.prepare('UPDATE episodes SET doc = ?, status = ?, send_another = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(row.doc), row.doc.episode.status, JSON.stringify(next), now, id);
    if (published) {
      insertEvent(id, now, {
        kind: 'episode', actor: 'wt-builder',
        summary: `Published — Another Thing ${row.doc.episode.number}`, data: { action: 'published' },
      });
    }
  })();
  return getEpisode(id);
}

/** Record the send's verification: it describes the site, so no revision. */
export function recordEpisodeVerify(id: string, v: Verification, events: EventInput[] = []): EpisodeRow | null {
  const row = getEpisode(id);
  if (!row) return null;
  row.doc.verify = { ...(row.doc.verify ?? {}), another: v };
  const d = openDb();
  d.transaction(() => {
    d.prepare('UPDATE episodes SET doc = ? WHERE id = ?').run(JSON.stringify(row.doc), id);
    for (const e of events) insertEvent(id, v.at, e);
  })();
  return getEpisode(id);
}

/**
 * Drop an episode and its events. The document as it stood joins its
 * revisions first, the only way back. Which episodes may go is the route's
 * call (never a sent one).
 */
export function deleteEpisode(id: string): void {
  const d = openDb();
  d.transaction(() => {
    keepRevision(id);
    d.prepare('DELETE FROM episodes WHERE id = ?').run(id);
    d.prepare('DELETE FROM events WHERE issue_id = ?').run(id);
  })();
}
