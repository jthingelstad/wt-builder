/** "Linked before in WTn": the link key, what an issue printed, and which issues count. No network. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { issueLinkKeys, linkKey, linkedBefore, linkedBeforeText } from '../src/server/linked-before.ts';

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

/** A pre-Builder issue as the import holds it: one published body, never parsed into items. */
function imported(number: number, date: string, body: string): { number: number; publication_date: string; status: string; doc: IssueDoc } {
  const doc = {
    schema_version: 1,
    issue: { id: `wt${number}`, number, title: `WT${number}`, dek: '', status: 'published', publication_date: date, window_days: 7, imported: true },
    nodes: [{ id: 'published', kind: 'mdblock', type: 'mdblock', label: 'Published text', movable: false, publishes_heading: false, items: ['published-text'] }],
    items: {
      'published-text': {
        type: 'markdown', authorship: 'Jamie', source: 'direct',
        channels: { website: true, email: true, audio: true }, body,
      },
    },
  } as unknown as IssueDoc;
  return { number, publication_date: date, status: 'published', doc };
}

describe('a link as a key', () => {
  it('ignores the scheme, www., the fragment, a trailing slash and tracking parameters', () => {
    const key = linkKey('https://example.com/post');
    expect(linkKey('http://www.example.com/post/')).toBe(key);
    expect(linkKey('https://WWW.Example.com/post#comments')).toBe(key);
    expect(linkKey('https://example.com/post/?utm_source=newsletter&utm_medium=email')).toBe(key);
    expect(linkKey('https://example.com/post?fbclid=abc&gclid=def&mc_cid=1&mc_eid=2')).toBe(key);
  });

  it('keeps the path\'s case and the query that says what the page is', () => {
    expect(linkKey('https://example.com/Post')).not.toBe(linkKey('https://example.com/post'));
    expect(linkKey('https://news.ycombinator.com/item?id=1&utm_source=x')).toBe('news.ycombinator.com/item?id=1');
    expect(linkKey('https://example.com/watch?v=abc')).not.toBe(linkKey('https://example.com/watch?v=xyz'));
  });

  it('is null for anything that is not an http(s) URL', () => {
    expect(linkKey('mailto:jamie@example.com')).toBeNull();
    expect(linkKey('not a url')).toBeNull();
    expect(linkKey('')).toBeNull();
  });
});

describe('the links an issue printed', () => {
  it('reads Markdown links, bare URLs and hrefs, with one level of parentheses', () => {
    const { doc } = imported(248, '2022-08-06', [
      'I linked [Curves and Surfaces](https://ciechanow.ski/curves-and-surfaces/).',
      'Also https://example.com/bare, and <a href="https://example.org/html">this</a>.',
      'See [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) for more.',
    ].join('\n'));
    const keys = issueLinkKeys(doc);
    expect(keys.has('ciechanow.ski/curves-and-surfaces')).toBe(true);
    expect(keys.has('example.com/bare')).toBe(true);
    expect(keys.has('example.org/html')).toBe(true);
    expect(keys.has('en.wikipedia.org/wiki/Foo_(bar)')).toBe(true);
  });

  it('reads a Builder issue\'s links, not a held-out item\'s or Thingy\'s', () => {
    const keys = issueLinkKeys(fixture());
    expect(keys.has('avc.xyz/create-your-own-currency-with-flipcash')).toBe(true);
    expect(keys.has('macstories.net/stories/introducing-shortcuts-playground')).toBe(true);
    expect(keys.has('thingelstad.com/example-excluded.html')).toBe(false);
    for (const key of keys) expect(key).not.toMatch(/^weekly\.thingelstad\.com\/archive\//);
  });
});

describe('which earlier issues carried it', () => {
  const now = { number: 352, publication_date: '2026-10-03' };
  const rows = [
    { number: 352, publication_date: '2026-10-03', status: 'draft', doc: imported(352, '2026-10-03', 'https://example.com/post').doc },
    imported(351, '2026-09-26', 'Nothing here.'),
    imported(274, '2024-01-27', 'Read [this](http://www.example.com/post/?utm_source=rss).'),
    imported(120, '2020-02-01', 'Back then: https://example.com/post'),
  ];

  it('names every earlier published issue, newest first', () => {
    expect(linkedBefore('https://example.com/post', now, rows)).toEqual([
      { number: 274, publication_date: '2024-01-27' },
      { number: 120, publication_date: '2020-02-01' },
    ]);
  });

  it('never counts the issue being drafted, a later issue, or an unpublished one', () => {
    const later = imported(353, '2026-10-10', 'https://example.com/post');
    const sameDay = imported(999, '2026-10-03', 'https://example.com/post');
    const unsent = { ...imported(300, '2025-06-01', 'https://example.com/post'), status: 'draft' };
    expect(linkedBefore('https://example.com/post', now, [rows[0]!, later, sameDay, unsent])).toEqual([]);
  });

  it('finds nothing for a link never carried, or no link at all', () => {
    expect(linkedBefore('https://example.com/other', now, rows)).toEqual([]);
    expect(linkedBefore('', now, rows)).toEqual([]);
  });

  it('reads as "WT274 (2024-01-27)", with a count past five', () => {
    expect(linkedBeforeText([{ number: 274, publication_date: '2024-01-27' }])).toBe('WT274 (2024-01-27)');
    const many = Array.from({ length: 7 }, (_, i) => ({ number: 300 - i, publication_date: `2025-0${9 - i}-01` }));
    expect(linkedBeforeText(many)).toBe(
      'WT300 (2025-09-01), WT299 (2025-08-01), WT298 (2025-07-01), WT297 (2025-06-01), WT296 (2025-05-01), and 2 earlier',
    );
  });
});
