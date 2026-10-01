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
import { issueLinks, linkFindings } from '../src/shared/link-findings.ts';
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
