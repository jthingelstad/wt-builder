/** Image rehosting and Micro.blog source handling. Nothing here touches a network. */

import { describe, expect, it, vi } from 'vitest';

import type { Item } from '../src/shared/types.ts';
import { allChannels } from '../src/shared/types.ts';
import { CDN_HOST, imageUrls, isRehosted, rewriteReferences } from '../src/server/integrations/images.ts';
import { candidateToItem } from '../src/server/integrations/microblog.ts';
import { formatPlace } from '../src/server/integrations/geocode.ts';
import { BRIEF_TAG, DEFAULT_LINK_SECTION, candidateToItem as pinboardItem, sectionForTags, sweepBounds } from '../src/server/integrations/pinboard.ts';
import { issueWindow, inWindow } from '../src/shared/dates.ts';
import { applySweep, createIssue } from '../src/server/issue.ts';

const item = (over: Partial<Item> = {}): Item => ({
  type: 'journal_post',
  authorship: 'syndicated',
  source: 'Micro.blog',
  channels: allChannels(),
  ...over,
});

describe('finding images in an item', () => {
  it('finds a raw <img> tag, which is how Micro.blog embeds photos', () => {
    const it0 = item({
      body: 'Departing CDG! ✈️\n\n<img src="https://www.thingelstad.com/uploads/2026/cc79.jpg" width="600" height="450" alt="">',
    });
    expect(imageUrls(it0)).toEqual(['https://www.thingelstad.com/uploads/2026/cc79.jpg']);
  });

  it('finds a Markdown image', () => {
    const it0 = item({ body: 'Look: ![a lake](https://example.com/lake.jpg)' });
    expect(imageUrls(it0)).toEqual(['https://example.com/lake.jpg']);
  });

  it('finds a Photo item’s own media', () => {
    const it0 = item({ type: 'photo', media: { url: 'https://example.com/p.jpg', alt: 'x' } });
    expect(imageUrls(it0)).toEqual(['https://example.com/p.jpg']);
  });

  it('does not treat an ordinary link as an image', () => {
    const it0 = item({ body: 'Love [this site](https://indiewebispunk.net), inspired by me.' });
    expect(imageUrls(it0)).toEqual([]);
  });

  it('deduplicates a URL referenced twice', () => {
    const it0 = item({
      body: '<img src="https://x.test/a.jpg"> and again <img src="https://x.test/a.jpg">',
    });
    expect(imageUrls(it0)).toHaveLength(1);
  });

  it('ignores relative and data URLs', () => {
    const it0 = item({ body: '<img src="/local.jpg"><img src="data:image/gif;base64,R0lGOD">' });
    expect(imageUrls(it0)).toEqual([]);
  });
});

describe('knowing what is already ours', () => {
  it('recognizes an image already on the CDN', () => {
    expect(isRehosted(`https://${CDN_HOST}/weekly-thing/350/images/abc.jpg`)).toBe(true);
  });

  it('does not mistake the blog for the CDN', () => {
    expect(isRehosted('https://www.thingelstad.com/uploads/2026/cc79.jpg')).toBe(false);
  });

  it('survives a malformed URL', () => {
    expect(isRehosted('not a url')).toBe(false);
  });
});

describe('rewriting references', () => {
  it('rewrites an <img> src and leaves the rest of the body alone', () => {
    const it0 = item({
      body: 'Coffee at [Johnson](https://jph.test).\n\n<img src="https://old.test/a.jpg" width="600">',
    });
    rewriteReferences(it0, 'https://old.test/a.jpg', `https://${CDN_HOST}/x.jpg`);
    expect(it0.body).toContain(`<img src="https://${CDN_HOST}/x.jpg" width="600">`);
    expect(it0.body).toContain('[Johnson](https://jph.test)');
  });

  it('rewrites a Photo item’s media url', () => {
    const it0 = item({ type: 'photo', media: { url: 'https://old.test/p.jpg' } });
    rewriteReferences(it0, 'https://old.test/p.jpg', `https://${CDN_HOST}/p.jpg`);
    expect(it0.media?.url).toBe(`https://${CDN_HOST}/p.jpg`);
  });

  it('rewrites every occurrence', () => {
    const it0 = item({ body: 'a https://o.test/i.jpg b https://o.test/i.jpg' });
    rewriteReferences(it0, 'https://o.test/i.jpg', 'https://n.test/i.jpg');
    expect(it0.body).toBe('a https://n.test/i.jpg b https://n.test/i.jpg');
  });
});

describe('a Micro.blog post becomes an item', () => {
  it('keeps the Markdown source rather than flattened text', () => {
    const built = candidateToItem({
      id: 'microblog:https://www.thingelstad.com/2026/08/22/love.html',
      origin: 'Micro.blog',
      url: 'https://www.thingelstad.com/2026/08/22/love.html',
      body: 'Love that Jim Mitchell created this new [IndieWeb is Punk](https://indiewebispunk.net) site.',
      published_at: '2026-08-22T13:48:54+00:00',
      titled: false,
    });
    expect(built.body).toContain('[IndieWeb is Punk](https://indiewebispunk.net)');
    expect(built.source).toBe('Micro.blog');
    expect(built.presentation).toBe('journal');
    expect(built.title).toBeUndefined();
  });

  it('records the source snapshot so provenance survives editing', () => {
    const built = candidateToItem({
      id: 'microblog:x', origin: 'Micro.blog', url: 'https://x.test/p.html',
      body: 'original words', title: 'A Title', titled: true,
    });
    expect(built.source_snapshot).toEqual({ body: 'original words', title: 'A Title' });
    expect(built.title).toBe('A Title');
  });
});

describe('the Pinboard sweep and the window agree on where Friday is', () => {
  // Friday 00:00 Central is 05:00 UTC in August (CDT). The request bounds
  // must be the true instants, padded — not midnight UTC, which is Thursday
  // evening in Minnesota and used to over-fetch by five hours a side.
  it('requests the Central instants, padded an hour each side', () => {
    const w = issueWindow('2026-09-05', 7); // closes Fri 2026-09-04 00:00 CT
    const b = sweepBounds(w);
    expect(b.fromdt).toBe('2026-08-28T04:00:00Z'); // Fri 00:00 CDT is 05:00Z, minus the pad
    expect(b.todt).toBe('2026-09-04T06:00:00Z');   // plus the pad
  });

  it("routes Jamie's _brief tag to Briefly, alongside the plain section tags", () => {
    expect(BRIEF_TAG).toBe('_brief');
    expect(sectionForTags([BRIEF_TAG])).toBe('Briefly');
    expect(sectionForTags(['_Brief'])).toBe('Briefly');
    // The spelling the builder wrote to bookmarks before 2026-09-20.
    expect(sectionForTags(['__brief'])).toBe('Briefly');
    expect(sectionForTags(['notable'])).toBe('Notable');
    expect(sectionForTags(['weekly-thing'])).toBeUndefined();
  });

  it('a candidate carrying _exclude is not swept in', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    const excluded = {
      id: 'pinboard:x', origin: 'Pinboard' as const, title: 'T', url: 'https://example.com/x',
      commentary: '', tags: ['_exclude'], published_at: '2026-09-01T20:00:00Z',
    };
    const { doc: next, report } = applySweep(doc, {
      window: issueWindow('2026-09-05', 7), links: [excluded as never], posts: [],
      bookmarks: new Map(), microblog: null, captureTimes: new Map(), seen: new Map(),
    });
    expect(Object.values(next.items).some((i) => i.source_url === 'https://example.com/x')).toBe(false);
    expect(report.added).toBe(0);
  });

  it('files by the bookmark: _brief or no description is Briefly, a described link is Notable', () => {
    const swept = (commentary: string, tags: string[]) => pinboardItem({
      id: 'pinboard:x', origin: 'Pinboard', title: 'T', url: 'https://example.com',
      commentary, tags, published_at: '2026-09-17T20:00:00Z',
    } as Parameters<typeof pinboardItem>[0]).section;
    expect(DEFAULT_LINK_SECTION).toBe('Notable');
    expect(swept('A line about it.', [])).toBe('Notable');
    expect(swept('', [])).toBe('Briefly');
    expect(swept('A line about it.', ['_brief'])).toBe('Briefly');
    expect(swept('', ['notable'])).toBe('Notable');
  });

  it('the padding admits nothing — inWindow on the instants is the authority', () => {
    const w = issueWindow('2026-09-05', 7);
    // Thursday 11:58 PM Central, stored as Friday 04:58 UTC: inside.
    expect(inWindow('2026-09-04T04:58:00Z', w)).toBe(true);
    // Friday 12:02 AM Central: the next issue's, even though the padded
    // request span includes it.
    expect(inWindow('2026-09-04T05:02:00Z', w)).toBe(false);
    // Thursday 7:30 PM Central the week the window opens — inside the old
    // midnight-UTC request span, outside the window.
    expect(inWindow('2026-08-28T00:30:00Z', w)).toBe(false);
  });
});

describe('photo place names follow the caption convention', () => {
  it('US: city plus the state code, from ISO3166-2', () => {
    expect(formatPlace({
      village: 'Falcon Heights', state: 'Minnesota',
      'ISO3166-2-lvl4': 'US-MN', country: 'United States', country_code: 'us',
    })).toBe('Falcon Heights, MN');
  });

  it('abroad: city plus country, no state', () => {
    expect(formatPlace({
      city: 'Barcelona', state: 'Catalunya', country: 'Spain', country_code: 'es',
    })).toBe('Barcelona, Spain');
  });

  it('degrades honestly when levels are missing', () => {
    expect(formatPlace({ state: 'Minnesota', country_code: 'us' })).toBe('Minnesota');
    expect(formatPlace({ country: 'France', country_code: 'fr' })).toBe('France');
    expect(formatPlace({})).toBeNull();
  });
});

describe('a Buttondown placeholder slug is not a URL worth recording', async () => {
  const { usableArchiveUrl } = await import('../src/server/integrations/buttondown.ts');
  it('drops the untitled draft URL and keeps a real one', () => {
    expect(usableArchiveUrl('https://buttondown.com/weekly-thing/archive/untitled/')).toBeUndefined();
    expect(usableArchiveUrl('https://buttondown.com/weekly-thing/archive/untitled-2/')).toBeUndefined();
    expect(usableArchiveUrl('https://buttondown.com/weekly-thing/archive/wt350-builders-puzzlers-and-agents/'))
      .toBe('https://buttondown.com/weekly-thing/archive/wt350-builders-puzzlers-and-agents/');
    expect(usableArchiveUrl(undefined)).toBeUndefined();
  });
});

// Updating an email Buttondown no longer holds as a draft is an override
// (2026-09-29), and it sends this same update: subject and body, never a
// status, so no override can schedule or send an email.
describe('a Buttondown update never changes the email\'s status', () => {
  it('the PATCH carries the subject and body only', async () => {
    const { credentials } = await import('../src/server/config.ts');
    const { updateDraft } = await import('../src/server/integrations/buttondown.ts');
    const prior = credentials.buttondownKey;
    credentials.buttondownKey = 'test-key';
    const calls: { method?: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
      calls.push({ method: init?.method, body: JSON.parse(String(init?.body)) });
      return Response.json({ id: 'em-1' });
    });
    try {
      await updateDraft('em-1', 'WT352 — A title', 'The body.');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.method).toBe('PATCH');
      expect(Object.keys(calls[0]!.body).sort()).toEqual(['body', 'subject']);
    } finally {
      vi.unstubAllGlobals();
      credentials.buttondownKey = prior;
    }
  });
});

// If the compare-and-set read failed, the update went out blind, over
// whatever the post says now (review 2026-09-27, §4).
describe('a Micro.blog update whose read fails writes nothing', () => {
  it('failed, the edit kept, and no Micropub update', async () => {
    const { config, credentials } = await import('../src/server/config.ts');
    const { updatePost } = await import('../src/server/integrations/microblog.ts');
    credentials.microblogToken = 'test-token';
    config.microblogWriteBack = true;
    const posts: string[] = [];
    vi.stubGlobal('fetch', async (_input: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(String(init.body)); return new Response('{}', { status: 202 }); }
      return new Response('down', { status: 503 });
    });
    try {
      const result = await updatePost(item({
        source_url: 'https://www.thingelstad.com/p.html', body: 'Edited here.',
        source_snapshot: { title: '', body: 'As scanned.' }, sync_state: 'syncing',
      }));
      expect(result.sync_state).toBe('failed');
      expect(result.error).toContain('could not read the post first');
      expect(result.error).toContain('your edit is kept');
      expect(posts).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      credentials.microblogToken = undefined;
      config.microblogWriteBack = false;
    }
  });
});

// Jamie does not use Micro.blog drafts, and a q=source read of the account
// (2026-09-28, 100 posts) found every one "published". Insurance all the
// same: if q=source ever returns a draft, it must not reach a reader
// (review 2026-09-27, §3).
describe('a Micro.blog draft is never swept', () => {
  it('skips a post whose post-status is present and not published, in the sweep and the index', async () => {
    const { credentials } = await import('../src/server/config.ts');
    const { sweepMicroblog, remoteIndex } = await import('../src/server/integrations/microblog.ts');
    credentials.microblogToken = 'test-token';
    const post = (slug: string, status?: string[]) => ({
      type: ['h-entry'],
      properties: {
        url: [`https://www.thingelstad.com/2026/09/01/${slug}.html`],
        published: ['2026-09-01T10:00:00-05:00'],
        content: [`The ${slug} post.`],
        ...(status ? { 'post-status': status } : {}),
      },
    });
    vi.stubGlobal('fetch', async () => Response.json({ items: [
      post('published', ['published']), post('draft', ['draft']), post('unmarked'),
    ] }));
    try {
      const swept = await sweepMicroblog(issueWindow('2026-09-05', 7));
      expect(swept.map((c) => c.url).sort()).toEqual([
        'https://www.thingelstad.com/2026/09/01/published.html',
        'https://www.thingelstad.com/2026/09/01/unmarked.html',
      ]);
      const index = await remoteIndex();
      expect([...index.byUrl.keys()].sort()).toEqual([
        'https://www.thingelstad.com/2026/09/01/published.html',
        'https://www.thingelstad.com/2026/09/01/unmarked.html',
      ]);
    } finally {
      vi.unstubAllGlobals();
      credentials.microblogToken = undefined;
    }
  });
});
