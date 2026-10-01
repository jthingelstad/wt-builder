/**
 * The link check: fetch every link the issue prints and say what answered.
 *
 * Runs on demand (`POST /api/issues/:id/links/check`) and on its own before
 * the website and email legs, for any link not checked yet. Each fetch goes
 * through fetchPublic, so the same public-address rules as the link wand
 * apply at every hop. Results are stored on the issue by exact URL
 * (`link_check`), applied to a fresh read (`savedFresh`), and read back
 * through src/shared/link-findings.ts.
 *
 * Warn, don't block (Jamie, 2026-09-29): a dead link is a readiness warning
 * and one confirm on the Send card; `?force=1` sends anyway and records the
 * links as accepted, so a re-send does not ask again. A site that turns
 * checkers away (403, 429, 5xx, a timeout) is "unchecked", never "dead".
 *
 * Nothing here rewrites a link. A suggestion is applied to the rendered link
 * only when Jamie clicks it (`canonical_url`); `source_url` is the Pinboard
 * key and changes only with "Move bookmark", which moves the bookmark too.
 */

import type { IssueDoc, LinkResult } from '../shared/types.ts';
import { hasTracking, linkKey, withoutTracking } from '../shared/links.ts';
import { issueLinks } from '../shared/link-findings.ts';
import { fetchPublicFollow, readCapped } from './integrations/page.ts';
import { OFFLINE } from './config.ts';

/** Hosts that only redirect. A link through one is always worth resolving. */
export const SHORTENERS = new Set([
  't.co', 'bit.ly', 'buff.ly', 'ow.ly', 'tinyurl.com', 'wapo.st', 'nyti.ms', 'trib.al', 'dlvr.it',
  'ift.tt', 'lnkd.in', 'apple.co', 'amzn.to', 'amzn.eu', 'a.co', 'goo.gl', 'youtu.be', 'bbc.in',
  'econ.st', 'reut.rs', 'cnb.cx', 'flip.it', 'tcrn.ch', 'zpr.io', 'hubs.ly', 'is.gd', 'rebrand.ly',
]);

/** A link's page as the check sees it. Tests hand in their own. */
export interface Fetched {
  status: number;
  /** Where the last hop answered from. */
  url: string;
  contentType: string;
  text(): Promise<string>;
  discard(): Promise<void>;
}
export type Fetcher = (url: string) => Promise<Fetched>;

const USER_AGENT = 'Mozilla/5.0 (Macintosh) WT-Builder/1.0 (+https://weekly.thingelstad.com)';
/** The canonical tag is in the head; this much is enough to find it. */
const HEAD_BYTES = 400_000;
const CONCURRENCY = 6;

export const fetchLink: Fetcher = async (url) => {
  // Tests and the browser suite run offline: nothing leaves this machine,
  // so every link reads as unchecked unless a test hands in its own pages.
  if (OFFLINE) throw new Error('offline — nothing leaves this machine');
  const { response, url: final } = await fetchPublicFollow(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    signal: AbortSignal.timeout(15_000),
  });
  return {
    status: response.status,
    url: final,
    contentType: response.headers.get('content-type') ?? '',
    text: () => readCapped(response, HEAD_BYTES),
    discard: async () => { await response.body?.cancel().catch(() => {}); },
  };
};

let pages: Fetcher = fetchLink;
/** Tests hand in their own pages; null goes back to the network. */
export function usePages(fetcher: Fetcher | null): void {
  pages = fetcher ?? fetchLink;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};
/** The site's front page: no path and no query (`/?p=123` is a page). */
const isFrontPage = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, '') === '' && !u.search;
  } catch {
    return false;
  }
};

/** The page's own `<link rel="canonical" href>`, absolute, or undefined. */
export function canonicalHint(html: string, base: string): string | undefined {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?[^"'>]*\bcanonical\b/i.test(tag)) continue;
    const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const href = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').replace(/&amp;/g, '&').trim();
    if (!href) continue;
    try {
      const url = new URL(href, base);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
      /* a broken tag says nothing */
    }
  }
  return undefined;
}

/** What one link answered. Never throws. */
export async function checkLink(url: string, fetcher: Fetcher = pages, now = () => new Date()): Promise<LinkResult> {
  const checked_at = now().toISOString();
  const shortened = SHORTENERS.has(hostOf(url));
  let got: Fetched;
  try {
    got = await fetcher(url);
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string }; message?: string };
    if ((e.code ?? e.cause?.code) === 'ENOTFOUND') {
      return { verdict: 'dead', note: 'no such host', checked_at };
    }
    return { verdict: 'unchecked', note: String(e.message ?? err).slice(0, 160), checked_at };
  }
  const { status } = got;
  const final_url = got.url && got.url !== url ? got.url : undefined;
  if (status === 404 || status === 410) {
    await got.discard();
    return { verdict: 'dead', status, ...(final_url ? { final_url } : {}), checked_at };
  }
  if (status < 200 || status >= 300) {
    await got.discard();
    return {
      verdict: 'unchecked', status, ...(final_url ? { final_url } : {}),
      note: status === 403 || status === 429 || status === 401 ? 'the site turns checkers away' : `answered ${status}`,
      checked_at,
    };
  }

  const landed = got.url || url;
  // A dead article that redirects to the site's front page answers 200.
  if (isFrontPage(landed) && !isFrontPage(url)) {
    await got.discard();
    return { verdict: 'dead', status, final_url: landed, note: "redirects to the site's front page", checked_at };
  }

  let hint: string | undefined;
  if (/html/i.test(got.contentType)) {
    hint = canonicalHint(await got.text().catch(() => ''), landed);
    // A site whose every page names its home page as canonical says nothing.
    if (hint && (linkKey(hint) === linkKey(landed) || isFrontPage(hint))) hint = undefined;
  } else {
    await got.discard();
  }

  const suggestion = withoutTracking(hint ?? landed);
  const moved = linkKey(suggestion) !== linkKey(url) || hasTracking(url);
  return {
    verdict: moved ? 'moved' : 'ok',
    status,
    ...(final_url ? { final_url } : {}),
    ...(hint ? { canonical_hint: hint } : {}),
    ...(moved ? { suggestion } : {}),
    ...(shortened ? { note: 'shortened' } : hint && moved ? { note: "the page's own canonical" } : {}),
    checked_at,
  };
}

/** Every URL, CONCURRENCY at a time. */
export async function checkLinks(
  urls: string[], fetcher: Fetcher = pages, now = () => new Date(),
): Promise<Record<string, LinkResult>> {
  const out: Record<string, LinkResult> = {};
  const queue = [...new Set(urls)];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      out[url] = await checkLink(url, fetcher, now);
    }
  }));
  return out;
}

/**
 * The results applied to a document: merged by URL over the last check, and
 * pruned to the links the issue prints now. Pure; the route hands it a fresh
 * read (savedFresh).
 */
export function applyLinkCheck(doc: IssueDoc, results: Record<string, LinkResult>, at: string): IssueDoc {
  const current = new Set(issueLinks(doc).map((l) => l.url));
  const merged = { ...(doc.link_check?.results ?? {}), ...results };
  const kept = Object.fromEntries(Object.entries(merged).filter(([url]) => current.has(url)));
  const accepted = (doc.link_check?.accepted ?? []).filter((url) =>
    current.has(url) && (kept[url]?.verdict === 'dead' || kept[url]?.verdict === 'moved'));
  return { ...doc, link_check: { at, results: kept, ...(accepted.length ? { accepted } : {}) } };
}

/**
 * Links Jamie keeps as they are: dead ones sent anyway (`?force=1`), or a
 * finding dismissed with "Keep this link". Neither the send nor readiness
 * asks about them again until a check finds something new.
 */
export function acceptLinks(doc: IssueDoc, urls: string[]): IssueDoc {
  const accepted = [...new Set([...(doc.link_check?.accepted ?? []), ...urls])];
  return { ...doc, link_check: { at: doc.link_check?.at ?? new Date().toISOString(), results: doc.link_check?.results ?? {}, accepted } };
}
