/** Image rehosting and Micro.blog source handling. Nothing here touches a network. */

import { describe, expect, it } from 'vitest';

import type { Item } from '../src/shared/types.ts';
import { allChannels } from '../src/shared/types.ts';
import { CDN_HOST, imageUrls, isRehosted, rewriteReferences } from '../src/server/integrations/images.ts';
import { candidateToItem } from '../src/server/integrations/microblog.ts';
import { BRIEF_TAG, sectionForTags, sweepBounds } from '../src/server/integrations/pinboard.ts';
import { issueWindow, inWindow } from '../src/shared/dates.ts';

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

  it("routes Jamie's __brief tag to Briefly, alongside the plain section tags", () => {
    expect(sectionForTags([BRIEF_TAG])).toBe('Briefly');
    expect(sectionForTags(['__Brief'])).toBe('Briefly');
    expect(sectionForTags(['notable'])).toBe('Notable');
    expect(sectionForTags(['weekly-thing'])).toBeUndefined();
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
