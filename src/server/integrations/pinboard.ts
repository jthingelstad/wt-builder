/**
 * Pinboard.
 *
 * Read: every bookmark inside the issue window becomes a link candidate.
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
 * How a bookmark gets into the issue: it was saved inside the window. That
 * is the whole rule. Read/unread is Jamie's own flag and the builder does
 * not read or write it (Jamie, 2026-09-20, after WT350: "It is a flag I'll
 * use. WT Builder doesn't care") — it used to sweep the unread queue only,
 * and mark a bookmark read when its commentary was written or it was held
 * out, which made every commentary edit a Pinboard write about reading.
 * A bookmark that is not for the issue is held out, and `_exclude` says so.
 */

/**
 * Jamie's Pinboard convention for a Briefly link, from the Shortcuts era.
 * Moving a link between Notable and Briefly in the builder adds or removes
 * it, and the write-back carries it to the bookmark.
 */
/**
 * Jamie's Briefly mark on a bookmark, single underscore — that is what the
 * bookmarks actually carry (verified against WT350's swept tags, 2026-09-20).
 * The builder shipped for a fortnight believing it was `__brief`, so the
 * double-underscore spelling is still recognised on read and stripped on a
 * move to Notable; only the real one is ever written.
 */
export const BRIEF_TAG = '_brief';
const BRIEF_TAGS = new Set([BRIEF_TAG, '__brief']);

export function isBriefTag(tag: string): boolean {
  return BRIEF_TAGS.has(tag.toLowerCase());
}

/**
 * Jamie's "not in the issue" mark. Holding a link out of the issue writes it
 * onto the bookmark, so the exclusion lives where Jamie files and survives a
 * rebuild; taking it off at Pinboard puts the link back at the next re-scan
 * (2026-09-20). Never swept in while present.
 */
export const EXCLUDE_TAG = '_exclude';

export function isExcludeTag(tag: string): boolean {
  return tag.toLowerCase() === EXCLUDE_TAG;
}

/** Tags that route a link to a section. */
const SECTION_TAGS: Record<string, string> = {
  notable: 'Notable',
  briefly: 'Briefly',
  featured: 'Featured',
};

/**
 * Where a bookmark says it goes. Jamie's convention is one mark and one
 * inference: `_brief` is a Briefly link; a link with no description is
 * Briefly too (there is nothing to say about it yet); a described, unmarked
 * link is Notable. Sweeping every untagged link into Briefly (as the builder
 * did until 2026-09-20) put the whole week's reading in the wrong section.
 */
export const DEFAULT_LINK_SECTION = 'Notable';

export function sectionForBookmark(tags: string[], commentary: unknown): string {
  const tagged = sectionForTags(tags);
  if (tagged) return tagged;
  return String(commentary ?? '').trim() ? DEFAULT_LINK_SECTION : 'Briefly';
}

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
    if (isBriefTag(tag)) return 'Briefly';
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

/**
 * Jamie's own recent commentary, as the link wand's examples of his voice:
 * public bookmarks with extended text, newest first, over the last half
 * year. posts/all is rate-limited to once per five minutes, so the list is
 * cached for six hours — voice does not change by the minute.
 */
let voiceCache: { at: number; posts: PinboardPost[] } | null = null;
export async function recentCommentary(): Promise<PinboardPost[]> {
  if (voiceCache && Date.now() - voiceCache.at < 6 * 3_600_000) return voiceCache.posts;
  const since = new Date(Date.now() - 183 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const posts = (await call('/posts/all', { fromdt: since, results: '400' })) as PinboardPost[];
  const kept = posts.filter((p) => p.shared !== 'no' && p.extended.trim().length >= 20 && !/(^|\s)_exclude(\s|$)/.test(p.tags));
  voiceCache = { at: Date.now(), posts: kept };
  return kept;
}

/** Everything captured inside the window — the true Central instants. */
export async function sweepPinboard(window: Window, tag?: string): Promise<Candidate[]> {
  const params: Record<string, string> = { ...sweepBounds(window) };
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
  item.section = sectionForBookmark(tags, commentary);
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
  /** The flags as written, for the item to carry until the next scan. */
  flags?: Record<string, string>;
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
  let current: Record<string, string> | undefined;
  try {
    const remote = await fetchBookmark(item.source_url);
    if (remote === null) {
      return { sync_state: 'gone', error: 'deleted at Pinboard — not recreating it' };
    }
    current = remote.flags;
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
    // them publishes a private bookmark and flips it read, neither of which
    // the editor asked for. The contract is title, commentary, and tags;
    // everything else goes back exactly as it stands at Pinboard *now* — the
    // record just fetched, so a flag Jamie flipped since the scan survives
    // the write. Read/unread is his flag; the builder never sets it.
    const flags = { ...(item.source_flags ?? {}), ...(current ?? {}) };
    flags.toread = flags.toread ?? 'yes';
    flags.shared = flags.shared ?? 'no';
    const result = (await call('/posts/add', {
      url: item.source_url,
      description: item.title ?? '',
      extended: item.commentary ?? '',
      tags: (item.tags ?? []).join(' '),
      toread: flags.toread,
      shared: flags.shared,
      replace: 'yes',
    })) as { result_code?: string };

    if (result.result_code && result.result_code !== 'done') {
      return { sync_state: 'failed', error: result.result_code };
    }
    return { sync_state: 'synced', flags };
  } catch (err) {
    // The local edit stands; only the sync state records the failure.
    return { sync_state: 'failed', error: (err as Error).message };
  }
}
