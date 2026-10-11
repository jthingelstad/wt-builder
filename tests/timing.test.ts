/**
 * Issue timing, from the event log: what counts as Jamie's time, where a
 * sitting ends, which "Published" is real, and where the time went.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { duration, issueTiming, type TimingEvent } from '../src/shared/timing.ts';

const doc = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8')) as IssueDoc;
const at = (hhmm: string, day = '2026-09-26') => `${day}T${hhmm}:00.000Z`;
const ev = (hhmm: string, kind: string, summary: string, anchor?: string, day?: string): TimingEvent => ({ at: at(hhmm, day), kind, summary, anchor });

describe('issue timing', () => {
  const events: TimingEvent[] = [
    ev('09:00', 'issue', 'Published — WT350', undefined, '2026-08-30'), // an early development run
    ev('14:00', 'edit', 'Edited commentary — x', 'link-flipcash'),
    ev('14:08', 'edit', 'Edited commentary — x', 'link-flipcash'),
    ev('14:10', 'moved', 'Briefly → Notable, following the bookmark'), // the re-scan, not Jamie
    ev('14:20', 'edit', 'Edited body — y', 'briefly-forge'),
    ev('16:00', 'settings', 'Settings — title'), // a new sitting
    ev('16:30', 'send', 'Send started — website'),
    ev('16:40', 'issue', 'Published — WT350'),
    ev('17:00', 'send', 'Send started — buttondown'),
    ev('17:05', 'edit', 'Edited body — y', 'briefly-forge'),
    ev('20:00', 'send', 'Send started — podcast', undefined, '2026-09-27'), // next day: other work
  ];
  const t = issueTiming(events, doc);

  it('splits sittings at 30 minutes and counts only Jamie', () => {
    expect(t.sessions.map((s) => s.actions)).toEqual([3, 2]);
    expect(duration(t.activeMs)).toBe('50 m');
    expect(t.actions).toBe(5);
    expect(t.edits).toBe(3);
  });

  it('gives each day its sittings, minutes and arrivals, never a clock time (shared, 2026-10-04)', () => {
    const sat = t.byDay.find((d) => d.day === '2026-09-26')!;
    expect(sat).toEqual({ day: '2026-09-26', label: 'Sat, Sep 26', sittings: 2, ms: 50 * 60_000, added: 0 });
    for (const d of t.byDay) expect(Object.keys(d).sort()).toEqual(['added', 'day', 'label', 'ms', 'sittings']);
    expect(t.byDay.map((d) => d.day)).toEqual([...t.byDay.map((d) => d.day)].sort());
    // The fixture's bookmarks and posts arrive on days with no sitting at all.
    expect(t.byDay.some((d) => d.added > 0 && d.sittings === 0)).toBe(true);
  });

  it('takes the last Published as the real one, and times the send', () => {
    expect(t.publishedAt).toBe(at('16:40'));
    expect(duration(t.sendMs!)).toBe('10 m');
  });

  it('counts fixing after publishing that day only', () => {
    expect(t.after).toEqual({ actions: 2, sends: 1, ms: 5 * 60_000 });
  });

  it('gives time to the section of the item touched', () => {
    const by = Object.fromEntries(t.bySection.map((s) => [s.label, s.ms / 60_000]));
    expect(by.Notable).toBe(8);
    expect(by.Briefly).toBe(10); // capped: 12 minutes back to the last act, 10 at most
    expect(by['Review & send']).toBe(10); // 30 minutes after settings, capped too
  });
});

describe('issue timing reads who and what, not the sentence (v6, 2026-10-11)', () => {
  const e = (hhmm: string, kind: string, actor: string, summary: string, data?: Record<string, unknown>, anchor?: string): TimingEvent =>
    ({ at: at(hhmm), kind, actor, summary, anchor, data });
  const events: TimingEvent[] = [
    e('14:00', 'edit', 'jamie', 'Edited commentary — x', { fields: ['commentary'] }, 'link-flipcash'),
    // The write-back that followed is the service's, not his time.
    e('14:01', 'write', 'wt-builder', 'Write to Pinboard succeeded — x', { source: 'Pinboard', ms: 900 }, 'link-flipcash'),
    e('14:05', 'wand', 'jamie', 'Wand offered 3 drafts in 4.2 s — Intro', { wand: 'intro', outcome: 'offered', offered: 3, ms: 4_200 }, 'intro-1'),
    e('14:06', 'edit', 'jamie', "Used the wand's draft for body — Intro", { fields: ['body'], via: 'wand' }, 'intro-1'),
    e('14:08', 'wand', 'jamie', 'Draft failed: too busy — Echoes', { wand: 'echoes_section', outcome: 'failed', ms: 30_000 }, 'echoes'),
    e('14:09', 'source', 'jamie', 'Forked from Micro.blog — A post', { action: 'fork' }, 'journal-boat'),
    // A re-scan bringing in Jamie's bookmark edit is the source's.
    e('14:10', 'refreshed', 'source', 'Refreshed from Pinboard — x', undefined, 'link-flipcash'),
    // The sentence says "Send started" but the data says what it was: an override.
    e('14:12', 'send', 'jamie', 'Send started? No — Override — buttondown', { dest: 'buttondown', override: 'scheduled' }),
    e('14:14', 'send', 'jamie', 'Send started — website', { dest: 'website', action: 'start' }),
    e('14:15', 'issue', 'wt-builder', 'Published — WT350', { action: 'published' }),
  ];
  const t = issueTiming(events, doc);

  it('counts only what Jamie did, and finds the send and the publish by their data', () => {
    expect(t.actions).toBe(7);
    expect(t.edits).toBe(2);
    expect(t.publishedAt).toBe(at('14:15'));
    expect(t.sendMs).toBe(60_000);
  });

  it('counts the wands: presses, failures, picks used, and the time spent waiting', () => {
    expect(t.wands).toEqual({ calls: 2, failed: 1, used: 1, ms: 34_200 });
  });

  it('gives an act anchored to a section, or to the issue, to that part', () => {
    const sections = new Map(t.bySection.map((s) => [s.label, s.ms]));
    expect(sections.get('Echoes')).toBe(2 * 60_000);
    expect(sections.get('Journal')).toBe(60_000);
    expect(sections.get('Review & send')).toBe(5 * 60_000);
  });
});
