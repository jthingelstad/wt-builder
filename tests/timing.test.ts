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
