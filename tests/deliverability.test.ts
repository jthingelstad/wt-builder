/**
 * Will the email reach the inbox: the findings in the email itself
 * (src/shared/deliverability.ts), the blocklist lookups
 * (src/server/domain-check.ts), and the Complaints line on the Buttondown
 * check (src/server/verify.ts). DNS answers are handed in; nothing leaves
 * this machine.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc, Item } from '../src/shared/types.ts';
import {
  contentFindings, deliverabilityFindings, deliverabilitySummary, emailDomains, registrableDomain,
} from '../src/shared/deliverability.ts';
import {
  acceptDomains, applyDomainCheck, checkDomain, checkDomains, keepFinding, readyLists, useDns, type Dns,
} from '../src/server/domain-check.ts';
import { credentials } from '../src/server/config.ts';
import { readiness } from '../src/server/issue.ts';
import { complaintsCheck } from '../src/server/verify.ts';

const fixture = (): IssueDoc => JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;

const NOW = () => new Date('2026-10-01T12:00:00Z');

/** The fixture with one more Notable link whose commentary says `words`. */
function withLink(words: string, url = 'https://example.com/story'): IssueDoc {
  const doc = fixture();
  const notable = doc.nodes.find((n) => n.items.some((id) => doc.items[id]?.type === 'pinboard_link'))!;
  const sibling = doc.items[notable.items.find((id) => doc.items[id]?.type === 'pinboard_link')!] as Item;
  doc.items['link-x'] = { ...structuredClone(sibling), source_url: url, canonical_url: undefined, title: 'A story', commentary: words };
  notable.items.push('link-x');
  return doc;
}

describe('registrableDomain', () => {
  it('keeps the registered name and drops the hosts under it', () => {
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('Files.Thingelstad.com.')).toBe('thingelstad.com');
    expect(registrableDomain('203.0.113.9')).toBe('203.0.113.9');
  });
});

describe('contentFindings', () => {
  it('finds nothing in the representative issue', () => {
    expect(contentFindings(fixture())).toEqual([]);
  });

  it('flags a plain-http link, a bare address, a download, and link text naming another site', () => {
    const doc = withLink([
      'Old [site](http://old.example.net/page).',
      'Odd [box](https://203.0.113.9/x).',
      'Get [the app](https://example.com/files/setup.exe).',
      'See [paypal.com](https://paypa1-login.example.org/verify).',
    ].join(' '));
    const kinds = contentFindings(doc).map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['http', 'address', 'file', 'mismatch']));
    for (const f of contentFindings(doc)) expect(f.anchor).toBe('link-x');
  });

  it('does not call link text naming the same site a mismatch', () => {
    const doc = withLink('See [www.example.com](https://example.com/about) and [example.com/x](https://blog.example.com/x).');
    expect(contentFindings(doc).filter((f) => f.kind === 'mismatch')).toEqual([]);
  });

  it('reads the subject: capitals, repeated punctuation, a fake reply', () => {
    const doc = fixture();
    doc.issue.title = 'RE: ACT NOW!!';
    expect(contentFindings(doc).map((f) => f.key)).toEqual(['subject:caps', 'subject:punctuation', 'subject:reply']);
  });

  it('warns when the body gets near Gmail\'s clip', () => {
    const doc = withLink('Long. '.repeat(16_000));
    expect(contentFindings(doc).some((f) => f.kind === 'size')).toBe(true);
  });

  it('a kept finding stops counting, and asking again brings it back', () => {
    const doc = withLink('Old [site](http://old.example.net/page).');
    const key = contentFindings(doc)[0]!.key;
    const kept = keepFinding(doc, key, true);
    expect(deliverabilityFindings(kept).open).toEqual([]);
    expect(deliverabilityFindings(keepFinding(kept, key, false)).open).toHaveLength(1);
  });
});

describe('emailDomains', () => {
  it('covers every domain the email prints, its own included, grouped by registered name', () => {
    const domains = emailDomains(withLink('[a](https://news.example.com/a) and [b](https://www.example.com/b)'));
    const example = domains.find((d) => d.domain === 'example.com')!;
    expect(example.hosts).toEqual(expect.arrayContaining(['news.example.com', 'www.example.com']));
    // The membership button and the open pixel are in the email too.
    expect(domains.map((d) => d.domain)).toEqual(expect.arrayContaining(['thingelstad.com', 'tinylytics.app']));
  });
});

/** A DNS that answers from a table; anything else is "no such name". */
function table(answers: Record<string, string[]>, opts: { refuse?: boolean } = {}): Dns {
  return {
    async a(name) {
      if (opts.refuse && name.endsWith('.multi.uribl.com')) return ['127.0.0.1'];
      return answers[name] ?? [];
    },
    async ns(name) {
      if (name === 'multi.uribl.com') return ['ns.uribl.test'];
      throw Object.assign(new Error('no NS'), { code: 'ENOTFOUND' });
    },
  };
}
const URIBL_UP = {
  'ns.uribl.test': ['192.0.2.53'],
  'test.uribl.com.multi.uribl.com': ['127.0.0.14'],
};

describe('the blocklist lookups', () => {
  afterEach(() => {
    useDns(null);
    credentials.spamhausKey = undefined;
  });

  it('trusts URIBL once its test domain answers, and reads black and red as listed, grey as not', async () => {
    useDns(table({
      ...URIBL_UP,
      'bad.example.multi.uribl.com': ['127.0.0.2'],
      'bulk.example.multi.uribl.com': ['127.0.0.4'],
    }));
    const { lists, skipped } = await readyLists();
    expect(lists.map((l) => l.name)).toEqual(['URIBL']);
    expect(skipped).toEqual(['Spamhaus DBL: no SPAMHAUS_DQS_KEY']);
    const bad = await checkDomain({ domain: 'bad.example', hosts: ['bad.example'] }, lists, skipped, NOW);
    expect(bad).toMatchObject({ verdict: 'listed', lists: ['URIBL: black list'], asked: ['URIBL'] });
    const bulk = await checkDomain({ domain: 'bulk.example', hosts: ['bulk.example'] }, lists, skipped, NOW);
    expect(bulk.verdict).toBe('clean');
    expect(bulk.note).toContain('no SPAMHAUS_DQS_KEY');
  });

  it('a list that answers "refused" for its own test domain is left out, and nothing reads as clean', async () => {
    useDns(table({ 'ns.uribl.test': ['192.0.2.53'] }, { refuse: true }));
    const { lists, skipped } = await readyLists();
    expect(lists).toEqual([]);
    const r = await checkDomain({ domain: 'example.com', hosts: ['example.com'] }, lists, skipped, NOW);
    expect(r.verdict).toBe('unchecked');
    expect(r.note).toContain('URIBL: URIBL refused the query');
  });

  it('asks the Spamhaus DBL with the key, by host and by domain, and names what it found', async () => {
    credentials.spamhausKey = 'k3y';
    useDns(table({
      ...URIBL_UP,
      'dbltest.com.k3y.dbl.dq.spamhaus.net': ['127.0.1.2'],
      'evil.example.org.k3y.dbl.dq.spamhaus.net': ['127.0.1.104'],
    }));
    const { lists } = await readyLists();
    expect(lists.map((l) => l.name)).toEqual(['Spamhaus DBL', 'URIBL']);
    const r = await checkDomain({ domain: 'example.org', hosts: ['evil.example.org'] }, lists, [], NOW);
    expect(r.verdict).toBe('listed');
    expect(r.lists).toEqual(['Spamhaus DBL: evil.example.org — abused legitimate site, used for phishing']);
  });

  it('a Spamhaus refusal code is never a listing', async () => {
    credentials.spamhausKey = 'k3y';
    useDns(table({ ...URIBL_UP, 'dbltest.com.k3y.dbl.dq.spamhaus.net': ['127.255.255.254'] }));
    const { lists, skipped } = await readyLists();
    expect(lists.map((l) => l.name)).toEqual(['URIBL']);
    expect(skipped[0]).toContain('Spamhaus refused the query');
  });

  it('applies results to the email\'s domains, keeps a send-anyway only while listed, and gates readiness', async () => {
    useDns(table({ ...URIBL_UP, 'example.net.multi.uribl.com': ['127.0.0.8'] }));
    const doc = withLink('Old [site](https://old.example.net/page).');
    const results = await checkDomains(emailDomains(doc), NOW);
    const checked = applyDomainCheck(doc, results, NOW().toISOString());
    const f = deliverabilityFindings(checked);
    expect(f.unaccepted.map((d) => d.domain)).toEqual(['example.net']);
    expect(deliverabilitySummary(f)).toContain('1 domain on a spam blocklist');
    const unit = readiness(checked).units.find((u) => u.title === 'Deliverability')!;
    expect(unit).toMatchObject({ state: 'partial', kind: 'mail', anchor: 'link-x' });

    const accepted = acceptDomains(checked, ['example.net']);
    expect(deliverabilityFindings(accepted).unaccepted).toEqual([]);
    expect(readiness(accepted).units.find((u) => u.title === 'Deliverability')!.state).toBe('done');

    // Delisted: the acceptance goes with it, so a new listing asks again.
    const clean = Object.fromEntries(Object.keys(results).map((d) => [d, { verdict: 'clean' as const, asked: ['URIBL'], checked_at: NOW().toISOString() }]));
    expect(applyDomainCheck(accepted, clean, NOW().toISOString()).domain_check!.accepted).toBeUndefined();
  });

  it('offline with no test answers, every domain is unchecked and nothing is asked', async () => {
    const r = await checkDomains([{ domain: 'example.com', hosts: ['example.com'] }], NOW);
    expect(r['example.com']).toMatchObject({ verdict: 'unchecked', note: 'offline — nothing leaves this machine' });
  });
});

describe('the Complaints line', () => {
  it('passes under 0.1%, warns over it, fails over 0.3%, and compares the issues before', () => {
    expect(complaintsCheck({ deliveries: 1764, complaints: 1, unsubscriptions: 4 })).toMatchObject({
      ok: true, detail: '1 spam complaint (0.06%) · 4 unsubscribed',
    });
    expect(complaintsCheck({ deliveries: 1764, complaints: 2 })!.ok).toBeNull();
    const bad = complaintsCheck({ deliveries: 1764, complaints: 6 }, [
      { number: 352, metrics: { complaints: 0, unsubscriptions: 3 } },
      { number: 351, metrics: { recipients: 1779 } },
    ])!;
    expect(bad.ok).toBe(false);
    expect(bad.items).toEqual(['Earlier issues (complaints / unsubscribed) — WT352: 0 / 3']);
  });

  it('says nothing when Buttondown does not report complaints', () => {
    expect(complaintsCheck({ deliveries: 1764 })).toBeUndefined();
  });
});
