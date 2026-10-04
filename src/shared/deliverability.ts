/**
 * Will the email reach the inbox: what in the email edition a spam filter
 * reads, and what the blocklists said about every domain it prints.
 *
 * Pure, and on both sides, like link-findings.ts: the server derives the
 * "Deliverability" readiness unit and the email leg's blocklist gate from it,
 * the client the rows' notes (src/shared/hints.ts) and the Send view's line. The blocklist lookups themselves are
 * src/server/domain-check.ts.
 *
 * What is here, and what is not (2026-10-01): a domain on a blocklist is the
 * one thing that has sunk a whole issue before, so it is the only finding
 * that asks before the email goes. The rest — plain-http links, link text
 * naming another site, raw addresses, file downloads, a shouted subject,
 * Gmail's 102 KB clip — are warnings. Spam trigger words are deliberately
 * not checked: "free" is in every issue, and filters today weigh reputation,
 * authentication and complaints, not vocabulary.
 */

import type { DomainResult, IssueDoc, LinkResult } from './types.ts';
import { renderEmail } from './render/email.ts';
import { markdownToSafeHtml } from './markdown.ts';
import { orderedNodes } from './render/plan.ts';
import { linkKey, urlsIn } from './links.ts';

/** Suffixes where the registered name is three labels, not two. Enough for what the issue links. */
const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'com.br', 'com.cn', 'com.mx', 'co.in', 'co.za', 'com.sg', 'com.tr',
]);

/** The name a domain was registered as: `news.bbc.co.uk` → `bbc.co.uk`. An address stays itself. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return h;
  const labels = h.split('.');
  const n = TWO_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-n).join('.');
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/** Every http(s) URL in the email as Buttondown is handed it: links, images, the button, the pixel. */
export function emailUrls(doc: IssueDoc): string[] {
  return [...new Set(urlsIn(renderEmail(doc)))];
}

export interface EmailDomain {
  /** The registered domain, the key results are stored by. */
  domain: string;
  /** Each host under it the email prints, for the lists that name hosts. */
  hosts: string[];
  urls: string[];
}

/** Every domain the email prints, in the order it first appears. */
export function emailDomains(doc: IssueDoc): EmailDomain[] {
  const by = new Map<string, EmailDomain>();
  for (const url of emailUrls(doc)) {
    const host = hostOf(url);
    if (!host) continue;
    const domain = registrableDomain(host);
    const d = by.get(domain) ?? { domain, hosts: [], urls: [] };
    if (!d.hosts.includes(host)) d.hosts.push(host);
    d.urls.push(url);
    by.set(domain, d);
  }
  return [...by.values()];
}

export type FindingKind = 'http' | 'mismatch' | 'address' | 'file' | 'subject' | 'size';

export interface DeliverabilityFinding {
  /** Stable across re-renders, so "Keep" sticks: kind and what it is about. */
  key: string;
  kind: FindingKind;
  message: string;
  url?: string;
  /** The item that prints it, for the checklist's jump; "issue" when it is the whole email. */
  anchor: string;
}

/**
 * Gmail clips a message over 102 KB of HTML and hides the rest behind "View
 * entire message" — the footer and its unsubscribe link with it, which is
 * how a reader who wants out ends up pressing "Report spam". Buttondown's
 * template and footer take some of that; the body is warned well short.
 */
export const BODY_HTML_WARN_BYTES = 80_000;

const FILE_EXTENSIONS = /\.(exe|scr|msi|bat|cmd|jar|apk|dmg|pkg|iso|zip|rar|7z)$/i;
const LOOKS_LIKE_DOMAIN = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/?#]\S*)?$/i;

/** The item whose words print this URL, in reading order, or the issue itself. */
export function anchorFor(doc: IssueDoc, url: string): string {
  for (const node of orderedNodes(doc)) {
    for (const id of node.items) {
      if (JSON.stringify(doc.items[id] ?? {}).includes(url)) return id;
    }
  }
  return 'issue';
}

/** What in the email itself a filter would hold against it. */
export function contentFindings(doc: IssueDoc): DeliverabilityFinding[] {
  const out: DeliverabilityFinding[] = [];
  const add = (f: Omit<DeliverabilityFinding, 'anchor'>) => {
    if (out.some((o) => o.key === f.key)) return;
    out.push({ ...f, anchor: f.url ? anchorFor(doc, f.url) : 'issue' });
  };

  const title = String(doc.issue.title ?? '').trim();
  const letters = title.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) {
    add({ key: 'subject:caps', kind: 'subject', message: 'The subject is mostly capitals — filters read that as shouting.' });
  }
  if (/[!?]{2,}|!.*!/.test(title)) {
    add({ key: 'subject:punctuation', kind: 'subject', message: 'The subject has repeated "!" or "?" — a classic spam signal.' });
  }
  if (/^\s*(re|fwd?)\s*:/i.test(title)) {
    add({ key: 'subject:reply', kind: 'subject', message: 'The subject starts like a reply or forward ("Re:", "Fwd:"), which filters treat as deceptive in a newsletter.' });
  }

  // What the link check found about each link's https address, by link.
  const https = new Map<string, LinkResult['https']>();
  for (const [url, r] of Object.entries(doc.link_check?.results ?? {})) {
    if (r.https && /^http:/i.test(url)) https.set(linkKey(url) ?? url, r.https);
  }
  const httpsOf = (href: string) => https.get(linkKey(href) ?? href);

  const html = markdownToSafeHtml(renderEmail(doc));
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > BODY_HTML_WARN_BYTES) {
    add({
      key: 'size', kind: 'size',
      message: `The email body is ${Math.round(bytes / 1024)} KB of HTML. Gmail clips at 102 KB with Buttondown's template, hiding the footer and its unsubscribe link.`,
    });
  }

  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!.replace(/&amp;/g, '&');
    const text = m[2]!.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    const host = u.hostname.toLowerCase();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) {
      add({ key: `address:${href}`, kind: 'address', url: href, message: `A link to a bare address (${host}) rather than a name — a phishing signal.` });
    } else if (u.username || u.password) {
      add({ key: `address:${href}`, kind: 'address', url: href, message: `A link with "@" before the host (${host}) — it reads as one site and goes to another.` });
    }
    // The link check asked whether the https address answers. Where it
    // fails (bowlingalone.com's certificate is self-signed), the http link
    // is the right one and there is nothing to say.
    if (u.protocol === 'http:' && httpsOf(href) !== 'fails') {
      add({
        key: `http:${href}`, kind: 'http', url: href,
        message: httpsOf(href) === 'works'
          ? `A plain http:// link — ${host}. Its https:// address works: use that one.`
          : `A plain http:// link — ${host}. The https:// address is safer, if the site has one.`,
      });
    }
    if (FILE_EXTENSIONS.test(u.pathname)) {
      add({ key: `file:${href}`, kind: 'file', url: href, message: `A link straight to a download (${u.pathname.split('/').pop()}) — filters score file links.` });
    }
    const named = LOOKS_LIKE_DOMAIN.exec(text)?.[1];
    if (named && registrableDomain(named) !== registrableDomain(host)) {
      add({
        key: `mismatch:${href}`, kind: 'mismatch', url: href,
        message: `The link text says ${named} but it goes to ${host} — the mark of a phishing link.`,
      });
    }
  }
  return out;
}

export interface DomainFinding extends EmailDomain {
  result?: DomainResult;
}

export interface DeliverabilityFindings {
  content: DeliverabilityFinding[];
  /** Content findings Jamie has not kept. */
  open: DeliverabilityFinding[];
  domains: DomainFinding[];
  listed: DomainFinding[];
  /** Listed, and not sent anyway before: what the email leg asks about. */
  unaccepted: DomainFinding[];
  unchecked: DomainFinding[];
  /** Never looked up: new since the last check, or no check yet. */
  pending: DomainFinding[];
}

export function deliverabilityFindings(doc: IssueDoc): DeliverabilityFindings {
  const results = doc.domain_check?.results ?? {};
  const accepted = new Set(doc.domain_check?.accepted ?? []);
  const kept = new Set(doc.deliverability?.kept ?? []);
  const content = contentFindings(doc);
  const domains = emailDomains(doc).map((d) => ({ ...d, result: results[d.domain] }));
  const listed = domains.filter((d) => d.result?.verdict === 'listed');
  return {
    content,
    open: content.filter((f) => !kept.has(f.key)),
    domains,
    listed,
    unaccepted: listed.filter((d) => !accepted.has(d.domain)),
    unchecked: domains.filter((d) => d.result?.verdict === 'unchecked'),
    pending: domains.filter((d) => !d.result),
  };
}

/**
 * "1 domain on a spam blocklist, 2 plain-http links": what there is to act
 * on, for a pill's line. A domain no list answered for, and one not looked
 * up yet, are not in it: neither is anything Jamie can do.
 */
export function deliverabilitySummary(f: DeliverabilityFindings): string {
  const count = (kind: FindingKind) => f.open.filter((x) => x.kind === kind).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    f.unaccepted.length && plural(f.unaccepted.length, 'domain on a spam blocklist', 'domains on a spam blocklist'),
    count('subject') && plural(count('subject'), 'subject warning', 'subject warnings'),
    count('size') && 'close to Gmail\'s clip',
    count('mismatch') && plural(count('mismatch'), 'link whose text names another site', 'links whose text names another site'),
    count('address') && plural(count('address'), 'link to a bare address', 'links to a bare address'),
    count('http') && plural(count('http'), 'plain-http link', 'plain-http links'),
    count('file') && plural(count('file'), 'download link', 'download links'),
  ].filter(Boolean);
  return parts.join(', ');
}
