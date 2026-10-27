/**
 * The podcast's small derivations: the block markup, the outline's cleaning
 * and narration, the card's pace, how long an episode took, the send's
 * clash check, and reading a landed episode back off the live site.
 */

import { describe, expect, it } from 'vitest';

import { cardSeconds, inlineRuns, parseBlocks, serializeBlocks } from '../src/shared/podcast/cards.ts';
import { cleanOutline, outlineEvents } from '../src/shared/podcast/outline.ts';
import { beats, plannedTotal, splitReport } from '../src/shared/podcast/pace.ts';
import { episodeTiming } from '../src/shared/podcast/timing.ts';
import type { EpisodeDoc, Segment } from '../src/shared/podcast/types.ts';

process.env.WT_BUILDER_DB ??= '/tmp/wt-podcast-units-never-opened.db';
const { clashes } = await import('../src/server/podcast/routes.ts');
const { FEED_URL, LANDING_MS, verifyEpisode } = await import('../src/server/podcast/verify.ts');

describe('blocks', () => {
  it('parses the marks and round-trips', () => {
    const text = 'plain line\n! hook\n" Say it exactly.\n> on to the next\n? an aside';
    const blocks = parseBlocks(text);
    expect(blocks.map((b) => b.t)).toEqual(['line', 'trigger', 'verbatim', 'bridge', 'cuttable']);
    expect(serializeBlocks(blocks)).toBe(text);
  });

  it('a mark needs a space after it, and blank lines go', () => {
    expect(parseBlocks('!important\n\n?!\n   ')).toEqual([{ t: 'line', text: '!important' }, { t: 'line', text: '?!' }]);
  });

  it('glance words split out, an unmatched asterisk stays', () => {
    expect(inlineRuns('the *newsletter* is 9 * 1')).toEqual([
      { text: 'the ', glance: false }, { text: 'newsletter', glance: true }, { text: ' is 9 * 1', glance: false },
    ]);
  });

  it("a card's seconds: its own, or an even share of what its segment leaves", () => {
    const seg: Segment = { id: 's', title: '', minutes: 3, links: [], cards: [{ id: 'a', blocks: [], seconds: 60 }, { id: 'b', blocks: [] }, { id: 'c', blocks: [] }] };
    expect(cardSeconds(seg, seg.cards[0]!)).toBe(60);
    expect(cardSeconds(seg, seg.cards[1]!)).toBe(60);
    expect(cardSeconds({ ...seg, minutes: undefined }, seg.cards[1]!)).toBeNull();
  });
});

describe('the outline', () => {
  it('cleans what a client sends: ids given, junk dropped, roles checked', () => {
    const out = cleanOutline([
      { title: '  Open ', role: 'intro', minutes: '2', cards: [{ claim: 'Hi', blocks: [{ t: 'nonsense', text: 'x' }, { t: 'trigger', text: 'go' }] }], links: [{ url: 'javascript:alert(1)' }, { text: 'ok', url: 'https://ok.example' }] },
      { title: 'Bad role', role: 'villain', cards: 'not a list' },
      'not a segment',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBeTruthy();
    expect(out[0]!.cards[0]!.id).toBeTruthy();
    expect(out[1]!.role).toBeUndefined();
    expect(out[1]!.cards).toEqual([]);
    expect(out[0]!.links.map((l) => l.url)).toEqual(['https://ok.example']);
  });

  it('narrates a save: added, edited, reordered, removed', () => {
    const before = cleanOutline([
      { id: 'a', title: 'A', cards: [{ id: 'a1', claim: 'one', blocks: [] }, { id: 'a2', claim: 'two', blocks: [] }] },
      { id: 'b', title: 'B', cards: [] },
    ]);
    const after = cleanOutline([
      { id: 'c', title: 'C', cards: [] },
      { id: 'a', title: 'A', cards: [{ id: 'a2', claim: 'two', blocks: [] }, { id: 'a1', claim: 'one, better', blocks: [] }] },
    ]);
    const summaries = outlineEvents(before, after).map((e) => e.summary);
    expect(summaries).toEqual([
      'Added segment — C',
      'Cards reordered — A',
      'Edited 1 card — A',
      'Removed segment — B',
    ]);
    expect(outlineEvents(before, before)).toEqual([]);
  });

  it('plans, beats and the splits report', () => {
    const segs = cleanOutline([
      { id: 'a', title: 'A', minutes: 2, cards: [{ id: 'a1', claim: 'x', blocks: [] }, { id: 'a2', claim: 'y', blocks: [] }] },
      { id: 'b', title: 'B', minutes: 1, cards: [{ id: 'b1', claim: 'z', blocks: [] }] },
    ]);
    expect(plannedTotal(segs)).toBe(180);
    expect(beats(segs).map((b) => [b.start, b.end])).toEqual([[0, 60], [60, 120], [120, 180]]);
    const report = splitReport(segs, [{ segmentId: 'a', entered: 0 }, { segmentId: 'b', entered: 150 }], 200);
    expect(report.map((r) => [r.actual, r.budget])).toEqual([[150, 120], [50, 60]]);
  });
});

describe('how long an episode took', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 11, 14, 0) + min * 60_000).toISOString();
  const act = (min: number, kind: string, extra: Record<string, unknown> = {}) => ({ at: at(min), kind, summary: kind, actor: 'jamie', ...extra });

  it('counts sittings, caps breaks, and credits a take with its own length', () => {
    const t = episodeTiming([
      act(0, 'structure'),
      act(5, 'edit'),
      act(40, 'edit'), // a new sitting: past the 30-minute gap
      act(41, 'recording', { data: { action: 'started' } }),
      // A 50-minute take: past the gap, and still the same sitting.
      act(91, 'recording', { data: { action: 'finished', seconds: 3000 } }),
      act(95, 'audio'),
      { at: at(96), kind: 'send', summary: 'by the service', actor: 'wt-builder' },
    ]);
    expect(t.sittings).toBe(2);
    expect(t.takes).toBe(1);
    expect(t.recordedSeconds).toBe(3000);
    expect(t.byStage.outline).toBe(5 * 60_000);
    expect(t.byStage.record).toBe(60_000 + 50 * 60_000);
    expect(t.byStage.publish).toBe(4 * 60_000);
    expect(t.actions).toBe(6);
  });

  it('stops counting at the publish', () => {
    const t = episodeTiming([
      act(0, 'structure'),
      act(5, 'edit'),
      { at: at(6), kind: 'episode', summary: 'Published', actor: 'wt-builder', data: { action: 'published' } },
      act(10, 'edit'),
    ]);
    expect(t.actions).toBe(2);
    expect(t.publishedAt).toBe(at(6));
  });
});

describe('the send', () => {
  const doc = (number: number, slug: string, state: 'sent' | 'failed' | null = null) => ({
    episode: { number, slug },
    sends: state ? { another: { status: state, at: 'x' } } : {},
  }) as unknown as EpisodeDoc;

  it('finds another episode under this number, and leaves its own files alone', () => {
    const paths = ['content/episodes/001-how-do-you-start-a-podcast.md', 'content/episodes/002-mine.md', 'content/episodes/002-mine.txt'];
    expect(clashes(doc(1, 'something-else'), paths)).toEqual(['content/episodes/001-how-do-you-start-a-podcast.md']);
    // Never tried, a page at this very name was published by someone else: sending would write over it.
    expect(clashes(doc(2, 'mine'), paths)).toEqual(['content/episodes/002-mine.md', 'content/episodes/002-mine.txt']);
    // After a failed send, its own page is that send, landed unrecorded: the retry reconciles it.
    expect(clashes(doc(2, 'mine', 'failed'), paths)).toEqual([]);
    // Sent, they are this episode's own, replaced by a re-send.
    expect(clashes(doc(2, 'mine', 'sent'), paths)).toEqual([]);
    expect(clashes(doc(3, 'new'), paths)).toEqual([]);
  });

  it('never looks for the mp3 in the repository: the audio bucket holds it', () => {
    // An mp3 in the tree (one committed by hand before the cutover) neither takes the number nor counts as landed.
    expect(clashes(doc(2, 'mine'), ['uploads/2026/another-thing-2.mp3'])).toEqual([]);
    expect(clashes(doc(2, 'mine', 'failed'), ['uploads/2026/another-thing-2.mp3', 'content/episodes/002-other.md'])).toEqual(['content/episodes/002-other.md']);
  });
});

describe('reading a sent episode back', () => {
  const sentAt = Date.parse('2026-10-12T01:00:00Z');
  const sent = {
    episode: { id: 'at2', number: 2, slug: 'ready', date: '2026-10-11T19:30:00-05:00' },
    sends: { another: { status: 'sent', at: new Date(sentAt).toISOString(), audio: { bytes: 1234 } } },
  } as unknown as EpisodeDoc;
  const page = 'https://another.thingelstad.com/2026/10/12/ready.html';
  const mp3 = 'https://another.thingelstad.com/uploads/2026/another-thing-2.mp3';

  function site(over: { feed?: string; bytes?: number; page?: number } = {}): typeof fetch {
    return (async (url: string) => {
      if (url === FEED_URL) return new Response(over.feed ?? `<item><guid isPermaLink="true">${page}</guid><enclosure url="${mp3}" length="1234" type="audio/mpeg" /></item>`);
      if (url === mp3) return new Response(null, { status: 200, headers: { 'content-length': String(over.bytes ?? 1234) } });
      if (url === page) return new Response('ok', { status: over.page ?? 200 });
      return new Response('', { status: 404 });
    }) as typeof fetch;
  }

  it('passes when the feed, the enclosure, the bytes and the page all say so', async () => {
    const v = await verifyEpisode(sent, site(), sentAt + 60_000);
    expect(v.status).toBe('passed');
    expect(v.checks.map((c) => c.label)).toEqual(['Feed', 'Enclosure', 'Audio', 'Page']);
  });

  it('a missing piece soon after the send is waiting; later it is a problem', async () => {
    const early = await verifyEpisode(sent, site({ feed: '<rss/>' }), sentAt + 60_000);
    expect(early.status).toBe('waiting');
    expect(early.recheck_at).toBeTruthy();
    const late = await verifyEpisode(sent, site({ feed: '<rss/>' }), sentAt + LANDING_MS + 60_000);
    expect(late.status).toBe('problems');
  });

  it('different bytes at the enclosure are a problem', async () => {
    const v = await verifyEpisode(sent, site({ bytes: 99 }), sentAt + LANDING_MS + 60_000);
    expect(v.checks.find((c) => c.label === 'Audio')!.ok).toBe(false);
  });

  it('an unsent episode is an error, not a check', async () => {
    const v = await verifyEpisode({ ...sent, sends: {} } as EpisodeDoc, site());
    expect(v.status).toBe('error');
  });
});
