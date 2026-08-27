/**
 * Micro.blog.
 *
 * Read-only. WT-specific inclusion, presentation, edits, and placement never
 * modify the original post (docs/item-model.md, Synchronization).
 */

import type { Candidate, Item } from '../../shared/types.ts';
import { allChannels } from '../../shared/types.ts';
import type { Window } from '../../shared/dates.ts';
import { inWindow } from '../../shared/dates.ts';
import { config, credentials } from '../config.ts';

interface JsonFeedItem {
  id: string;
  url?: string;
  title?: string;
  content_html?: string;
  content_text?: string;
  date_published?: string;
}

interface JsonFeed {
  items?: JsonFeedItem[];
}

/** Strip HTML to the text a Journal entry prints. */
export function toPlainText(html: string): string {
  return html
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Posts published inside the window. Prefers the authenticated Micro.blog API
 * and falls back to the blog's public JSON Feed, which needs no credential.
 */
export async function sweepMicroblog(window: Window): Promise<Candidate[]> {
  const items = credentials.microblogToken
    ? await fetchFromApi().catch(() => fetchFromFeed())
    : await fetchFromFeed();

  return items
    .filter((i) => inWindow(i.date_published, window))
    .map((i) => {
      const body = toPlainText(i.content_html ?? i.content_text ?? '');
      const title = String(i.title ?? '').trim();
      const candidate: Candidate = {
        id: `microblog:${i.id}`,
        origin: 'Micro.blog',
        url: i.url ?? i.id,
        body,
        published_at: i.date_published,
        titled: title.length > 0,
      };
      if (title) candidate.title = title;
      return candidate;
    })
    .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)));
}

async function fetchFromApi(): Promise<JsonFeedItem[]> {
  const res = await fetch(`${config.microblogHost}/posts/all`, {
    headers: { Authorization: `Bearer ${credentials.microblogToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Micro.blog API failed: ${res.status}`);
  const feed = (await res.json()) as JsonFeed;
  return feed.items ?? [];
}

async function fetchFromFeed(): Promise<JsonFeedItem[]> {
  const res = await fetch(`${config.blogUrl.replace(/\/$/, '')}/feed.json`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Micro.blog feed failed: ${res.status}`);
  const feed = (await res.json()) as JsonFeed;
  return feed.items ?? [];
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
    source_snapshot: { body: c.body, title: c.title },
  };
  if (c.title) item.title = c.title;
  if (c.published_at) item.published_at = c.published_at;
  return item;
}
