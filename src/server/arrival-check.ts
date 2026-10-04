/**
 * The link and blocklist checks, run as each link arrives (plan before
 * WT353, item 1). Jamie, after WT352: "this link checking stuff in the send
 * page doesn't work at all.. at that point I'm about sending, not editing."
 * So a link is checked when a sweep or a sync brings it in, or when it is
 * typed into a body or commentary and saved, and what the check finds is the
 * row's note while he writes (src/shared/hints.ts). There is no button.
 *
 * In the background, never in the request that brought the link: `saved()`
 * in index.ts calls noteArrival, which only starts a timer. The fetches run
 * after it, and their results are applied to a fresh read, synchronously
 * (the rule for every handler that awaits the network: never save the copy
 * you read). Only what is owed is fetched: a link never checked, a domain
 * never looked up, and a link the site would not answer for, again after
 * RECHECK. One answer per URL serves every issue for a while (`cache`), so a
 * re-scan or a second issue linking the same page asks nothing.
 *
 * Polite: a few fetches at a time, after the edits have settled for a
 * moment. Offline (`WT_BUILDER_OFFLINE=1`) it is off, and a test that turns
 * it on hands in its own pages and answers; nothing leaves the machine.
 *
 * The send legs still check whatever is owed when they go (index.ts,
 * linksGate and domainsGate); with this running, that is mostly nothing.
 */

import type { DomainResult, IssueDoc, LinkResult } from '../shared/types.ts';
import { findingsSummary, linkFindings } from '../shared/link-findings.ts';
import { emailDomains, type EmailDomain } from '../shared/deliverability.ts';
import { applyLinkCheck, checkLinks, pagesHandedIn } from './link-check.ts';
import { applyDomainCheck, checkDomains, dnsHandedIn } from './domain-check.ts';
import { OFFLINE } from './config.ts';

const HOUR = 3_600_000;

export const ARRIVAL = {
  /** Off offline; a test turns it on with its own pages and answers. */
  enabled: !OFFLINE,
  /** How long the edits settle before the check starts. A test sets 0. */
  delayMs: 1500,
  /** Fetches at a time: fewer than the on-demand check, since nobody is waiting. */
  concurrency: 3,
  /** A link the site would not answer for is asked again after this. */
  recheckMs: 6 * HOUR,
  /** One answer per URL serves every issue for this long. */
  linkCacheMs: 6 * HOUR,
  /** Blocklists change by the hour. */
  domainCacheMs: HOUR,
};

export interface ArrivalDeps {
  read(id: string): IssueDoc | undefined;
  /** Apply a change to a fresh read and save it, synchronously; undefined when it must not be saved. */
  apply(id: string, change: (doc: IssueDoc) => IssueDoc): IssueDoc | undefined;
  log(id: string, text: string): void;
}

let deps: ArrivalDeps | undefined;
/** index.ts hands in the store. */
export function arrivalDeps(d: ArrivalDeps): void {
  deps = d;
}

const linkCache = new Map<string, LinkResult>();
const domainCache = new Map<string, DomainResult>();
/** Tests start clean. */
export function clearArrivalCache(): void {
  linkCache.clear();
  domainCache.clear();
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();
const again = new Set<string>();

const fetchesLinks = () => !OFFLINE || pagesHandedIn();
const asksDomains = () => !OFFLINE || dnsHandedIn();

/** What an issue still has to check. Nothing for an issue that cannot change. */
export function owed(doc: IssueDoc, now = Date.now()): { urls: string[]; domains: EmailDomain[] } {
  if (doc.issue.put_to_bed_at || doc.issue.imported) return { urls: [], domains: [] };
  const urls: string[] = [];
  if (fetchesLinks()) {
    const lf = linkFindings(doc, now);
    urls.push(...lf.pending.map((l) => l.url));
    urls.push(...lf.unchecked
      .filter((l) => now - Date.parse(l.result!.checked_at) > ARRIVAL.recheckMs)
      .map((l) => l.url));
  }
  const held = doc.domain_check?.results ?? {};
  const domains = asksDomains() ? emailDomains(doc).filter((d) => !held[d.domain]) : [];
  return { urls, domains };
}

/**
 * A save happened: if the issue now prints a link or a domain not checked,
 * check it shortly, in the background. Never waits, never throws.
 */
export function noteArrival(doc: IssueDoc): void {
  if (!ARRIVAL.enabled || !deps) return;
  const { urls, domains } = owed(doc);
  if (!urls.length && !domains.length) return;
  const id = doc.issue.id;
  if (running.has(id)) {
    again.add(id);
    return;
  }
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    void run(id);
  }, ARRIVAL.delayMs));
}

/** Whether a check is waiting or running for this issue: the client looks again shortly. */
export function checking(id: string): boolean {
  return timers.has(id) || running.has(id);
}

/** Resolves once nothing is waiting or running. For tests. */
export async function arrivalSettled(): Promise<void> {
  for (let i = 0; i < 400 && (timers.size || running.size); i++) {
    await Promise.all([...running.values()]);
    if (timers.size) await new Promise((r) => setTimeout(r, 5));
  }
}

function run(id: string): Promise<void> {
  const p = (async () => {
    do {
      again.delete(id);
      await once(id);
    } while (again.has(id));
  })()
    .catch((err) => console.error(`[links] the check on arrival failed for ${id}: ${(err as Error).message}`))
    .finally(() => running.delete(id));
  running.set(id, p);
  return p;
}

const fresh = (r: { checked_at: string } | undefined, ms: number, now: number) =>
  Boolean(r && now - Date.parse(r.checked_at) < ms);

async function once(id: string): Promise<void> {
  const doc = deps!.read(id);
  if (!doc) return;
  const now = Date.now();
  const { urls, domains } = owed(doc, now);
  if (!urls.length && !domains.length) return;

  const links: Record<string, LinkResult> = {};
  const toFetch = urls.filter((u) => {
    const cached = linkCache.get(u);
    if (!fresh(cached, ARRIVAL.linkCacheMs, now)) return true;
    links[u] = cached!;
    return false;
  });
  const lookups: Record<string, DomainResult> = {};
  const toAsk = domains.filter((d) => {
    const cached = domainCache.get(d.domain);
    if (!fresh(cached, ARRIVAL.domainCacheMs, now)) return true;
    lookups[d.domain] = cached!;
    return false;
  });

  const [fetched, asked] = await Promise.all([
    toFetch.length ? checkLinks(toFetch, undefined, undefined, ARRIVAL.concurrency) : Promise.resolve({} as Record<string, LinkResult>),
    toAsk.length ? checkDomains(toAsk) : Promise.resolve({} as Record<string, DomainResult>),
  ]);
  for (const [u, r] of Object.entries(fetched)) linkCache.set(u, r);
  for (const [d, r] of Object.entries(asked)) domainCache.set(d, r);
  Object.assign(links, fetched);
  Object.assign(lookups, asked);

  const at = new Date().toISOString();
  const after = deps!.apply(id, (d) => {
    let next = d;
    if (Object.keys(links).length) next = applyLinkCheck(next, links, at);
    if (Object.keys(lookups).length) next = applyDomainCheck(next, lookups, at);
    return next;
  });
  if (!after) return;

  const lf = linkFindings(after);
  const checked = new Set(Object.keys(links));
  const found = findingsSummary({ ...lf, open: lf.open.filter((l) => checked.has(l.url)), gifts: lf.gifts.filter((l) => checked.has(l.url)) });
  const listed = Object.entries(lookups).filter(([, r]) => r.verdict === 'listed').map(([d]) => d);
  const what = [
    urls.length && `${urls.length} link${urls.length === 1 ? '' : 's'}`,
    domains.length && `${domains.length} domain${domains.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(', ');
  const said = [found, listed.length && `${listed.join(', ')} on a spam blocklist`].filter(Boolean).join('; ');
  deps!.log(id, `Checked as they arrived — ${what}: ${said || 'nothing to act on'}`);
}
