/**
 * The Made in card's numbers (design D, Jamie 2026-10-04), worked out apart
 * from the markup so a test can hold them: the four stats, the one stacked
 * bar of where the time went, and a tile per day.
 *
 * The card is meant to be shared, so nothing here carries a clock time —
 * only each Central day's total (Jamie, 2026-10-04). The weekday of the send
 * is the latest anything here gets to "when".
 */

import { wallClock, weekday } from '../shared/dates.ts';
import { duration, type IssueTiming } from '../shared/timing.ts';

export interface MadeInStat { value: string; label: string }
export interface MadeInSegment { label: string; ms: number; time: string; color: string }
export interface MadeInTile { day: string; dow: string; time: string; shade: string; dark: boolean; added: string; title: string }

export interface MadeIn {
  eyebrow: string;
  /** Against the Builder issue before, or null when there is none to beat. */
  comparison: { text: string; less: boolean } | null;
  stats: MadeInStat[];
  segments: MadeInSegment[];
  tiles: MadeInTile[];
  footnote: string;
}

/** Darkest first; "Everything else" always takes the last, palest one. */
const SEGMENT_COLORS = ['var(--made-1)', 'var(--green)', 'var(--made-3)', 'var(--made-4)', 'var(--made-5)'];
const REST_COLOR = 'var(--green-4)';
const TOP = 5;

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six'];
const word = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** A sitting of one act has no length; "0 m" reads as nothing happened. */
export const time = (ms: number) => (ms < 60_000 ? '<1 m' : duration(ms));

/** A tile is small: "1h45", "9 m", "<1 m". */
function tileTime(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (ms < 60_000) return '<1 m';
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} m`;
}

/** Darker is longer: an hour, five minutes, two, anything; a day with no sitting stays neutral. */
function shade(ms: number, sittings: number): { shade: string; dark: boolean } {
  if (!sittings) return { shade: 'var(--app)', dark: false };
  const m = ms / 60_000;
  if (m >= 60) return { shade: 'var(--made-1)', dark: true };
  if (m >= 5) return { shade: 'var(--made-3)', dark: true };
  if (m >= 2) return { shade: 'var(--made-4)', dark: false };
  return { shade: 'var(--made-6)', dark: false };
}

/**
 * Where the time went: the five largest parts, then the rest as one. "Other"
 * (acts no item claims) always goes in with the rest — beside "Everything
 * else" it would be two names for the same thing.
 */
function segments(bySection: IssueTiming['bySection']): MadeInSegment[] {
  const named = bySection.filter((s) => s.ms > 0 && s.label !== 'Other');
  const other = bySection.filter((s) => s.ms > 0 && s.label === 'Other');
  const top = named.slice(0, TOP);
  const rest = [...named.slice(TOP), ...other];
  const out: MadeInSegment[] = top.map((s, i) => ({ label: s.label, ms: s.ms, time: time(s.ms), color: SEGMENT_COLORS[i]! }));
  const restMs = rest.reduce((n, s) => n + s.ms, 0);
  if (rest.length === 1 && rest[0]!.label !== 'Other') {
    out.push({ label: rest[0]!.label, ms: restMs, time: time(restMs), color: REST_COLOR });
  } else if (restMs > 0) {
    out.push({ label: 'Everything else', ms: restMs, time: time(restMs), color: REST_COLOR });
  }
  return out;
}

export function madeIn(input: {
  number: number;
  timing: IssueTiming;
  previous: { number: number; timing: IssueTiming } | null;
  /** The readiness strip's pills: how many, and how many are done. */
  pills: { done: number; total: number } | null;
  /** Send legs sent, of how many. */
  legs: { sent: number; total: number };
}): MadeIn {
  const { timing: t, previous, pills, legs } = input;
  const total = t.activeMs + t.after.ms;
  const sent = Boolean(t.publishedAt);

  let comparison: MadeIn['comparison'] = null;
  const p = previous?.timing;
  if (previous && p && p.actions) {
    const delta = total - (p.activeMs + p.after.ms);
    comparison = Math.abs(delta) < 60_000
      ? { text: `the same time as WT${previous.number}`, less: true }
      : delta < 0
        ? { text: `${duration(-delta)} less than WT${previous.number}`, less: true }
        : { text: `${duration(delta)} more than WT${previous.number}`, less: false };
  }

  const days = t.byDay.filter((d) => d.sittings).length;
  const stats: MadeInStat[] = [
    { value: duration(total), label: days === 1 ? 'writing, in one day' : `writing, over ${days} days` },
    { value: String(t.sessions.length), label: plural(t.sessions.length, 'sitting') },
  ];
  if (pills && pills.total) {
    stats.push(pills.done === pills.total
      ? { value: String(pills.total), label: 'pills, all done' }
      : { value: String(pills.total), label: `pills, ${pills.done} done` });
  }
  if (sent && t.sendMs !== undefined) {
    stats.push({
      value: time(t.sendMs),
      label: legs.sent === legs.total ? `to send all ${word(legs.total)}` : `to send ${word(legs.sent)} of ${word(legs.total)}`,
    });
  } else {
    stats.push({ value: `${legs.sent} of ${legs.total}`, label: legs.sent ? 'sent so far' : 'not sent yet' });
  }

  const tiles: MadeInTile[] = t.byDay.map((d) => {
    const dow = d.label.slice(0, 3);
    const s = shade(d.ms, d.sittings);
    const title = [
      d.label,
      d.sittings ? `${d.sittings} ${plural(d.sittings, 'sitting')}, ${time(d.ms)}` : 'no sitting',
      d.added ? `${d.added} arrived` : '',
    ].filter(Boolean).join(' · ');
    return { day: d.day, dow, time: d.sittings ? tileTime(d.ms) : '', ...s, added: d.added ? `+${d.added}` : '', title };
  });

  // What happened after it went, said once and quietly at the end. A
  // non-breaking hyphen: Safari broke the line at "re-|send".
  const after = t.after.ms >= 60_000 ? `, and ${duration(t.after.ms)} fixing after it went`
    : t.after.sends ? `, with ${word(t.after.sends)} ${plural(t.after.sends, 're\u2011send')} after it went`
      : ', with nothing to fix after it went';
  const sendDay = wallClock(t.publishedAt);
  const footnote = sent && sendDay
    ? `Gold numbers are the links and posts that arrived that day; ${weekday(sendDay)} turned them into an issue${after}.`
    : 'Gold numbers are the links and posts that arrived that day. It has not gone out yet.';

  return {
    eyebrow: `${sent ? 'WHAT IT TOOK' : 'WHAT IT HAS TAKEN SO FAR'} · THE WEEKLY THING ${input.number}`,
    comparison,
    stats,
    segments: segments(t.bySection),
    tiles,
    footnote,
  };
}
