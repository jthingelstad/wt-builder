/**
 * The Stats view's "What's in it" and "Across issues" cards (Jamie,
 * 2026-10-11): what an issue holds, and where it sits among every issue
 * since WT1.
 *
 * One measure for both eras. Every number is read from the website edition
 * as `renderWebsite` prints it: a WT Builder issue from its items, a
 * pre-Builder one from the published body it was imported as. That body is
 * counted, never parsed into items (AGENTS.md, Guardrails). So a word in
 * WT120 and a word in WT353 are the same kind of word.
 *
 * Pure but for the podcast lengths of issues made before WT Builder, which
 * are read from the archive pages' front matter in the sibling
 * weekly.thingelstad.com checkout (as backfill.ts does).
 */

import { readFileSync } from 'node:fs';

import type { AcrossRow, ContentStats, IssueDoc } from '../shared/types.ts';

export type { AcrossRow, ContentStats };
import { lastSent } from '../shared/sends.ts';
import { nodeBlocks, planEdition, renderWebsite } from '../shared/render/index.ts';
import { linkKey, urlsIn } from '../shared/links.ts';
import { ARCHIVE_DIR, frontMatter } from './backfill.ts';

/** Words a minute, for the reading time: a common figure for prose read on a screen. */
export const READING_WPM = 238;

/**
 * The words a reader reads: no URLs, no image markup (alt text is for a
 * reader who cannot see the picture, not read beside it), no HTML tags. A
 * word is a run that starts with a letter or digit, so "—" and "·" are not.
 */
export function wordsIn(markdown: string): number {
  const text = String(markdown ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ');
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.\-]*/gu) ?? []).length;
}

/** Pictures in the edition: Markdown images and `<img>` tags alike. */
export function photosIn(markdown: string): number {
  return (String(markdown ?? '').match(/!\[[^\]]*\]\(|<img\b/gi) ?? []).length;
}

/** A link key's site, without `www.`: `github.com`. */
export const siteOf = (key: string) => key.split('/')[0]!.replace(/^www\./, '');

/**
 * Jamie's own sites (the ones in shared/sites.json, all on thingelstad.com)
 * are where the issue lives, not where it points; nor is a picture, or the
 * full-size copy a photo links to.
 */
const own = (key: string) =>
  /(^|\.)thingelstad\.com$/.test(siteOf(key))
  || /(^|\.)uploads\.micro\.blog$/.test(siteOf(key))
  || /\.(?:jpe?g|png|gif|webp|heic|avif)$/i.test(key);

/**
 * The links the edition printed that point off Jamie's own sites. Read from
 * the printed text with its images taken out first: a photo's address is
 * not a link, and WT100's forty photo posts counted as forty links.
 */
export function outboundKeys(edition: string): string[] {
  const text = String(edition ?? '')
    .replace(/!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g, ' ')
    .replace(/<img\b[^>]*>/gi, ' ');
  const keys = new Set<string>();
  for (const url of urlsIn(text)) {
    const key = linkKey(url);
    if (key && !own(key)) keys.add(key);
  }
  return [...keys];
}

/** A legacy issue's podcast length, from its archive page; null when it has none. */
function archivedAudioSeconds(number: number): number | null {
  try {
    const v = Number(frontMatter(readFileSync(`${ARCHIVE_DIR}${number}.md`, 'utf8')).get('audio_duration_seconds'));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** The podcast's length: the last send's record, else the archive page's. */
export function audioSecondsOf(doc: IssueDoc): number | null {
  const sent = Number(lastSent(doc.sends?.podcast)?.audio?.audio_duration_seconds);
  if (Number.isFinite(sent) && sent > 0) return sent;
  return archivedAudioSeconds(doc.issue.number);
}

const SOURCE_ORDER = ['Pinboard', 'Micro.blog', 'Written here', 'Thingy'] as const;

/** What one issue holds, apart from how new its links are (that needs the others). */
interface Measured {
  updated_at: string;
  words: number;
  photos: number;
  keys: string[];
  audio_seconds: number | null;
}

/** Measured once per saved version: an issue's numbers change only when it is saved. */
const measured = new Map<string, Measured>();

export function measure(row: { id: string; updated_at: string; doc: IssueDoc }): Measured {
  const hit = measured.get(row.id);
  if (hit && hit.updated_at === row.updated_at) return hit;
  const edition = renderWebsite(row.doc);
  const m: Measured = {
    updated_at: row.updated_at,
    words: wordsIn(edition),
    photos: photosIn(edition),
    keys: outboundKeys(edition),
    audio_seconds: audioSecondsOf(row.doc),
  };
  measured.set(row.id, m);
  return m;
}

type Row = { id: string; number: number; publication_date: string; status: string; updated_at: string; doc: IssueDoc };

/**
 * The links of every published issue before this one, by the rule "Linked
 * before" uses: published, and dated before it.
 */
function earlierKeys(doc: IssueDoc, rows: Row[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.status !== 'published' || r.number === doc.issue.number || r.publication_date >= doc.issue.publication_date) continue;
    for (const k of measure(r).keys) keys.add(k);
  }
  return keys;
}

export function contentStats(row: Row, rows: Row[]): ContentStats {
  const { doc } = row;
  const m = measure(row);
  const earlier = earlierKeys(doc, rows);

  const counts = new Map<string, number>();
  for (const k of m.keys) counts.set(siteOf(k), (counts.get(siteOf(k)) ?? 0) + 1);
  const domains = [...counts]
    .map(([domain, links]) => ({ domain, links }))
    .sort((a, b) => b.links - a.links || a.domain.localeCompare(b.domain))
    .slice(0, 5);

  const sections: ContentStats['sections'] = [];
  const bySource = new Map<string, number>();
  if (!doc.issue.imported) {
    for (const planned of planEdition(doc, 'website')) {
      sections.push({
        label: planned.node.label,
        words: wordsIn(nodeBlocks(planned, doc.issue.number).join('\n\n')),
        items: planned.items.length,
      });
      for (const { item } of planned.items) {
        const label = item.authorship === 'Thingy' ? 'Thingy'
          : item.source === 'Pinboard' ? 'Pinboard'
            : item.source === 'Micro.blog' ? 'Micro.blog'
              : 'Written here';
        bySource.set(label, (bySource.get(label) ?? 0) + 1);
      }
    }
  }

  return {
    words: m.words,
    reading_minutes: Math.max(1, Math.round(m.words / READING_WPM)),
    links: m.keys.length,
    new_links: m.keys.filter((k) => !earlier.has(k)).length,
    photos: m.photos,
    audio_seconds: m.audio_seconds,
    sections,
    sources: SOURCE_ORDER.filter((l) => bySource.get(l)).map((label) => ({ label, items: bySource.get(label)! })),
    domains,
  };
}

/**
 * Every issue, oldest first, measured alike. New links in one pass: the
 * links of the published issues read so far are the ones carried before.
 */
export function acrossIssues(rows: Row[], builtMs: (row: Row) => number | undefined): AcrossRow[] {
  const carried = new Set<string>();
  return [...rows]
    .sort((a, b) => a.publication_date.localeCompare(b.publication_date) || a.number - b.number)
    .map((r) => {
      const m = measure(r);
      const built = r.doc.issue.imported ? undefined : builtMs(r);
      const fresh = m.keys.filter((k) => !carried.has(k)).length;
      if (r.status === 'published') for (const k of m.keys) carried.add(k);
      return {
        number: r.number,
        publication_date: r.publication_date,
        imported: Boolean(r.doc.issue.imported),
        words: m.words,
        links: m.keys.length,
        new_links: fresh,
        photos: m.photos,
        audio_seconds: m.audio_seconds,
        ...(built ? { built_ms: built } : {}),
      };
    });
}
