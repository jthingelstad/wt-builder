/**
 * Micro.blog, through Micropub.
 *
 * Reads post *source* — the exact Markdown Jamie wrote — from
 * `micropub?q=source`, rather than the rendered HTML in a feed. Two reasons:
 * the source is what should appear in the newsletter (a feed forces a lossy
 * HTML-to-text conversion), and the same endpoint is what updates a post, so
 * read and write share one interface and one token.
 *
 * Note that Micro.blog's `/posts/all` is NOT this. Despite the name it returns
 * the authenticated user's *timeline* — every account they follow — and
 * sweeping it puts other people's writing into the newsletter.
 */

import type { Candidate, Item } from '../../shared/types.ts';
import { allChannels } from '../../shared/types.ts';
import type { Window } from '../../shared/dates.ts';
import { inWindow } from '../../shared/dates.ts';
import { config, credentials } from '../config.ts';

const MICROPUB = 'https://micro.blog/micropub';

interface MicropubProperties {
  url?: string[];
  published?: string[];
  name?: string[];
  content?: (string | { html?: string; markdown?: string })[];
  category?: string[];
  'post-status'?: string[];
}

interface MicropubItem {
  type?: string[];
  properties?: MicropubProperties;
}

function requireToken(): string {
  const token = credentials.microblogToken;
  if (!token) throw new Error('MICROBLOG_API_KEY is not configured');
  return token;
}

function first(values: unknown[] | undefined): string {
  const v = values?.[0];
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as { markdown?: string; html?: string; value?: string };
    return o.markdown ?? o.html ?? o.value ?? '';
  }
  return '';
}

/** Post source for the authenticated blog, newest first. */
export async function fetchSource(limit = 100): Promise<MicropubItem[]> {
  const url = new URL(MICROPUB);
  url.searchParams.set('q', 'source');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${requireToken()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Micropub q=source failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { items?: MicropubItem[] };
  return body.items ?? [];
}

/** Posts published inside the window, carrying their Markdown source. */
export async function sweepMicroblog(window: Window): Promise<Candidate[]> {
  const items = await fetchSource();

  return items
    .map((i) => {
      const p = i.properties ?? {};
      const url = first(p.url);
      const published = first(p.published);
      const title = first(p.name).trim();
      const content = first(p.content);
      const candidate: Candidate = {
        id: `microblog:${url}`,
        origin: 'Micro.blog',
        url,
        body: content,
        published_at: published,
        titled: title.length > 0,
        tags: p.category ?? [],
      };
      if (title) candidate.title = title;
      return candidate;
    })
    .filter((c) => c.url && inWindow(c.published_at, window))
    .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)));
}

export function candidateToItem(c: Candidate): Item {
  const item: Item = {
    type: 'journal_post',
    authorship: 'syndicated',
    source: 'Micro.blog',
    channels: allChannels(),
    source_id: c.id,
    source_url: c.url,
    // A titled long post is a promotion candidate; promotion stays Jamie's call.
    presentation: 'journal',
    body: c.body,
    sync_state: 'synced',
    source_snapshot: { body: c.body, title: c.title },
  };
  if (c.title) item.title = c.title;
  if (c.tags?.length) item.tags = c.tags;
  if (c.published_at) item.published_at = c.published_at;
  return item;
}

export interface UpdateResult {
  sync_state: Item['sync_state'];
  error?: string;
}

/**
 * Write an edited post back through Micropub, last-writer-wins, on the same
 * terms as Pinboard. Placement, inclusion, and presentation are never
 * written back: those are facts about the issue, not about the post.
 *
 * Guarded by the same flag as Pinboard write-back because it mutates a
 * published post.
 */
export async function updatePost(item: Item): Promise<UpdateResult> {
  if (!item.source_url) return { sync_state: 'failed', error: 'item has no source_url' };
  if (!config.microblogWriteBack) {
    return { sync_state: 'local', error: 'write-back disabled (WT_BUILDER_MICROBLOG_WRITEBACK)' };
  }

  const replace: Record<string, unknown[]> = { content: [String(item.body ?? '')] };
  if (item.title) replace.name = [item.title];

  try {
    const res = await fetch(MICROPUB, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'update', url: item.source_url, replace }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { sync_state: 'failed', error: `${res.status} ${res.statusText} ${detail}` };
    }
    return { sync_state: 'synced' };
  } catch (err) {
    // The local edit stands; only the sync state records the failure.
    return { sync_state: 'failed', error: (err as Error).message };
  }
}

/** Presence check for the health route; never returns the token. */
export function isConfigured(): boolean {
  return Boolean(credentials.microblogToken);
}
