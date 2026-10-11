/**
 * The Stats view's "What's in it" and "Across issues" cards, worked out
 * apart from the markup so a test can hold them, as made-in.ts does for
 * Made in. The server counts (src/server/issue-stats.ts); this says it.
 */

import type { AcrossRow, ContentStats } from '../shared/types.ts';
import { duration } from '../shared/timing.ts';
import { REST_COLOR, SEGMENT_COLORS, type MadeInStat } from './made-in.ts';

export const num = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
/** A podcast's length in whole minutes: "17 m". */
export const listen = (seconds: number) => duration(seconds * 1000);

export interface Share { label: string; value: number; text: string; color: string }
export interface Count { label: string; value: number; share: number }

export interface InIt {
  eyebrow: string;
  stats: MadeInStat[];
  /** Where the words are: the five largest sections, then the rest. */
  words: Share[];
  domains: Count[];
  sources: Count[];
}

/** Counts as rows of a little bar chart: each against the largest. */
function counts(rows: { label: string; value: number }[]): Count[] {
  const top = Math.max(1, ...rows.map((r) => r.value));
  return rows.map((r) => ({ ...r, share: r.value / top }));
}

export function whatsInIt(number: number, c: ContentStats): InIt {
  const stats: MadeInStat[] = [
    { value: num(c.words), label: `words, ${c.reading_minutes} ${plural(c.reading_minutes, 'minute')} to read` },
    { value: String(c.links), label: c.links ? `${plural(c.links, 'link')}, ${c.new_links === c.links ? 'all' : c.new_links} new` : 'links' },
    { value: String(c.photos), label: plural(c.photos, 'photo') },
    c.audio_seconds
      ? { value: listen(c.audio_seconds), label: 'to listen to' }
      : { value: '—', label: 'no podcast yet' },
  ];

  const named = c.sections.filter((s) => s.words > 0).sort((a, b) => b.words - a.words);
  const top = named.slice(0, 5);
  const rest = named.slice(5);
  const words: Share[] = top.map((s, i) => ({ label: s.label, value: s.words, text: num(s.words), color: SEGMENT_COLORS[i]! }));
  const restWords = rest.reduce((n, s) => n + s.words, 0);
  if (rest.length === 1) words.push({ label: rest[0]!.label, value: restWords, text: num(restWords), color: REST_COLOR });
  else if (restWords) words.push({ label: 'Everything else', value: restWords, text: num(restWords), color: REST_COLOR });

  return {
    eyebrow: `WHAT'S IN IT · THE WEEKLY THING ${number}`,
    stats,
    words,
    domains: counts(c.domains.map((d) => ({ label: d.domain, value: d.links }))),
    sources: counts(c.sources.map((s) => ({ label: s.label, value: s.items }))),
  };
}

export type Tone = 'before' | 'builder' | 'this';
export interface Bar { number: number; value: number; tone: Tone; title: string }
export interface Strip {
  key: 'words' | 'links' | 'audio';
  kicker: string;
  /** Where this issue sits, in a sentence; null when it has no value. */
  says: string | null;
  bars: Bar[];
  max: number;
  /** This issue's place along the strip, 0–1, and its height, 0–1. */
  here: { at: number; height: number } | null;
}
export interface BuilderRow {
  number: number;
  current: boolean;
  made: string;
  words: string;
  links: string;
  listen: string;
}
export interface Across {
  eyebrow: string;
  strips: Strip[];
  /** The first issue of each year, along the strips (0–1). */
  years: { label: string; at: number }[];
  /** Every issue made in WT Builder, oldest first. */
  builder: BuilderRow[];
}

const UNIT: Record<Strip['key'], [string, (n: number) => string, string]> = {
  words: ['WORDS', num, 'words'],
  links: ['LINKS', String, 'links'],
  audio: ['MINUTES TO LISTEN', (s) => listen(s), ''],
};

function strip(key: Strip['key'], rows: AcrossRow[], number: number, value: (r: AcrossRow) => number | null): Strip {
  const [kicker, say, unit] = UNIT[key];
  const tone = (r: AcrossRow): Tone => (r.number === number ? 'this' : r.imported ? 'before' : 'builder');
  const valued = rows.map((r) => ({ r, v: value(r) })).filter((x): x is { r: AcrossRow; v: number } => x.v !== null);
  const max = Math.max(1, ...valued.map((x) => x.v));
  const bars: Bar[] = rows.map((r) => {
    const v = value(r) ?? 0;
    return { number: r.number, value: v, tone: tone(r), title: `WT${r.number} · ${r.publication_date.slice(0, 4)} · ${say(v)}${unit ? ` ${unit}` : ''}` };
  });

  const i = rows.findIndex((r) => r.number === number);
  const mine = i >= 0 ? value(rows[i]!) : null;
  let says: string | null = null;
  if (mine !== null) {
    const others = valued.filter((x) => x.r.number !== number).map((x) => x.v).sort((a, b) => a - b);
    const below = others.filter((v) => v < mine).length;
    const pct = others.length ? Math.round((below / others.length) * 100) : 0;
    const middle = others.length ? others[Math.floor(others.length / 2)]! : mine;
    const above = others.filter((v) => v > mine).length;
    const where = !above && others.length ? 'more than any other issue'
      : !below && others.length ? 'fewer than any other issue'
        : pct >= 50 ? `more than ${pct}% of issues` : `fewer than ${100 - pct}% of issues`;
    says = `${say(mine)}${unit ? ` ${unit}` : ''} · ${where} · the middle issue has ${say(middle)}`;
  }
  return {
    key, kicker, says, bars, max,
    here: i >= 0 && mine !== null ? { at: (i + 0.5) / rows.length, height: mine / max } : null,
  };
}

export function acrossIssues(number: number, rows: AcrossRow[]): Across {
  const first = rows[0]?.number ?? number;
  const last = rows.at(-1)?.number ?? number;
  const years: Across['years'] = [];
  rows.forEach((r, i) => {
    const y = r.publication_date.slice(0, 4);
    if (years.at(-1)?.label !== y) years.push({ label: y, at: i / rows.length });
  });
  const builder: BuilderRow[] = rows.filter((r) => !r.imported).map((r) => ({
    number: r.number,
    current: r.number === number,
    made: r.built_ms ? duration(r.built_ms) : '—',
    words: num(r.words),
    links: `${r.links} (${r.new_links} new)`,
    listen: r.audio_seconds ? listen(r.audio_seconds) : '—',
  }));
  return {
    eyebrow: `ACROSS ISSUES · WT${first}–WT${last}`,
    strips: [
      strip('words', rows, number, (r) => r.words),
      strip('links', rows, number, (r) => r.links),
      strip('audio', rows, number, (r) => r.audio_seconds),
    ],
    years,
    builder,
  };
}
