/**
 * The link check (src/server/link-check.ts) and what readiness makes of it
 * (src/shared/link-findings.ts). Pages are handed in; nothing is fetched.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc, LinkResult } from '../src/shared/types.ts';
import {
  acceptLinks, applyLinkCheck, canonicalHint, checkLink, checkLinks, type Fetched, type Fetcher,
} from '../src/server/link-check.ts';
import { findingsSummary, giftLine, giftOf, issueLinks, linkFindings } from '../src/shared/link-findings.ts';
import { readiness } from '../src/server/issue.ts';

const fixture = (): IssueDoc => JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;

const NOW = () => new Date('2026-10-01T12:00:00Z');

function page(status: number, url: string, html = '', contentType = 'text/html; charset=utf-8'): Fetched {
  return { status, url, contentType, text: async () => html, discard: async () => {} };
}

/** A fetcher answering from a table: URL → page, or an error to throw. */
function pages(table: Record<string, Fetched | Error>): Fetcher {
  return async (url) => {
    const got = table[url];
    if (!got) throw new Error(`unexpected fetch ${url}`);
    if (got instanceof Error) throw got;
    return got;
  };
}

describe('checkLink', () => {
  it('a page that answers where it says is fine', async () => {
    const url = 'https://example.com/post';
    const r = await checkLink(url, pages({ [url]: page(200, url, '<html></html>') }), NOW);
    expect(r).toEqual({ verdict: 'ok', status: 200, checked_at: '2026-10-01T12:00:00.000Z' });
  });

  it('a shortener resolves to where it went', async () => {
    const url = 'https://t.co/abc';
    const r = await checkLink(url, pages({ [url]: page(200, 'https://example.com/story?utm_source=twitter') }), NOW);
    expect(r.verdict).toBe('moved');
    expect(r.suggestion).toBe('https://example.com/story');
    expect(r.final_url).toBe('https://example.com/story?utm_source=twitter');
    expect(r.note).toBe('shortened');
  });

  it("the page's own canonical wins over where it landed", async () => {
    const url = 'https://amp.example.com/story';
    const html = '<head><link href="https://example.com/2026/story" rel="canonical"></head>';
    const r = await checkLink(url, pages({ [url]: page(200, url, html) }), NOW);
    expect(r).toMatchObject({ verdict: 'moved', canonical_hint: 'https://example.com/2026/story', suggestion: 'https://example.com/2026/story' });
  });

  it('a canonical naming the same page, or the front page, says nothing', async () => {
    const url = 'https://example.com/post';
    for (const href of ['https://www.example.com/post/', 'https://example.com/']) {
      const r = await checkLink(url, pages({ [url]: page(200, url, `<link rel="canonical" href="${href}">`) }), NOW);
      expect(r.verdict, href).toBe('ok');
      expect(r.canonical_hint, href).toBeUndefined();
    }
  });

  it('tracking on the link itself is a finding even when the page is the same', async () => {
    const url = 'https://example.com/post?utm_source=newsletter';
    const r = await checkLink(url, pages({ [url]: page(200, url) }), NOW);
    expect(r).toMatchObject({ verdict: 'moved', suggestion: 'https://example.com/post' });
  });

  it('www and https alone are not a finding', async () => {
    const url = 'http://example.com/post';
    const r = await checkLink(url, pages({ [url]: page(200, 'https://www.example.com/post') }), NOW);
    expect(r.verdict).toBe('ok');
  });

  it('404, 410 and no such host are dead', async () => {
    const enotfound = Object.assign(new Error('getaddrinfo ENOTFOUND gone.example'), { code: 'ENOTFOUND' });
    const r = await checkLinks(['https://a.example/x', 'https://b.example/x', 'https://gone.example/x'], pages({
      'https://a.example/x': page(404, 'https://a.example/x'),
      'https://b.example/x': page(410, 'https://b.example/x'),
      'https://gone.example/x': enotfound,
    }), NOW);
    expect(Object.values(r).map((x) => x.verdict)).toEqual(['dead', 'dead', 'dead']);
    expect(r['https://gone.example/x']!.note).toBe('no such host');
  });

  it("a redirect to the site's front page is dead; a ?p= page is not the front page", async () => {
    const url = 'https://example.com/2019/gone-article';
    const r = await checkLink(url, pages({ [url]: page(200, 'https://example.com/') }), NOW);
    expect(r).toMatchObject({ verdict: 'dead', note: "redirects to the site's front page" });
    const wp = await checkLink(url, pages({ [url]: page(200, 'https://example.com/?p=123') }), NOW);
    expect(wp.verdict).toBe('moved');
  });

  it('a site that turns checkers away is unchecked, never dead', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const url = `https://example.com/${status}`;
      const r = await checkLink(url, pages({ [url]: page(status, url) }), NOW);
      expect(r.verdict, String(status)).toBe('unchecked');
    }
    const url = 'https://slow.example/x';
    const r = await checkLink(url, pages({ [url]: new Error('The operation was aborted due to timeout') }), NOW);
    expect(r.verdict).toBe('unchecked');
  });
});

describe('canonicalHint', () => {
  it('reads the tag in any attribute order and resolves it', () => {
    expect(canonicalHint("<link rel='canonical' href='/a/b'>", 'https://example.com/x')).toBe('https://example.com/a/b');
    expect(canonicalHint('<link href="https://e.com/?a=1&amp;b=2" rel="alternate canonical">', 'https://e.com/')).toBe('https://e.com/?a=1&b=2');
    expect(canonicalHint('<link rel="stylesheet" href="/s.css">', 'https://e.com/')).toBeUndefined();
  });
});

describe('what the issue prints', () => {
  it('each Pinboard link and every link in words, not images or Thingy', () => {
    const doc = fixture();
    const links = issueLinks(doc);
    const urls = links.map((l) => l.url);
    expect(urls).toContain('https://avc.xyz/create-your-own-currency-with-flipcash');
    expect(links.find((l) => l.url === 'https://avc.xyz/create-your-own-currency-with-flipcash')!.role).toBe('item');
    expect(urls.some((u) => /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(u))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('prints the applied canonical instead of the bookmark', () => {
    const doc = fixture();
    doc.items['link-flipcash']!.canonical_url = 'https://avc.xyz/flipcash';
    const urls = issueLinks(doc).map((l) => l.url);
    expect(urls).toContain('https://avc.xyz/flipcash');
    expect(urls).not.toContain('https://avc.xyz/create-your-own-currency-with-flipcash');
  });
});

describe('the Links checked unit', () => {
  const unit = (doc: IssueDoc) => readiness(doc).units.find((u) => u.title === 'Links checked');
  const result = (verdict: LinkResult['verdict'], extra: Partial<LinkResult> = {}): LinkResult =>
    ({ verdict, checked_at: '2026-10-01T12:00:00.000Z', ...extra });

  it('is to do before any check, and says the send will check', () => {
    const u = unit(fixture())!;
    expect(u.state).toBe('todo');
    expect(u.kind).toBe('links');
    expect(u.context).toContain('checked before the email and the website go');
  });

  it('is done when every link answered, unchecked ones included', () => {
    const doc = fixture();
    const results = Object.fromEntries(issueLinks(doc).map((l, i) => [l.url, result(i === 0 ? 'unchecked' : 'ok')]));
    const u = unit(applyLinkCheck(doc, results, '2026-10-01T12:00:00.000Z'))!;
    expect(u.state).toBe('done');
  });

  it('is partial with the counts, and jumps to the first finding; kept findings stop counting', () => {
    const doc = fixture();
    const links = issueLinks(doc);
    const dead = links.find((l) => l.role === 'item')!;
    const results = Object.fromEntries(links.map((l) => [l.url, result(l === dead ? 'dead' : 'ok', l === dead ? { status: 404 } : {})]));
    const checked = applyLinkCheck(doc, results, '2026-10-01T12:00:00.000Z');
    const u = unit(checked)!;
    expect(u.state).toBe('partial');
    expect(u.context).toContain('1 dead');
    expect(u.anchor).toBe(dead.items[0]);
    expect(linkFindings(checked).unaccepted.map((l) => l.url)).toEqual([dead.url]);

    const kept = acceptLinks(checked, [dead.url]);
    expect(unit(kept)!.state).toBe('done');
    expect(linkFindings(kept).unaccepted).toEqual([]);
  });

  it('a new link since the check is pending, and a link no longer printed is dropped', () => {
    const doc = fixture();
    const links = issueLinks(doc);
    const results = Object.fromEntries(links.map((l) => [l.url, result('ok')]));
    results['https://no-longer.example/x'] = result('dead');
    const checked = applyLinkCheck(doc, results, '2026-10-01T12:00:00.000Z');
    expect(checked.link_check!.results['https://no-longer.example/x']).toBeUndefined();
    checked.items['link-flipcash']!.canonical_url = 'https://avc.xyz/flipcash';
    const f = linkFindings(checked);
    expect(f.pending.map((l) => l.url)).toEqual(['https://avc.xyz/flipcash']);
    expect(unit(checked)!.state).toBe('partial');
  });
});

describe('gift links (Jamie, 2026-10-04)', () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (claims: object) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.c2ln`;
  const at = Date.parse('2026-10-04T12:00:00Z');
  // The shape of the WT352 Verge link: a five-day token, expired 2026-09-29.
  const verge = `https://www.theverge.com/column/999999/optimizer?view_token=${jwt({ iat: 1790269400, exp: 1790701400 })}`;
  const unit = (doc: IssueDoc) => readiness(doc).units.find((u) => u.title === 'Links checked');
  const withGift = (url: string) => {
    const doc = fixture();
    doc.items['link-flipcash']!.source_url = url;
    return doc;
  };

  it('reads an expired Verge gift off the URL, with when it ran out', () => {
    expect(giftOf(verge, at)).toEqual({ param: 'view_token', expires: '2026-09-29T17:03:20.000Z', expired: true });
    expect(giftLine(giftOf(verge, at)!)).toBe('A gift link (view_token) that expired Sep 29: readers will hit the paywall.');
    expect(giftOf(verge, Date.parse('2026-09-29T00:00:00Z'))!.expired).toBe(false);
  });

  it('knows the common gift parameters, and the generic ones only on their own sites', () => {
    expect(giftOf('https://www.nytimes.com/2026/10/01/a.html?unlocked_article_code=1.abc&smid=url-share')?.param).toBe('unlocked_article_code');
    expect(giftOf('https://www.washingtonpost.com/a/?pwapi_token=eyJx')?.param).toBe('pwapi_token');
    expect(giftOf('https://www.theatlantic.com/a/?gift=Zq9')?.param).toBe('gift');
    expect(giftOf('https://www.bloomberg.com/news/a?accessToken=abc')?.param).toBe('accessToken');
    expect(giftOf('https://www.wsj.com/a?st=abc&reflink=share')?.param).toBe('st');
    expect(giftOf('https://example.com/a?st=abc')).toBeUndefined();
    expect(giftOf('https://example.com/a?accessToken=abc')).toBeUndefined();
    expect(giftOf('https://example.com/a?gift=')).toBeUndefined();
    expect(giftOf('https://example.com/a')).toBeUndefined();
    expect(giftOf('not a url')).toBeUndefined();
    // A token that is not a JWT, or a JWT with no usable exp, is a gift with no date.
    expect(giftOf('https://www.theverge.com/a?view_token=a.!!.c', at)).toEqual({ param: 'view_token' });
    expect(giftOf(`https://www.theverge.com/a?view_token=${jwt({ exp: 1e300 })}`, at)).toEqual({ param: 'view_token' });
    expect(giftOf(`https://www.theverge.com/a?view_token=${jwt({ exp: 'soon' })}`, at)).toEqual({ param: 'view_token' });
  });

  it('is a finding before any check, and says so in the unit', () => {
    const doc = withGift(verge);
    const f = linkFindings(doc, at);
    expect(f.gifts.map((l) => l.url)).toEqual([verge]);
    expect(f.open.map((l) => l.url)).toEqual([verge]);
    expect(findingsSummary(f)).toMatch(/^1 gift link \(1 expired\), \d+ not checked yet$/);
    const u = unit(doc)!;
    expect(u.state).toBe('todo');
    expect(u.context).toContain('One is a gift link');
  });

  it('keeps the unit partial after a clean check, until Jamie keeps it; the keep survives the next check', () => {
    const doc = withGift(verge);
    const all = Object.fromEntries(issueLinks(doc).map((l) => [l.url, { verdict: 'ok', checked_at: '2026-10-04T12:00:00.000Z' } as LinkResult]));
    const checked = applyLinkCheck(doc, all, '2026-10-04T12:00:00.000Z');
    const u = unit(checked)!;
    expect(u.state).toBe('partial');
    expect(u.anchor).toBe('link-flipcash');
    expect(u.context).toContain('1 gift link');
    // Warn, don't block: a gift link never stops a send.
    expect(linkFindings(checked).unaccepted).toEqual([]);

    const kept = acceptLinks(checked, [verge]);
    expect(unit(kept)!.state).toBe('done');
    const again = applyLinkCheck(kept, all, '2026-10-04T13:00:00.000Z');
    expect(again.link_check!.accepted).toEqual([verge]);
    expect(unit(again)!.state).toBe('done');
  });
});
