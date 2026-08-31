/**
 * The read side of the mirror: what changed at the source since the sweep
 * that brought an item in.
 *
 * Pinboard and Micro.blog are the CMS. A Briefly item's commentary IS the
 * bookmark's extended text; a Journal item's body IS the post. Write-back
 * carries builder → source; this carries source → builder, with
 * `source_snapshot` — the copy taken at sweep time — as the merge base:
 *
 *   - source changed, local unedited → adopt the source's words
 *   - local changed, source unchanged → leave it; write-back owns it
 *   - both changed to the same text   → converged; just move the base
 *   - both changed differently        → `conflict`; the local copy is kept
 *   - source record deleted           → `gone`; the local copy is kept
 *
 * Nothing here deletes. A vanished or conflicted source is surfaced and the
 * removal stays an editorial act.
 */

import type { Item } from '../shared/types.ts';

/** The source's current values for the fields the mirror owns. */
export interface RemoteFields {
  title?: string;
  commentary?: string;
  body?: string;
  tags?: string[];
  /** Pinboard's `toread`/`shared` — owned by the bookmark, never by the issue. */
  flags?: Record<string, string>;
}

export type ReconcileOutcome = 'unchanged' | 'refreshed' | 'gone' | 'conflict';

type Mirrored = 'title' | 'commentary' | 'body' | 'tags';

const MIRRORED: Record<string, Mirrored[]> = {
  Pinboard: ['title', 'commentary', 'tags'],
  'Micro.blog': ['title', 'body'],
};

function norm(v: unknown): string {
  if (Array.isArray(v)) return v.join(' ').trim();
  return String(v ?? '').trim();
}

/**
 * Has the source moved since the sweep that took this item's snapshot?
 * Write-back asks this before replacing the record: a remote that no longer
 * matches the base means an edit happened there that no scan has seen, and
 * writing over it would lose it with no conflict ever surfacing — afterward
 * both sides match, so the reconcile has nothing left to catch.
 */
export function sourceMoved(item: Item, remote: RemoteFields): boolean {
  const fields = MIRRORED[item.source];
  if (!fields) return false;
  const snapshot = item.source_snapshot ?? {};
  return fields.some((f) => norm(remote[f]) !== norm(snapshot[f]));
}

/**
 * Merge one item against its source. Mutates the item (fields, snapshot,
 * `sync_state`, `sync_error`) and reports what happened. `remote: null` means
 * the source record no longer exists — callers must pass null only when the
 * source definitively answered, never on an API failure.
 */
export function reconcileItem(item: Item, remote: RemoteFields | null): ReconcileOutcome {
  const fields = MIRRORED[item.source];
  if (!fields) return 'unchanged';

  if (remote === null) {
    if (item.sync_state === 'gone') return 'unchanged';
    item.sync_state = 'gone';
    item.sync_error = `deleted at ${item.source}; your copy is kept`;
    return 'gone';
  }

  const snapshot = (item.source_snapshot ??= {});
  const conflicts: string[] = [];
  let refreshed = false;

  for (const f of fields) {
    const local = norm(item[f]);
    const base = norm(snapshot[f]);
    const theirs = norm(remote[f]);
    if (theirs === base) continue; // the source did not move
    if (local === base || local === theirs) {
      const value = f === 'tags' ? (remote.tags ?? []) : (remote[f] ?? '');
      if (local !== theirs) (item as unknown as Record<string, unknown>)[f] = value;
      snapshot[f] = value;
      refreshed = true;
    } else {
      conflicts.push(f);
    }
  }

  // The bookmark owns its flags. Refreshing them here is what keeps a later
  // write-back replaying what is true now, not what was true at sweep time.
  if (item.source === 'Pinboard' && remote.flags) item.source_flags = { ...remote.flags };

  if (conflicts.length) {
    item.sync_state = 'conflict';
    item.sync_error = `edited both here and at ${item.source} (${conflicts.join(', ')}); your copy is kept`;
    return 'conflict';
  }

  // Is a local edit still waiting to be written back?
  const pending = fields.some((f) => norm(item[f]) !== norm(snapshot[f]));

  if (item.sync_state === 'gone' || item.sync_state === 'conflict') {
    // The source record is back (or the sides converged); the mark comes off.
    item.sync_state = pending ? 'local' : 'synced';
    delete item.sync_error;
  }
  if (refreshed && !pending) {
    item.sync_state =
      item.source === 'Pinboard' && !norm(item.commentary) ? 'needs_commentary' : 'synced';
    delete item.sync_error;
  }
  return refreshed ? 'refreshed' : 'unchanged';
}
