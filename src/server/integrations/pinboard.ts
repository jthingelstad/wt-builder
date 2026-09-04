/**
 * Pinboard.
 *
 * Read: the unread queue inside the issue window becomes link candidates.
 * Write: last-writer-wins on title, commentary, and supported tags. A failed
 * write never discards the local edit (docs/item-model.md, Synchronization).
 */

import type { Candidate, Item, SyncState } from '../../shared/types.ts';
import { allChannels } from '../../shared/types.ts';
import type { Window } from '../../shared/dates.ts';
import { inWindow } from '../../shared/dates.ts';
import { config, credentials } from '../config.ts';
import { sourceMoved, type RemoteFields } from '../reconcile.ts';

const API = 'https://api.pinboard.in/v1';

/**
 * How a bookmark gets into the issue.
 *
 * Studio's proven rule, which this matches: Jamie saves during the week and
 * marks promising items "to read"; the sweep drains that unread queue. It is
 * NOT a tag — the `weekly-thing` tag is not in use on the account, and
 * filtering on it sweeps nothing. An optional tag narrows the queue further.
 */
export const SWEEP_UNREAD_ONLY = true;

/**
 * Jamie's Pinboard convention for a Briefly link, from the Shortcuts era.
 * Moving a link between Notable and Briefly in the builder adds or removes
 * it, and the write-back carries it to the bookmark.
 */
export const BRIEF_TAG = '__brief';

/** Tags that route a link to a section. Placement in the issue still wins. */
const SECTION_TAGS: Record<string, string> = {
  notable: 'Notable',
  briefly: 'Briefly',
  featured: 'Featured',
  [BRIEF_TAG]: 'Briefly',
};

export interface PinboardPost {
  href: string;
  description: string;
  extended: string;
  tags: string;
  time: string;
  hash?: string;
  /** "yes" / "no". Owned by the bookmark, never by the issue. */
  toread?: string;
  shared?: string;
}

function requireToken(): string {
  const token = credentials.pinboardToken;
  if (!token) throw new Error('PINBOARD_API_TOKEN is not configured');
  return token;
}

async function call(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('auth_token', requireToken());
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Pinboard ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function sectionForTags(tags: string[]): string | undefined {
  for (const tag of tags) {
    const section = SECTION_TAGS[tag.toLowerCase()];
    if (section) return section;
  }
  return undefined;
}

/**
 * The API request bounds for a window. Exported for the test that pins them.
 *
 * Pinboard's fromdt/todt are UTC, and the window boundary is an instant in
 * Central time — Friday 00:00 CT is 05:00 or 06:00 UTC depending on the season.
 * The request converts the true instants and pads an hour each side so
 * Pinboard's own bound semantics can never clip an edge bookmark; the padding
 * is harmless because `inWindow` on the true instants is the authority, the
 * same one the Micro.blog sweep and the renderers use.
 */
export function sweepBounds(window: Window): { fromdt: string; todt: string } {
  const pad = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { fromdt: iso(window.fromMs - pad), todt: iso(window.toMs + pad) };
}

/** The unread queue, captured inside the window — the true Central instants. */
export async function sweepPinboard(window: Window, tag?: string): Promise<Candidate[]> {
  const params: Record<string, string> = { ...sweepBounds(window) };
  if (SWEEP_UNREAD_ONLY) params.toread = 'yes';
  if (tag) params.tag = tag;

  const posts = (await call('/posts/all', params)) as PinboardPost[];

  return posts
    .filter((p) => inWindow(p.time, window))
    .map((p) => ({
    id: `pinboard:${p.hash ?? p.href}`,
    origin: 'Pinboard' as const,
    title: p.description,
    url: p.href,
    commentary: p.extended,
    tags: String(p.tags ?? '').split(/\s+/).filter(Boolean),
    published_at: p.time,
    // Carried so write-back can hand them back unchanged.
    flags: {
      toread: p.toread ?? 'yes',
      shared: p.shared ?? 'no',
    },
  }));
}

export function candidateToItem(c: Candidate): Item {
  const tags = c.tags ?? [];
  const commentary = String(c.commentary ?? '').trim();
  const item: Item = {
    type: 'pinboard_link',
    authorship: 'syndicated',
    source: 'Pinboard',
    channels: allChannels(),
    source_id: c.id,
    source_url: c.url,
    title: c.title,
    commentary,
    tags,
    sync_state: commentary ? 'synced' : 'needs_commentary',
    source_snapshot: { title: c.title, commentary, tags },
    source_flags: c.flags,
  };
  // The capture time is what the window judges. Dropping it here was a bug
  // that made every swept link immune to the window (the Micro.blog
  // converter always carried it; this one did not).
  if (c.published_at) item.published_at = c.published_at;
  const section = sectionForTags(tags);
  if (section) item.section = section;
  return item;
}

/**
 * One bookmark's capture time, by URL. Exists to heal items swept before the
 * converter carried `published_at` — those are invisible to the window, and
 * the windowed sweep cannot re-see a bookmark outside the current window.
 */
export async function captureTime(url: string): Promise<string | null> {
  try {
    const body = (await call('/posts/get', { url })) as { posts?: PinboardPost[] };
    return body.posts?.[0]?.time ?? null;
  } catch {
    return null;
  }
}

/**
 * The bookmark as it exists on Pinboard right now, for reconciliation.
 * Returns null only when Pinboard definitively answers that the bookmark is
 * gone; an API failure throws, so a flaky call can never read as a deletion.
 */
export async function fetchBookmark(url: string): Promise<RemoteFields | null> {
  const body = (await call('/posts/get', { url })) as { posts?: PinboardPost[] };
  const p = body.posts?.[0];
  if (!p) return null;
  return {
    title: p.description,
    commentary: p.extended,
    tags: p.tags ? p.tags.split(/\s+/).filter(Boolean) : [],
    flags: { toread: p.toread ?? 'yes', shared: p.shared ?? 'no' },
  };
}

export interface WriteBackResult {
  sync_state: SyncState;
  error?: string;
}

/**
 * Push the working values back to Pinboard. Guarded by
 * `WT_BUILDER_PINBOARD_WRITEBACK` because it mutates a real bookmark.
 */
export async function writeBack(item: Item): Promise<WriteBackResult> {
  if (!item.source_url) return { sync_state: 'failed', error: 'item has no source_url' };
  if (!config.pinboardWriteBack) {
    return { sync_state: 'local', error: 'write-back disabled (WT_BUILDER_PINBOARD_WRITEBACK)' };
  }

  // Compare-and-set: the bookmark as it stands must still match the snapshot
  // the sweep took, or an edit made on Pinboard since then would be replaced
  // and lost with no conflict ever surfacing. A fetch failure falls through —
  // the write itself will surface a real outage on its own terms.
  try {
    const remote = await fetchBookmark(item.source_url);
    if (remote === null) {
      return { sync_state: 'gone', error: 'deleted at Pinboard — not recreating it' };
    }
    if (sourceMoved(item, remote)) {
      return {
        sync_state: 'conflict',
        error: 'Pinboard changed since the last scan — re-scan to reconcile before writing',
      };
    }
  } catch { /* checked best-effort; the write reports its own failures */ }

  try {
    // `replace=yes` rewrites the whole bookmark, so every field we do not send
    // is reset to Pinboard's default — `shared=yes` and `toread=no`. Omitting
    // them publishes a private bookmark and drops it from the unread queue,
    // neither of which the editor asked for. The contract is title, commentary,
    // and tags; everything else goes back exactly as it came.
    const flags = item.source_flags ?? {};
    const result = (await call('/posts/add', {
      url: item.source_url,
      description: item.title ?? '',
      extended: item.commentary ?? '',
      tags: (item.tags ?? []).join(' '),
      toread: flags.toread ?? 'yes',
      shared: flags.shared ?? 'no',
      replace: 'yes',
    })) as { result_code?: string };

    if (result.result_code && result.result_code !== 'done') {
      return { sync_state: 'failed', error: result.result_code };
    }
    return { sync_state: 'synced' };
  } catch (err) {
    // The local edit stands; only the sync state records the failure.
    return { sync_state: 'failed', error: (err as Error).message };
  }
}
