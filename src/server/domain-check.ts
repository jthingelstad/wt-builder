/**
 * The blocklist check: every domain the email prints, asked of the lists
 * mail filters consult for the links inside a message. One listed domain
 * can send a whole issue to spam — Jamie has watched an issue's delivery
 * drop that way — so this is the deliverability finding that asks before
 * the email goes (src/shared/deliverability.ts).
 *
 * Two lists, both by DNS:
 *
 * - Spamhaus DBL, through the Data Query Service with Jamie's own key
 *   (`SPAMHAUS_DQS_KEY`). Spamhaus refuses the public mirrors from a public
 *   resolver, and otto resolves through Cloudflare, so without the key the
 *   DBL is not asked at all.
 * - URIBL, asked at its own nameservers. Through Cloudflare it answers
 *   127.0.0.1 ("refused") for everything, which reads like a listing and
 *   is not one; its authoritative servers answer a low-volume asker
 *   directly, which is what a resolver of our own would do.
 *
 * Never silent (2026-10-01): before a run trusts a list, it asks for the
 * list's own test domain. A list that does not name it as it should is left
 * out of the run, and a domain no list could be asked about is `unchecked`,
 * never `clean`.
 */

import { Resolver } from 'node:dns/promises';

import type { DomainCheck, DomainResult, IssueDoc } from '../shared/types.ts';
import { emailDomains, type EmailDomain } from '../shared/deliverability.ts';
import { credentials, OFFLINE } from './config.ts';

/**
 * A-record lookups. `servers` asks those nameservers rather than the
 * system's. No such name is `[]`; any other failure throws. Tests hand in their own.
 */
export interface Dns {
  a(name: string, servers?: string[]): Promise<string[]>;
  ns(name: string): Promise<string[]>;
}

const TIMEOUT_MS = 4000;

export const systemDns: Dns = {
  async a(name, servers) {
    const r = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
    if (servers?.length) r.setServers(servers);
    try {
      return await r.resolve4(name);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
      throw err;
    }
  },
  async ns(name) {
    return new Resolver({ timeout: TIMEOUT_MS, tries: 2 }).resolveNs(name);
  },
};

let dns: Dns = systemDns;
/** Tests hand in their own answers; null goes back to the network. */
export function useDns(d: Dns | null): void {
  dns = d ?? systemDns;
}
/** Whether a test handed in its own answers: offline, the check on arrival asks only then. */
export function dnsHandedIn(): boolean {
  return dns !== systemDns;
}

/** One list, ready to ask: its name and how to read a domain against it. */
interface ReadyList {
  name: string;
  /** What it said: a listing's meaning, null for not listed. Throws when it could not say. */
  query(name: string): Promise<string | null>;
  /** Whether it names hosts (DBL) or only registered domains (URIBL). */
  hosts: boolean;
}

/** Spamhaus DBL return codes (docs.spamhaus.com, DBL return codes). */
const DBL_CODES: Record<string, string> = {
  '127.0.1.2': 'spam domain',
  '127.0.1.4': 'phishing domain',
  '127.0.1.5': 'malware domain',
  '127.0.1.6': 'botnet command and control domain',
  '127.0.1.102': 'abused legitimate site, used for spam',
  '127.0.1.103': 'abused redirector or shortener',
  '127.0.1.104': 'abused legitimate site, used for phishing',
  '127.0.1.105': 'abused legitimate site, serving malware',
  '127.0.1.106': 'abused legitimate site, botnet command and control',
};

function dblList(key: string): ReadyList {
  const zone = `${key}.dbl.dq.spamhaus.net`;
  return {
    name: 'Spamhaus DBL',
    hosts: true,
    async query(name) {
      const answers = await dns.a(`${name}.${zone}`);
      if (!answers.length) return null;
      // 127.255.255.x is Spamhaus refusing the question, not an answer.
      if (answers.some((a) => a.startsWith('127.255.255.'))) throw new Error(`Spamhaus refused the query (${answers.join(', ')})`);
      return answers.map((a) => DBL_CODES[a] ?? `listed (${a})`).join(', ');
    },
  };
}

/** URIBL's answer is a bitmask in the last octet: 2 black, 4 grey, 8 red; 1 is "refused". */
function uriblList(servers: string[]): ReadyList {
  return {
    name: 'URIBL',
    hosts: false,
    async query(name) {
      const answers = await dns.a(`${name}.multi.uribl.com`, servers);
      if (!answers.length) return null;
      const bits = answers.reduce((acc, a) => acc | Number(a.split('.')[3] ?? 0), 0);
      if (bits & 1) throw new Error('URIBL refused the query');
      const said = [bits & 2 && 'black', bits & 8 && 'red'].filter(Boolean);
      // Grey is bulk mail that is not spam (newsletters, retailers); it is not a listing.
      return said.length ? `${said.join(' and ')} list` : null;
    },
  };
}

/**
 * The lists this run can trust, each proved by its own test domain, and why
 * any other is left out.
 */
export async function readyLists(): Promise<{ lists: ReadyList[]; skipped: string[] }> {
  const lists: ReadyList[] = [];
  const skipped: string[] = [];

  const key = credentials.spamhausKey;
  if (!key) {
    skipped.push('Spamhaus DBL: no SPAMHAUS_DQS_KEY');
  } else {
    const dbl = dblList(key);
    try {
      const said = await dbl.query('dbltest.com');
      if (said) lists.push(dbl);
      else skipped.push('Spamhaus DBL: its test domain came back unlisted');
    } catch (err) {
      skipped.push(`Spamhaus DBL: ${(err as Error).message}`);
    }
  }

  try {
    const names = await dns.ns('multi.uribl.com');
    const servers = (await Promise.all(names.map((n) => dns.a(n).catch(() => [] as string[])))).flat();
    if (!servers.length) throw new Error('no nameserver addresses');
    const uribl = uriblList(servers);
    const said = await uribl.query('test.uribl.com');
    if (said) lists.push(uribl);
    else skipped.push('URIBL: its test domain came back unlisted');
  } catch (err) {
    skipped.push(`URIBL: ${(err as Error).message}`);
  }
  return { lists, skipped };
}

const CONCURRENCY = 8;

/** What every list said about one domain and its hosts. Never throws. */
export async function checkDomain(
  d: Pick<EmailDomain, 'domain' | 'hosts'>, lists: ReadyList[], skipped: string[] = [], now = () => new Date(),
): Promise<DomainResult> {
  const checked_at = now().toISOString();
  if (!lists.length) {
    return { verdict: 'unchecked', note: skipped.join('; ') || 'no blocklist could be asked', checked_at };
  }
  const found: string[] = [];
  const asked: string[] = [];
  const failed: string[] = [];
  for (const list of lists) {
    const names = list.hosts
      ? [...new Set([d.domain, ...d.hosts.map((h) => h.replace(/^www\./, ''))])]
      : [d.domain];
    try {
      for (const name of names) {
        const said = await list.query(name);
        if (said) found.push(`${list.name}: ${name === d.domain ? '' : `${name} — `}${said}`);
      }
      asked.push(list.name);
    } catch (err) {
      failed.push(`${list.name}: ${(err as Error).message}`);
    }
  }
  if (found.length) return { verdict: 'listed', lists: found, asked, ...(failed.length ? { note: failed.join('; ') } : {}), checked_at };
  if (!asked.length) return { verdict: 'unchecked', note: [...failed, ...skipped].join('; '), checked_at };
  const unasked = [...failed, ...skipped];
  return { verdict: 'clean', asked, ...(unasked.length ? { note: `not asked — ${unasked.join('; ')}` } : {}), checked_at };
}

/** Every domain the email prints, CONCURRENCY at a time. */
export async function checkDomains(
  domains: Pick<EmailDomain, 'domain' | 'hosts'>[], now = () => new Date(),
): Promise<Record<string, DomainResult>> {
  const out: Record<string, DomainResult> = {};
  // Offline asks nothing, unless a test handed in its own answers.
  if (OFFLINE && dns === systemDns) {
    for (const d of domains) out[d.domain] = { verdict: 'unchecked', note: 'offline — nothing leaves this machine', checked_at: now().toISOString() };
    return out;
  }
  const { lists, skipped } = await readyLists();
  const queue = [...domains];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let d = queue.shift(); d !== undefined; d = queue.shift()) {
      out[d.domain] = await checkDomain(d, lists, skipped, now);
    }
  }));
  return out;
}

/**
 * The results applied to a document: merged over the last check, pruned to
 * the domains the email prints now. A domain sent anyway stays accepted only
 * while it is still listed. Pure; the route hands it a fresh read.
 */
export function applyDomainCheck(doc: IssueDoc, results: Record<string, DomainResult>, at: string): IssueDoc {
  const current = new Set(emailDomains(doc).map((d) => d.domain));
  const merged = { ...(doc.domain_check?.results ?? {}), ...results };
  const kept = Object.fromEntries(Object.entries(merged).filter(([d]) => current.has(d)));
  const accepted = (doc.domain_check?.accepted ?? []).filter((d) => kept[d]?.verdict === 'listed');
  const check: DomainCheck = { at, results: kept, ...(accepted.length ? { accepted } : {}) };
  return { ...doc, domain_check: check };
}

/**
 * Whether these results say anything the issue does not already hold — a
 * domain new to the check, or a verdict, a listing or the lists asked that
 * changed. The send gate looks every domain up on every click; saving only
 * on a change keeps those clicks from filling the revision history.
 */
export function domainCheckChanged(doc: IssueDoc, results: Record<string, DomainResult>): boolean {
  const held = doc.domain_check?.results ?? {};
  const said = (r: DomainResult | undefined) => r && JSON.stringify([r.verdict, r.lists ?? [], r.asked ?? [], r.note ?? '']);
  const current = new Set(emailDomains(doc).map((d) => d.domain));
  return Object.entries(results).some(([d, r]) => said(held[d]) !== said(r))
    || Object.keys(held).some((d) => !current.has(d));
}

/** Listed domains sent anyway: the email leg does not ask about them again. */
export function acceptDomains(doc: IssueDoc, domains: string[]): IssueDoc {
  const accepted = [...new Set([...(doc.domain_check?.accepted ?? []), ...domains])];
  return {
    ...doc,
    domain_check: { at: doc.domain_check?.at ?? new Date().toISOString(), results: doc.domain_check?.results ?? {}, accepted },
  };
}

/** A deliverability finding in the email kept as it is, or put back to asking. */
export function keepFinding(doc: IssueDoc, key: string, keep: boolean): IssueDoc {
  const now = new Set(doc.deliverability?.kept ?? []);
  if (keep) now.add(key);
  else now.delete(key);
  return { ...doc, deliverability: { kept: [...now] } };
}
