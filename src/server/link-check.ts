/**
 * The link check: fetch every link the issue prints and say what answered.
 *
 * Runs as each link arrives (src/server/arrival-check.ts: a sweep, an edit
 * that adds a link), on demand (`POST /api/issues/:id/links/check`, which no
 * button calls any more), and on its own before the website and email
 * legs, for any link not checked yet. Each fetch goes
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
import { linkKey, withoutTracking } from '../shared/links.ts';
import { downgrades, giftOf, issueLinks } from '../shared/link-findings.ts';
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
/** Whether a test handed in its own pages: offline, the check on arrival fetches only then. */
export function pagesHandedIn(): boolean {
  return pages !== fetchLink;
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

/**
 * Error codes that say the https address itself fails — a self-signed,
 * expired or misnamed certificate, or nothing listening on 443 — rather
 * than the page. bowlingalone.com's certificate is self-signed: its http
 * link is the right one.
 */
const HTTPS_FAILS = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL|EPROTO|ECONNREFUSED/;

const errorCode = (err: unknown): string => {
  const e = err as { code?: string; cause?: { code?: string } };
  return String(e?.code ?? e?.cause?.code ?? '');
};

/**
 * A redirect to a sign-in, a subscription page or a consent wall is the site
 * not showing the page to a checker, not the page moving.
 */
const WALL = /\/(?:log-?in|sign-?in|sign-?up|subscribe|register|account|auth|consent|gdpr|paywall)(?:[/?.#]|$)/i;
function isWall(url: string, landed: string): boolean {
  try {
    const to = new URL(landed);
    if (/^(?:consent|guce)\./i.test(to.hostname)) return true;
    return WALL.test(to.pathname) && !WALL.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Whether the https address of an http link answers: `works` on a 2xx,
 * `fails` on a certificate or connection failure or a 404/410, undefined
 * when it would not say (a timeout, a 403).
 */
async function httpsOf(url: string, fetcher: Fetcher): Promise<LinkResult['https']> {
  const secure = url.replace(/^http:/i, 'https:');
  try {
    const got = await fetcher(secure);
    await got.discard();
    if (got.status >= 200 && got.status < 300) return 'works';
    return got.status === 404 || got.status === 410 ? 'fails' : undefined;
  } catch (err) {
    return HTTPS_FAILS.test(errorCode(err)) ? 'fails' : undefined;
  }
}

/** What one link answered. Never throws. */
export async function checkLink(url: string, fetcher: Fetcher = pages, now = () => new Date()): Promise<LinkResult> {
  const checked_at = now().toISOString();
  const shortened = SHORTENERS.has(hostOf(url));
  let got: Fetched;
  try {
    got = await fetcher(url);
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ENOTFOUND') {
      return { verdict: 'dead', note: 'no such host', checked_at };
    }
    // The https address fails: plain http is the right link when it works.
    if (/^https:/i.test(url) && HTTPS_FAILS.test(code)) {
      const plain = url.replace(/^https:/i, 'http:');
      try {
        const http = await fetcher(plain);
        await http.discard();
        if (http.status >= 200 && http.status < 300) {
          return {
            verdict: 'moved', status: http.status, suggestion: plain, https: 'fails',
            note: `the https address fails (${code}); http works`, checked_at,
          };
        }
      } catch {
        /* neither answers: the site would not say */
      }
      return { verdict: 'unchecked', https: 'fails', note: `the https address fails (${code})`, checked_at };
    }
    const e = err as { message?: string };
    return { verdict: 'unchecked', note: String(e?.message ?? err).slice(0, 160), checked_at };
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
  if (final_url && isWall(url, landed)) {
    await got.discard();
    return { verdict: 'unchecked', status, final_url, note: 'the site asks a checker to sign in or consent first', checked_at };
  }

  let hint: string | undefined;
  if (/html/i.test(got.contentType)) {
    hint = canonicalHint(await got.text().catch(() => ''), landed);
    // A site whose every page names its home page as canonical says nothing.
    if (hint && (linkKey(hint) === linkKey(landed) || isFrontPage(hint))) hint = undefined;
  } else {
    await got.discard();
  }

  // Only a different page is a finding (2026-10-04): not the same page with
  // tracking, `www.`, a trailing slash or https added, and never a canonical
  // or a redirect that drops https (WT352's "Plan mode is dead" named an
  // http:// github.io copy as its own).
  const fromHint = hint ? withoutTracking(hint) : undefined;
  const suggestion = [fromHint, withoutTracking(landed)].find((c) =>
    c !== undefined && linkKey(c) !== linkKey(url) && !downgrades(url, c));
  const https = /^http:/i.test(url) && !/^https:/i.test(landed) ? await httpsOf(url, fetcher) : undefined;
  return {
    verdict: suggestion ? 'moved' : 'ok',
    status,
    ...(final_url ? { final_url } : {}),
    ...(hint ? { canonical_hint: hint } : {}),
    ...(suggestion ? { suggestion } : {}),
    ...(https ? { https } : {}),
    ...(shortened ? { note: 'shortened' } : suggestion && suggestion === fromHint ? { note: "the page's own canonical" } : {}),
    checked_at,
  };
}

/** Every URL, `concurrency` at a time. */
export async function checkLinks(
  urls: string[], fetcher: Fetcher = pages, now = () => new Date(), concurrency = CONCURRENCY,
): Promise<Record<string, LinkResult>> {
  const out: Record<string, LinkResult> = {};
  const queue = [...new Set(urls)];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
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
    current.has(url) && (kept[url]?.verdict === 'dead' || kept[url]?.verdict === 'moved' || Boolean(giftOf(url))));
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
