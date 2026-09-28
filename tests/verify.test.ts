/**
 * Website verification, against a stubbed site: nothing here reaches the
 * network. What is asserted is what the Send view's card would say.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { verifyWebsite } from '../src/server/verify.ts';

const doc = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;

/** The live page answers with this HTML; any other URL is a 404. */
function site(html: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url.startsWith('https://weekly.thingelstad.com/archive/350/')
      ? new Response(html, { status: 200 })
      : new Response('', { status: 404 })));
}

const page = (body: string) =>
  `<html><body><h1>${doc.issue.title}</h1><img src="/img/jamie-thingelstad.jpg" alt="">${body}</body></html>`;

afterEach(() => vi.unstubAllGlobals());

describe('the website check reads the page for hotlinks', () => {
  // Review 2026-09-27 §2.2: a first send shipped every new Journal photo as
  // the Micro.blog original. An image the page loads from anywhere but the
  // CDN (or the site itself) is a warning, with the URLs named.
  it('warns, naming each image the page loads from off the CDN', async () => {
    site(page([
      '<p><img src="https://files.thingelstad.com/weekly-thing/350/a.jpg" alt="kept"></p>',
      '<p><img alt="hotlinked" src="https://www.thingelstad.com/uploads/2026/dakota.jpg"></p>',
      "<p><img src='http://example.com/b.png'></p>",
    ].join('')));
    const checks = await verifyWebsite(doc);
    const hotlinks = checks.find((c) => c.label === 'No hotlinks');
    expect(hotlinks?.ok).toBeNull();
    expect(hotlinks?.items).toEqual([
      'https://www.thingelstad.com/uploads/2026/dakota.jpg',
      'http://example.com/b.png',
    ]);
  });

  it('passes when every image is on the CDN or the site itself', async () => {
    site(page('<p><img src="https://files.thingelstad.com/weekly-thing/350/a.jpg" alt=""></p>'));
    const checks = await verifyWebsite(doc);
    expect(checks.find((c) => c.label === 'No hotlinks')?.ok).toBe(true);
  });
});
