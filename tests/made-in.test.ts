/**
 * The Made in card (design D, 2026-10-04): its stats, where the time went,
 * a tile per day — and never a clock time, because it is meant to be shared
 * (Jamie, 2026-10-04).
 */
import { describe, expect, it } from 'vitest';

import { madeIn } from '../src/client/made-in.ts';
import type { IssueTiming } from '../src/shared/timing.ts';

const M = 60_000;
const day = (d: string, label: string, sittings: number, minutes: number, added: number) =>
  ({ day: d, label, sittings, ms: minutes * M, added });

/** WT352 as it went: 10 sittings over 7 days, sent on a Sunday. */
const wt352: IssueTiming = {
  sessions: Array.from({ length: 10 }, (_, i) => ({ start: `2026-10-04T1${i}:00:00.000Z`, end: `2026-10-04T1${i}:05:00.000Z`, ms: 0, actions: 3 })),
  byDay: [
    day('2026-09-25', 'Fri, Sep 25', 0, 0, 6),
    day('2026-09-26', 'Sat, Sep 26', 1, 0.2, 5),
    day('2026-09-27', 'Sun, Sep 27', 0, 0, 3),
    day('2026-09-28', 'Mon, Sep 28', 1, 3, 8),
    day('2026-09-29', 'Tue, Sep 29', 2, 9, 0),
    day('2026-09-30', 'Wed, Sep 30', 1, 1, 12),
    day('2026-10-01', 'Thu, Oct 1', 0, 0, 6),
    day('2026-10-02', 'Fri, Oct 2', 1, 0.6, 0),
    day('2026-10-03', 'Sat, Oct 3', 2, 6, 0),
    day('2026-10-04', 'Sun, Oct 4', 2, 105, 0),
  ],
  activeMs: 125 * M,
  actions: 234,
  edits: 115,
  publishedAt: '2026-10-04T16:15:36.423Z',
  sendMs: 3 * M,
  after: { actions: 3, sends: 1, ms: 0 },
  bySection: [
    ['Notable', 54], ['Briefly', 20], ['Currently', 12], ['Journal', 9], ['Review & send', 8], ['Intro', 5],
    ['Other', 4], ['Photo', 3], ['Membership', 3], ['Haiku', 3], ['Echoes', 2], ['Outro', 1], ['Title & dek', 0.4],
  ].map(([label, m]) => ({ label: label as string, ms: (m as number) * M })),
};
const wt351: IssueTiming = { ...wt352, activeMs: 150 * M, after: { actions: 3, sends: 1, ms: 5 * M } };

const card = madeIn({
  number: 352,
  timing: wt352,
  previous: { number: 351, timing: wt351 },
  pills: { done: 46, total: 46 },
  legs: { sent: 4, total: 4 },
});

describe('Made in, design D', () => {
  it('heads the card with the issue and the comparison, no sentence', () => {
    expect(card.eyebrow).toBe('WHAT IT TOOK · THE WEEKLY THING 352');
    expect(card.comparison).toEqual({ text: '30 m less than WT351', less: true });
  });

  it('states four stats: time, sittings, pills, send', () => {
    expect(card.stats).toEqual([
      { value: '2 h 05 m', label: 'writing, over 7 days' },
      { value: '10', label: 'sittings' },
      { value: '46', label: 'pills, all done' },
      { value: '3 m', label: 'to send all four' },
    ]);
  });

  it('puts the top five in the bar and the rest, Other with it, in one', () => {
    expect(card.segments.map((s) => [s.label, s.time])).toEqual([
      ['Notable', '54 m'], ['Briefly', '20 m'], ['Currently', '12 m'], ['Journal', '9 m'], ['Review & send', '8 m'],
      ['Everything else', '21 m'],
    ]);
  });

  it('gives each day a tile, shaded by its minutes, with what arrived', () => {
    expect(card.tiles).toHaveLength(wt352.byDay.length);
    expect(card.tiles.map((t) => t.dow)).toEqual(['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(card.tiles.map((t) => t.time)).toEqual(['', '<1 m', '', '3 m', '9 m', '1 m', '', '<1 m', '6 m', '1h45']);
    expect(card.tiles.map((t) => t.added)).toEqual(['+6', '+5', '+3', '+8', '', '+12', '+6', '', '', '']);
    expect(card.tiles[0]!.shade).toBe('var(--app)'); // no sitting
    expect(card.tiles[9]).toMatchObject({ shade: 'var(--made-1)', dark: true }); // an hour and more
    expect(card.tiles[1]).toMatchObject({ shade: 'var(--made-6)', dark: false });
  });

  it('says the send day and what came after, in the footnote', () => {
    expect(card.footnote).toBe('Gold numbers are the links and posts that arrived that day; Sunday turned them into an issue, with one re‑send after it went.');
  });

  it('never shows when a sitting happened (Jamie, 2026-10-04)', () => {
    const text = JSON.stringify(card);
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(text).not.toMatch(/\b(AM|PM)\b/i);
    expect(text).not.toMatch(/T\d{2}:/);
  });

  it('says what is still open before it has gone', () => {
    const draft = madeIn({
      number: 353,
      timing: { ...wt352, publishedAt: undefined, sendMs: undefined },
      previous: null,
      pills: { done: 40, total: 46 },
      legs: { sent: 1, total: 4 },
    });
    expect(draft.eyebrow).toBe('WHAT IT HAS TAKEN SO FAR · THE WEEKLY THING 353');
    expect(draft.comparison).toBeNull();
    expect(draft.stats.slice(2)).toEqual([
      { value: '46', label: 'pills, 40 done' },
      { value: '1 of 4', label: 'sent so far' },
    ]);
    expect(draft.footnote).toBe('Gold numbers are the links and posts that arrived that day. It has not gone out yet.');
  });

  it('says more time plainly, and fixing after it went', () => {
    const slower = madeIn({
      number: 352,
      timing: { ...wt352, after: { actions: 9, sends: 2, ms: 12 * M } },
      previous: { number: 351, timing: { ...wt351, activeMs: 100 * M, after: { actions: 0, sends: 0, ms: 0 } } },
      pills: null,
      legs: { sent: 3, total: 4 },
    });
    expect(slower.comparison).toEqual({ text: '37 m more than WT351', less: false });
    expect(slower.stats.map((s) => s.label)).toEqual(['writing, over 7 days', 'sittings', 'to send three of four']);
    expect(slower.footnote).toMatch(/Sunday turned them into an issue, and 12 m fixing after it went\.$/);
  });
});
