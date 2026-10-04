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
import { actionOf, findingsSummary, giftLine, giftOf, issueLinks, linkFindings } from '../src/shared/link-findings.ts';
import { rowHints } from '../src/shared/hints.ts';
import { contentFindings } from '../src/shared/deliverability.ts';
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

  it('tracking on the link itself is not a finding: the same page is the same page (2026-10-04)', async () => {
    const url = 'https://example.com/post?utm_source=newsletter';
    const r = await checkLink(url, pages({ [url]: page(200, url) }), NOW);
    expect(r.verdict).toBe('ok');
    expect(r.suggestion).toBeUndefined();
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

  it('is done before any check: a link not checked yet is nothing to act on (2026-10-04)', () => {
    const u = unit(fixture())!;
    expect(u.state).toBe('done');
    expect(u.kind).toBe('links');
    expect(u.context).toContain('checked as it arrives');
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
    // Pending holds nothing: it is checked as it arrives, and again at send.
    expect(unit(checked)!.state).toBe('done');
    expect(unit(checked)!.context).toContain('1 not checked yet');
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
    expect(findingsSummary(f)).toBe('1 gift link (1 expired)');
    const u = unit(doc)!;
    expect(u.state).toBe('partial');
    expect(u.context).toContain('1 gift link (1 expired)');
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

describe('what Jamie can act on (plan before WT353, item 1)', () => {
  const at = '2026-10-04T12:00:00.000Z';
  const certErr = (code: string) => Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  /** The fixture with the flipcash link set to `url`, checked with `r`. */
  const withLink = (url: string, r: LinkResult) => {
    const doc = fixture();
    doc.items['link-flipcash']!.source_url = url;
    const all = Object.fromEntries(issueLinks(doc).map((l) => [l.url, { verdict: 'ok', checked_at: at } as LinkResult]));
    all[url] = r;
    return applyLinkCheck(doc, all, at);
  };
  const actionFor = (doc: IssueDoc, url: string) => {
    const f = linkFindings(doc).open.find((l) => l.url === url);
    return f ? actionOf(f) : undefined;
  };
  const hintsOn = (doc: IssueDoc) => (rowHints(doc).get('link-flipcash') ?? []).filter((h) => h.kind === 'link');

  it('404 and 410 are dead, said on the row', async () => {
    for (const status of [404, 410]) {
      const url = `https://example.com/${status}`;
      const r = await checkLink(url, pages({ [url]: page(status, url) }), NOW);
      const doc = withLink(url, r);
      expect(actionFor(doc, url), String(status)).toBe('dead');
      expect(hintsOn(doc)[0]).toMatchObject({ short: 'dead link' });
      expect(hintsOn(doc)[0]!.text).toContain(`(${status})`);
    }
  });

  it('403, 429 and a timeout get no mark: kept as unchecked, nothing on the row', async () => {
    const cases: [string, Fetched | Error][] = [
      ['https://example.com/403', page(403, 'https://example.com/403')],
      ['https://example.com/429', page(429, 'https://example.com/429')],
      ['https://slow.example/x', new Error('The operation was aborted due to timeout')],
    ];
    for (const [url, answer] of cases) {
      const r = await checkLink(url, pages({ [url]: answer }), NOW);
      expect(r.verdict, url).toBe('unchecked');
      const doc = withLink(url, r);
      expect(linkFindings(doc).open, url).toEqual([]);
      expect(hintsOn(doc), url).toEqual([]);
      expect(readiness(doc).units.find((u) => u.kind === 'links')!.state, url).toBe('done');
    }
  });

  it('never suggests a link that drops https: a canonical to http is refused, and an old stored one is not shown', async () => {
    // The WT352 Plan mode link: the page's canonical names its http:// address.
    const url = 'https://aymannadeem.github.io/blog/plan-mode';
    const html = '<link rel="canonical" href="http://aymannadeem.github.io/blog/plan-mode-notes">';
    const r = await checkLink(url, pages({ [url]: page(200, url, html) }), NOW);
    expect(r.verdict).toBe('ok');
    expect(r.suggestion).toBeUndefined();
    const old = withLink(url, { verdict: 'moved', suggestion: 'http://aymannadeem.github.io/blog/plan-mode-notes', checked_at: at });
    expect(actionFor(old, url)).toBeUndefined();
    expect(hintsOn(old)).toEqual([]);
  });

  it('a real redirect to a different page is moved, with the page it went to', async () => {
    const url = 'https://example.com/2019/old-slug';
    const r = await checkLink(url, pages({ [url]: page(200, 'https://example.com/2019/new-slug?utm_source=rss') }), NOW);
    expect(r).toMatchObject({ verdict: 'moved', suggestion: 'https://example.com/2019/new-slug' });
    const doc = withLink(url, r);
    expect(actionFor(doc, url)).toBe('moved');
    expect(hintsOn(doc)[0]).toMatchObject({ short: 'moved link' });
  });

  it('a trailing slash, http to https on the same page, or tracking alone is not a move; nor an old stored one', async () => {
    const url = 'http://example.com/post';
    const r = await checkLink(url, pages({ [url]: page(200, 'https://example.com/post/?utm_campaign=x') }), NOW);
    expect(r.verdict).toBe('ok');
    const old = withLink('https://example.com/post?utm_source=a', { verdict: 'moved', suggestion: 'https://example.com/post', checked_at: at });
    expect(actionFor(old, 'https://example.com/post?utm_source=a')).toBeUndefined();
  });

  it('a redirect to a sign-in or consent page is unchecked, not a move', async () => {
    const url = 'https://news.example/story';
    for (const landed of ['https://news.example/login?next=/story', 'https://consent.example.com/?continue=x']) {
      const r = await checkLink(url, pages({ [url]: page(200, landed) }), NOW);
      expect(r.verdict, landed).toBe('unchecked');
    }
  });

  it('https with a self-signed certificate and a working http address: suggest http, the one case it may', async () => {
    const url = 'https://bowlingalone.com/';
    const plain = 'http://bowlingalone.com/';
    const r = await checkLink(url, pages({ [url]: certErr('DEPTH_ZERO_SELF_SIGNED_CERT'), [plain]: page(200, plain) }), NOW);
    expect(r).toMatchObject({ verdict: 'moved', suggestion: plain, https: 'fails' });
    expect(r.note).toContain('DEPTH_ZERO_SELF_SIGNED_CERT');
    const doc = withLink(url, r);
    expect(actionFor(doc, url)).toBe('moved');
    expect(hintsOn(doc)[0]).toMatchObject({ short: 'https fails' });
  });

  it('https that fails with http failing too is unchecked, never a suggestion', async () => {
    const url = 'https://broken.example/x';
    const plain = 'http://broken.example/x';
    const r = await checkLink(url, pages({ [url]: certErr('CERT_HAS_EXPIRED'), [plain]: page(503, plain) }), NOW);
    expect(r.verdict).toBe('unchecked');
    expect(r.suggestion).toBeUndefined();
  });

  it("an http link whose https fails is the right link: no mark, and no deliverability warning", async () => {
    const url = 'http://bowlingalone.com/';
    const secure = 'https://bowlingalone.com/';
    const r = await checkLink(url, pages({ [url]: page(200, url), [secure]: certErr('DEPTH_ZERO_SELF_SIGNED_CERT') }), NOW);
    expect(r).toMatchObject({ verdict: 'ok', https: 'fails' });
    const doc = withLink(url, r);
    expect(hintsOn(doc)).toEqual([]);
    expect(contentFindings(doc).filter((f) => f.kind === 'http')).toEqual([]);
  });

  it('an http link whose https works: the deliverability note says to use it, on its row', async () => {
    const url = 'http://example.net/page';
    const secure = 'https://example.net/page';
    const r = await checkLink(url, pages({ [url]: page(200, url), [secure]: page(200, secure) }), NOW);
    expect(r).toMatchObject({ verdict: 'ok', https: 'works' });
    const doc = withLink(url, r);
    const http = contentFindings(doc).find((f) => f.kind === 'http')!;
    expect(http.message).toContain('https:// address works');
    expect(http.anchor).toBe('link-flipcash');
    const mail = (rowHints(doc).get('link-flipcash') ?? []).filter((h) => h.kind === 'mail');
    expect(mail.map((h) => h.key)).toEqual([http.key]);
  });
});
