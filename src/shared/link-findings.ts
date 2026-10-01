/**
 * The issue's links, and what the last link check found for each.
 *
 * Pure, and on both sides: the server derives the "Links checked" readiness
 * unit and the send legs' dead-link gate from it, the client the inspector's
 * per-item findings and the Send card's override. The check itself, which
 * fetches, is src/server/link-check.ts.
 */

import type { IssueDoc, LinkResult } from './types.ts';
import { isIncluded, orderedNodes, windowOf } from './render/plan.ts';
import { linkUrl, urlsIn } from './links.ts';

export interface IssueLink {
  url: string;
  /** The items that print it, in reading order. */
  items: string[];
  /** item: an item's own link (Pinboard). inline: a link inside words Jamie wrote. */
  role: 'item' | 'inline';
}

/** Images are not links a reader clicks; the post-send verify checks them. */
function withoutImages(text: string | undefined): string {
  return String(text ?? '')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
}

/**
 * Every link the issue prints, in reading order: each Pinboard link's
 * rendered URL (the applied canonical, else the bookmark's) and every link
 * inside commentary or a body. A Journal post's own permalink is Jamie's
 * blog and is not checked; Thingy's items (Echoes' archive citations,
 * Membership) are the archive's links, not Jamie's picks.
 */
export function issueLinks(doc: IssueDoc): IssueLink[] {
  const w = windowOf(doc);
  const byUrl = new Map<string, IssueLink>();
  const note = (url: string, id: string, role: IssueLink['role']) => {
    if (!/^https?:\/\//i.test(url)) return;
    const found = byUrl.get(url);
    if (!found) byUrl.set(url, { url, items: [id], role });
    else {
      if (!found.items.includes(id)) found.items.push(id);
      if (role === 'item') found.role = 'item';
    }
  };
  for (const node of orderedNodes(doc)) {
    for (const id of node.items) {
      const item = doc.items[id];
      if (!item || !isIncluded(item, w) || item.authorship === 'Thingy') continue;
      if (item.type === 'pinboard_link') {
        const url = linkUrl(item);
        if (url) note(url, id, 'item');
      }
      for (const url of [...urlsIn(withoutImages(item.commentary)), ...urlsIn(withoutImages(item.body))]) {
        note(url, id, 'inline');
      }
    }
  }
  return [...byUrl.values()];
}

export interface LinkFinding extends IssueLink {
  result?: LinkResult;
}

export interface LinkFindings {
  links: LinkFinding[];
  dead: LinkFinding[];
  moved: LinkFinding[];
  unchecked: LinkFinding[];
  /** Never fetched: new since the last check, or no check yet. */
  pending: LinkFinding[];
  /** Dead, and not kept by Jamie: what the send legs ask about. */
  unaccepted: LinkFinding[];
  /** Dead or moved, and not kept by Jamie: what readiness counts. */
  open: LinkFinding[];
}

export function linkFindings(doc: IssueDoc): LinkFindings {
  const results = doc.link_check?.results ?? {};
  const accepted = new Set(doc.link_check?.accepted ?? []);
  const links = issueLinks(doc).map((l) => ({ ...l, result: results[l.url] }));
  const by = (v: LinkResult['verdict']) => links.filter((l) => l.result?.verdict === v);
  const dead = by('dead');
  const moved = by('moved');
  return {
    links,
    dead,
    moved,
    unchecked: by('unchecked'),
    pending: links.filter((l) => !l.result),
    unaccepted: dead.filter((l) => !accepted.has(l.url)),
    open: [...dead, ...moved].filter((l) => !accepted.has(l.url)),
  };
}

/** "2 dead, 1 moved" — the counts that are not fine, for a chip or a card. */
export function findingsSummary(f: LinkFindings): string {
  const dead = f.open.filter((l) => l.result?.verdict === 'dead').length;
  const moved = f.open.length - dead;
  const parts = [
    dead && `${dead} dead`,
    moved && `${moved} moved or shortened`,
    f.unchecked.length && `${f.unchecked.length} the site would not answer`,
    f.pending.length && `${f.pending.length} not checked yet`,
  ].filter(Boolean);
  return parts.join(', ');
}
