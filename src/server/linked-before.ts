/**
 * "Linked before in WT274": has this exact link been in an earlier issue?
 *
 * Read from this service's own records, not from the Librarian and not from
 * the sibling librarian-thing checkout. Every issue since WT1 is here — the
 * pre-Builder ones imported from the archive's canonical text as one
 * published body each, WT350 on as items — and the record is current the
 * moment an issue is sent, while the archive leg lands on GitHub and the
 * local checkout only catches up when someone pulls it. `/retrieve` has no
 * link lookup (contract 4.12). See docs/decisions.md.
 *
 * Pure: the route hands in the rows.
 */

import type { IssueDoc, LinkedBefore } from '../shared/types.ts';
import { isIncluded, windowOf } from '../shared/render/plan.ts';
import { linkKey, urlsIn } from '../shared/links.ts';

export type { LinkedBefore };
/** One key per link: src/shared/links.ts, shared by contract with the Librarian. */
export { linkKey };

/**
 * The links an issue printed, as keys. An item held out of every edition or
 * outside the window was never in the issue, and Thingy's own items (Echoes'
 * archive citations, Membership) are not links Jamie chose.
 */
export function issueLinkKeys(doc: IssueDoc): Set<string> {
  const keys = new Set<string>();
  const w = windowOf(doc);
  for (const item of Object.values(doc.items ?? {})) {
    if (!item || !isIncluded(item, w) || item.authorship === 'Thingy') continue;
    const urls = [
      ...(item.source_url ? [item.source_url] : []),
      ...urlsIn(item.title ?? ''),
      ...urlsIn(item.body ?? ''),
      ...urlsIn(item.commentary ?? ''),
    ];
    for (const url of urls) {
      const key = linkKey(url);
      if (key) keys.add(key);
    }
  }
  return keys;
}

/**
 * The published issues before this one that carried this exact link, newest
 * first. The issue being drafted, and anything dated on or after it, is
 * never an earlier issue.
 */
export function linkedBefore(
  url: string,
  current: { number: number; publication_date: string },
  rows: { number: number; publication_date: string; status: string; doc: IssueDoc }[],
): LinkedBefore[] {
  const key = linkKey(url);
  if (!key) return [];
  return rows
    .filter((r) => r.status === 'published' && r.number !== current.number && r.publication_date < current.publication_date)
    .filter((r) => issueLinkKeys(r.doc).has(key))
    .map((r) => ({ number: r.number, publication_date: r.publication_date }))
    .sort((a, b) => b.publication_date.localeCompare(a.publication_date) || b.number - a.number);
}

/** "WT274 (2024-01-27)", newest first, at most `max` of them, then how many more. */
export function linkedBeforeText(found: LinkedBefore[], max = 5): string {
  const shown = found.slice(0, max).map((f) => `WT${f.number} (${f.publication_date})`).join(', ');
  const more = found.length - Math.min(found.length, max);
  return more ? `${shown}, and ${more} earlier` : shown;
}
