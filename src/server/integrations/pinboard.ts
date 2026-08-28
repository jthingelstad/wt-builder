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
import { addDays } from '../../shared/dates.ts';
import { config, credentials } from '../config.ts';

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

/** The unread queue, captured inside the window. */
export async function sweepPinboard(window: Window, tag?: string): Promise<Candidate[]> {
  const params: Record<string, string> = {
    fromdt: `${window.from}T00:00:00Z`,
    // Pinboard's fromdt/todt are bound-exclusive, so reach past the final day.
    todt: `${addDays(window.to, 1)}T00:00:00Z`,
  };
  if (SWEEP_UNREAD_ONLY) params.toread = 'yes';
  if (tag) params.tag = tag;

  const posts = (await call('/posts/all', params)) as PinboardPost[];

  return posts.map((p) => ({
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
