/**
 * Pinboard.
 *
 * Read: the issue window's tagged bookmarks become link candidates.
 * Write: last-writer-wins on title, commentary, and supported tags. A failed
 * write never discards the local edit (docs/item-model.md, Synchronization).
 */

import type { Candidate, Item, SyncState } from '../../shared/types.ts';
import { allChannels } from '../../shared/types.ts';
import type { Window } from '../../shared/dates.ts';
import { config, credentials } from '../config.ts';

const API = 'https://api.pinboard.in/v1';

/** The tag that marks a bookmark as destined for the newsletter. */
export const SWEEP_TAG = 'weekly-thing';

/** Tags that route a link to a section. Placement in the issue still wins. */
const SECTION_TAGS: Record<string, string> = {
  notable: 'Notable',
  briefly: 'Briefly',
  featured: 'Featured',
};

export interface PinboardPost {
  href: string;
  description: string;
  extended: string;
  tags: string;
  time: string;
  hash?: string;
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

/** Bookmarks tagged for the newsletter, captured inside the window. */
export async function sweepPinboard(window: Window): Promise<Candidate[]> {
  const posts = (await call('/posts/all', {
    tag: SWEEP_TAG,
    fromdt: `${window.from}T00:00:00Z`,
    // `todt` is exclusive, so reach to the start of the day after the window ends.
    todt: `${window.to}T23:59:59Z`,
  })) as PinboardPost[];

  return posts.map((p) => ({
    id: `pinboard:${p.hash ?? p.href}`,
    origin: 'Pinboard' as const,
    title: p.description,
    url: p.href,
    commentary: p.extended,
    tags: String(p.tags ?? '').split(/\s+/).filter(Boolean),
    published_at: p.time,
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
  };
  const section = sectionForTags(tags);
  if (section) item.section = section;
  return item;
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

  try {
    const result = (await call('/posts/add', {
      url: item.source_url,
      description: item.title ?? '',
      extended: item.commentary ?? '',
      tags: (item.tags ?? []).join(' '),
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
