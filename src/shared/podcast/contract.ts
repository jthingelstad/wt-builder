/**
 * The published contract with another.thingelstad.com.
 *
 * Another parses episode frontmatter with a deliberately minimal line-based
 * parser (its `lib/loadEpisodes.js`): `key: value` per line, no nesting,
 * symmetric quotes stripped, bare integers coerced to numbers, `true` and
 * `false` coerced to booleans, and `#` lines skipped as comments. Everything
 * emitted here survives exactly that parser, and `validate` refuses values
 * that would not. tests/podcast-contract.test.ts parses what this emits with
 * a copy of that parser, and checks the copy against the sibling checkout.
 *
 * Two derivations are mirrored from the parser rather than invented:
 * - the permalink and GUID use the date's **UTC** calendar day: a 7 PM
 *   Central date rolls to the next UTC day, and a GUID that disagreed with
 *   the one the parser computes would strand subscribers;
 * - the audio path's year is the same UTC year.
 *
 * Never emitted: duration, byte size, MIME type. Another derives them from
 * the mp3 at build time. Never changed: the permalink shape, the GUID scheme,
 * the uploads path. Apple, Spotify, Overcast and every subscriber's client
 * hold those (another.thingelstad.com/AGENTS.md, URL preservation).
 */

import { centralClock } from '../dates.ts';
import type { EpisodeDoc, Segment } from './types.ts';

export const SITE = 'https://another.thingelstad.com';

/** Slug from a title: kebab, the parser-safe alphabet, six words at most. */
export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
}

/** The UTC calendar parts of an ISO date: what the parser's Date sees. */
function utcParts(iso: string): { yyyy: string; mm: string; dd: string } {
  const d = new Date(iso);
  return {
    yyyy: String(d.getUTCFullYear()),
    mm: String(d.getUTCMonth() + 1).padStart(2, '0'),
    dd: String(d.getUTCDate()).padStart(2, '0'),
  };
}

/** Mirrors Another's computePermalink exactly, UTC and all. */
export function permalink(dateIso: string, slug: string): string {
  const { yyyy, mm, dd } = utcParts(dateIso);
  return `/${yyyy}/${mm}/${dd}/${slug}.html`;
}

export function guidFor(dateIso: string, slug: string): string {
  return `${SITE}${permalink(dateIso, slug)}`;
}

/**
 * An instant as Another's dates are written: Central wall clock with its
 * offset, `2025-10-05T18:48:44-05:00`. What mastering stamps.
 */
export function centralIso(ms: number): string {
  const w = centralClock(ms);
  const seconds = new Date(ms).getUTCSeconds();
  const wallMs = Date.UTC(w.y, w.mo - 1, w.d, w.hh, w.mm, seconds);
  const offset = Math.round((wallMs - Math.floor(ms / 1000) * 1000) / 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.hh)}:${pad(w.mm)}:${pad(seconds)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `00N-slug`: the episode file's name in content/episodes/, and its transcript's. */
export function episodeStem(number: number, slug: string): string {
  return `${String(number).padStart(3, '0')}-${slug}`;
}

/** `content/episodes/00N-`: any file here belongs to episode N. */
export function episodePrefix(number: number): string {
  return `content/episodes/${String(number).padStart(3, '0')}-`;
}

/** `uploads/YYYY/another-thing-N.mp3`: the enclosure's path, by UTC year. */
export function audioRepoPath(number: number, dateIso: string): string {
  return `uploads/${utcParts(dateIso).yyyy}/another-thing-${number}.mp3`;
}

/**
 * A frontmatter value the minimal parser reads back unchanged. Quotes
 * protect a value that is itself wrapped in quotes, and edge whitespace.
 * The parser strips one matching pair from the ends and reads no escapes,
 * so a double-quoted value comes back exactly, whatever quotes are inside.
 * Nothing protects a newline, a bare number or `true`/`false`: the parser
 * strips the quotes before it coerces, so `validate` refuses those instead.
 */
function fmValue(value: string): string {
  return /^["'].*["']$/.test(value) || /^\s|\s$/.test(value) ? `"${value}"` : value;
}

/** "Mentioned in this episode": the segments' links, deduped, in order. */
export function mentionedSection(segments: Segment[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const seg of segments) {
    for (const link of seg.links) {
      if (!link.url || seen.has(link.url)) continue;
      seen.add(link.url);
      lines.push(`- [${(link.text || link.url).replace(/([[\]])/g, '\\$1')}](${link.url})`);
    }
  }
  if (!lines.length) return '';
  return `## Mentioned in this episode\n\n${lines.join('\n')}`;
}

/** The episode's Markdown file, exactly as Another expects to parse it. */
export function episodeMarkdown(doc: EpisodeDoc): string {
  const e = doc.episode;
  if (!e.date) throw new Error('the episode has no date: it is stamped when the recording is mastered');

  const stem = episodeStem(e.number, e.slug);
  const fm: string[] = ['---'];
  fm.push(`title: ${fmValue(e.title)}`);
  fm.push(`number: ${e.number}`);
  fm.push(`slug: ${e.slug}`);
  fm.push(`date: ${e.date}`);
  fm.push(`audio: /${audioRepoPath(e.number, e.date)}`);
  if (doc.transcript?.trim()) fm.push(`transcript: ${stem}.txt`);
  fm.push(`summary: ${fmValue(e.summary)}`);
  fm.push(`guid: ${guidFor(e.date, e.slug)}`);
  fm.push('guidIsPermalink: true');
  if (e.explicit) fm.push('explicit: true');
  fm.push('---');

  const body = [String(doc.show_notes ?? '').trim(), mentionedSection(doc.segments)]
    .filter(Boolean)
    .join('\n\n');

  return `${fm.join('\n')}\n\n${body}\n`;
}

/** The transcript: plain text, paragraphs on blank lines. */
export function transcriptText(doc: EpisodeDoc): string {
  return `${String(doc.transcript ?? '').trim()}\n`;
}

/** The text files a send commits, beside the mp3. */
export function packageTextFiles(doc: EpisodeDoc): { path: string; content: string }[] {
  const stem = episodeStem(doc.episode.number, doc.episode.slug);
  const files = [{ path: `content/episodes/${stem}.md`, content: episodeMarkdown(doc) }];
  if (doc.transcript?.trim()) files.push({ path: `content/episodes/${stem}.txt`, content: transcriptText(doc) });
  return files;
}

export interface Problem {
  severity: 'blocks' | 'warns';
  text: string;
}

/**
 * Can this episode be packaged for Another's parser and feed? A blocking
 * problem would make a file the parser misreads or a feed entry that
 * misleads subscribers; a warning is editorial. The send refuses a blocking
 * problem and says the warnings.
 */
export function validate(doc: EpisodeDoc): Problem[] {
  const out: Problem[] = [];
  const e = doc.episode;
  const blocks = (text: string) => out.push({ severity: 'blocks', text });
  const warns = (text: string) => out.push({ severity: 'warns', text });

  if (!e.title.trim()) blocks('The episode has no title.');
  if (/[\r\n]/.test(e.title) || /[\r\n]/.test(e.summary)) {
    blocks('The title and summary are single lines in the frontmatter; neither can hold a line break.');
  }
  for (const [name, value] of [['title', e.title], ['summary', e.summary]] as const) {
    if (/^-?\d+$/.test(value.trim()) || ['true', 'false'].includes(value.trim())) {
      blocks(`A ${name} of "${value.trim()}" would be read as a ${/\d/.test(value) ? 'number' : 'yes/no'} by Another's parser.`);
    }
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.slug)) {
    blocks(`The slug "${e.slug}" is not parser-safe: lowercase words joined by hyphens.`);
  }
  if (/^\d+-/.test(e.slug)) blocks('The slug must not start with a number: the file name carries the number.');
  if (!Number.isInteger(e.number) || e.number < 1) blocks('The episode needs a positive whole number.');
  if (!e.date) blocks('The episode has no date. It is stamped when the recording is mastered.');
  else if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(e.date) || Number.isNaN(Date.parse(e.date))) {
    blocks('The date must be a full date and time with an offset: the GUID comes from its UTC day.');
  }
  if (!doc.audio) blocks('No mastered audio. Drop the edited recording first.');
  if (!e.summary.trim()) warns('No summary. It is the feed entry and the episode page description.');
  if (!doc.transcript?.trim()) warns('No transcript. The episode can go without one; it reads better with one.');
  else if (doc.transcript_stale) warns('The transcript was written before the recording was mastered again: transcribe again, or read it against the new take.');
  if (!doc.show_notes?.trim()) warns('No show notes. The episode page would be only the link list.');
  return out;
}
