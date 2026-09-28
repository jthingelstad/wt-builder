/**
 * Website verification, against a stubbed site: nothing here reaches the
 * network. What is asserted is what the Send view's card would say.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { renderEmail } from '../src/shared/render/email.ts';
import { emailSubject, subjectFor } from '../src/server/publish.ts';
import * as buttondown from '../src/server/integrations/buttondown.ts';
import { verifyButtondown, verifyWebsite } from '../src/server/verify.ts';

// Buttondown answers from here; nothing in this file reaches its API.
vi.mock('../src/server/integrations/buttondown.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/buttondown.ts')>()),
  getEmail: vi.fn(),
  getDelivery: vi.fn(async () => { throw new Error('the Buttondown check asked for delivery counts of a draft'); }),
}));

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

describe('the Buttondown check compares the subject as it was sent', () => {
  // Review round 2: the leg sends emailSubject (a brace-tag title broken
  // with a zero-width space, review 2026-09-27 §3). The check has to compare
  // against the same string, or every such draft reads as edited.
  const tagged = (): IssueDoc => {
    const d = structuredClone(doc);
    d.issue.title = 'Moving {{ braces }} and {% blocks %}';
    d.sends = { buttondown: { status: 'sent', at: '2026-09-28T12:00:00Z', external_id: 'em-test' } };
    return d;
  };
  const draft = (subject: string, d: IssueDoc) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`the Buttondown check reached off the machine: ${url}`); }));
    vi.mocked(buttondown.getEmail).mockResolvedValue({ subject, status: 'draft', body: renderEmail(d).trim() });
  };

  it('passes a draft whose subject is the one the leg sent', async () => {
    const d = tagged();
    draft(emailSubject(d), d);
    const { checks } = await verifyButtondown(d);
    expect(checks.find((c) => c.label === 'Subject')?.ok).toBe(true);
    expect(checks.find((c) => c.label === 'Body')?.ok).toBe(true);
  });

  it('warns when the draft carries the raw title, template tags and all', async () => {
    const d = tagged();
    expect(subjectFor(d)).not.toBe(emailSubject(d));
    draft(subjectFor(d), d);
    const { checks } = await verifyButtondown(d);
    expect(checks.find((c) => c.label === 'Subject')?.ok).toBeNull();
  });
});
