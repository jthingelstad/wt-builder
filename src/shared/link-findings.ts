/**
 * The issue's links, and what the last link check found for each.
 *
 * Pure, and on both sides: the server derives the "Links checked" readiness
 * unit and the send legs' dead-link gate from it, the client the rows'
 * notes, the inspector's per-item findings, the Send view's one line and
 * the Send card's override. The check itself, which fetches, is
 * src/server/link-check.ts; it runs as each link arrives
 * (src/server/arrival-check.ts).
 */

import type { IssueDoc, LinkResult } from './types.ts';
import { isIncluded, orderedNodes, windowOf } from './render/plan.ts';
import { linkKey, linkUrl, urlsIn } from './links.ts';

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

/**
 * A paywalled site's gift link: a token in the query that lets a reader past
 * the paywall for as long as the gift lasts, and then not. The link check
 * cannot see it (the page answers 200 either way), so it is read off the URL.
 * Jamie, 2026-10-04: a Verge gift link in WT352 had expired a week before it
 * would have gone to readers, and nothing said so.
 */
export interface GiftLink {
  /** The query parameter that carries it. */
  param: string;
  /** When the token says it stops working (a JWT's `exp`), as an ISO instant. */
  expires?: string;
  expired?: boolean;
}

/** Gift parameters whose name says so, on any site. */
const GIFT_ANYWHERE = /^(?:gift|gift_?link|gift_?token|gift_?id|share_?token|view_token|unlocked_article_code|pwapi_token)$/i;

/** Gift parameters too generic to read as gifts except on the sites that use them. */
const GIFT_ON: Array<[RegExp, RegExp]> = [
  [/^accesstoken$/i, /(?:^|\.)(?:bloomberg\.com|ft\.com)$/],
  [/^st$/i, /(?:^|\.)(?:wsj\.com|barrons\.com)$/],
];

/** A JWT's `exp`, if the token is one. */
function jwtExpiry(token: string): number | undefined {
  const part = token.split('.')[1];
  if (!part || token.split('.').length !== 3) return undefined;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return typeof json?.exp === 'number' && Number.isFinite(json.exp) ? json.exp : undefined;
  } catch {
    return undefined;
  }
}

/** The gift a URL carries, or undefined. `now` is for tests. */
export function giftOf(url: string, now = Date.now()): GiftLink | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  for (const [name, value] of u.searchParams) {
    if (!value) continue;
    const gift = GIFT_ANYWHERE.test(name) || GIFT_ON.some(([p, h]) => p.test(name) && h.test(host));
    if (!gift) continue;
    const exp = jwtExpiry(value);
    if (exp === undefined) return { param: name };
    const ms = exp * 1000;
    // An `exp` no Date can hold is not an expiry anyone set.
    if (!Number.isFinite(new Date(ms).getTime()) || Math.abs(ms) > 8.64e15) return { param: name };
    return { param: name, expires: new Date(ms).toISOString(), expired: ms <= now };
  }
  return undefined;
}

export interface LinkFinding extends IssueLink {
  result?: LinkResult;
  gift?: GiftLink;
}

/** True when going from `from` to `to` would drop https: never suggested (WT352's "Plan mode is dead"). */
export function downgrades(from: string, to: string): boolean {
  return /^https:/i.test(from) && /^http:/i.test(to);
}

/**
 * Whether a check's suggestion is worth Jamie's attention: a different page
 * (not the same one with tracking, `www.`, a trailing slash, or https added),
 * and never one that drops https, unless the https address itself fails and
 * http works. Read again on every stored result, so a result kept from
 * before these rules says nothing it would not say now.
 */
export function worthSuggesting(url: string, r: LinkResult | undefined): boolean {
  if (!r?.suggestion) return false;
  if (r.https === 'fails' && downgrades(url, r.suggestion)) return true;
  if (downgrades(url, r.suggestion)) return false;
  return linkKey(r.suggestion) !== linkKey(url);
}

export type LinkAction = 'dead' | 'gift' | 'moved';

/**
 * What Jamie can act on in one link, or undefined (2026-10-04, after WT352:
 * "All of the link checking was really hard to work with"). Dead (404, 410,
 * no such host, a redirect to the front page), a gift link, or a real move
 * to another page. A site that would not answer (403, 429, 5xx, a timeout)
 * is nothing to act on, and is never marked.
 */
export function actionOf(f: Pick<LinkFinding, 'url' | 'result' | 'gift'>): LinkAction | undefined {
  if (f.gift) return 'gift';
  if (f.result?.verdict === 'dead') return 'dead';
  if (f.result?.verdict === 'moved' && worthSuggesting(f.url, f.result)) return 'moved';
  return undefined;
}

export interface LinkFindings {
  links: LinkFinding[];
  dead: LinkFinding[];
  /** Moved to another page, by actionOf's rule. */
  moved: LinkFinding[];
  /** The site would not say. Kept, and never marked. */
  unchecked: LinkFinding[];
  /** Never fetched: new since the last check, or no check yet. */
  pending: LinkFinding[];
  /** Dead, and not kept by Jamie: what the send legs ask about. */
  unaccepted: LinkFinding[];
  /** Gift links not kept by Jamie: read off the URL, checked or not. */
  gifts: LinkFinding[];
  /** Something to act on (actionOf), not kept by Jamie: what rows, readiness and the Send line say. */
  open: LinkFinding[];
}

export function linkFindings(doc: IssueDoc, now = Date.now()): LinkFindings {
  const results = doc.link_check?.results ?? {};
  const accepted = new Set(doc.link_check?.accepted ?? []);
  const links = issueLinks(doc).map((l) => {
    const gift = giftOf(l.url, now);
    return { ...l, result: results[l.url], ...(gift ? { gift } : {}) };
  });
  const dead = links.filter((l) => l.result?.verdict === 'dead');
  return {
    links,
    dead,
    moved: links.filter((l) => l.result?.verdict === 'moved' && worthSuggesting(l.url, l.result)),
    unchecked: links.filter((l) => l.result?.verdict === 'unchecked'),
    pending: links.filter((l) => !l.result),
    unaccepted: dead.filter((l) => !accepted.has(l.url)),
    gifts: links.filter((l) => l.gift && !accepted.has(l.url)),
    open: links.filter((l) => actionOf(l) && !accepted.has(l.url)),
  };
}

/** "A gift link (view_token) that expired Sep 29" — for a finding line. */
export function giftLine(gift: GiftLink): string {
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
  if (gift.expired) return `A gift link (${gift.param}) that expired ${day(gift.expires!)}: readers will hit the paywall.`;
  if (gift.expires) return `A gift link (${gift.param}) that expires ${day(gift.expires)}: after that, readers hit the paywall.`;
  return `A gift link (${gift.param}): readers get past the paywall only while the gift lasts.`;
}

/**
 * "2 dead, 1 moved to another page": what there is to act on, for a pill's
 * line. A site that would not answer, and a link not checked yet, are not
 * in it: neither is anything Jamie can do.
 */
export function findingsSummary(f: LinkFindings): string {
  const dead = f.open.filter((l) => actionOf(l) === 'dead').length;
  const moved = f.open.filter((l) => actionOf(l) === 'moved').length;
  const expired = f.gifts.filter((l) => l.gift!.expired).length;
  const gifts = f.gifts.length;
  const parts = [
    dead && `${dead} dead`,
    gifts && (expired ? `${gifts} gift link${gifts === 1 ? '' : 's'} (${expired} expired)` : `${gifts} gift link${gifts === 1 ? '' : 's'}`),
    moved && `${moved} moved to another page`,
  ].filter(Boolean);
  return parts.join(', ');
}
