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
import { verifierFor, verifyButtondown, verifyWebsite } from '../src/server/verify.ts';

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
    const { checks } = await verifyWebsite(doc);
    const hotlinks = checks.find((c) => c.label === 'No hotlinks');
    expect(hotlinks?.ok).toBeNull();
    expect(hotlinks?.items).toEqual([
      'https://www.thingelstad.com/uploads/2026/dakota.jpg',
      'http://example.com/b.png',
    ]);
  });

  it('passes when every image is on the CDN or the site itself', async () => {
    site(page('<p><img src="https://files.thingelstad.com/weekly-thing/350/a.jpg" alt=""></p>'));
    const { checks } = await verifyWebsite(doc);
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

  it('records what Buttondown says the email is, for the Send view', async () => {
    const d = tagged();
    draft(emailSubject(d), d);
    expect((await verifyButtondown(d)).remote_status).toBe('draft');
  });

  it('warns when the draft carries the raw title, template tags and all', async () => {
    const d = tagged();
    expect(subjectFor(d)).not.toBe(emailSubject(d));
    draft(subjectFor(d), d);
    const { checks } = await verifyButtondown(d);
    expect(checks.find((c) => c.label === 'Subject')?.ok).toBeNull();
  });
});

describe('the website check waits for this send\'s deploy, not the last one', () => {
  // Review 2026-09-27 §2.3: the deploy wait ended as soon as the page
  // answered with the title, which the previous build already does. After
  // "podcast re-run, then website re-send" the check read the old page and
  // told Jamie to re-send the website, which he had just done.
  const FILE = 'wt350-take-2.mp3';
  const OLD = 'wt350-take-1.mp3';
  const audio = {
    audio_url: `https://files.thingelstad.com/weekly-thing/audio/${FILE}`,
    audio_chapters_url: `https://files.thingelstad.com/weekly-thing/audio/${FILE.replace('.mp3', '.chapters.json')}`,
    audio_transcript_url: `https://files.thingelstad.com/weekly-thing/audio/${FILE.replace('.mp3', '.vtt')}`,
  };
  const sentAt = (minutesAgo: number): IssueDoc => {
    const d = structuredClone(doc);
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    d.sends = {
      podcast: { status: 'sent', at, url: audio.audio_url, audio },
      website: { status: 'sent', at, external_id: 'f00d', url: 'https://github.com/x/y/commit/f00d' },
    };
    return d;
  };
  const embedding = (file: string) => page([
    `<audio src="https://files.thingelstad.com/weekly-thing/audio/${file}"></audio>`,
    `<a href="https://files.thingelstad.com/weekly-thing/audio/${file.replace('.mp3', '.chapters.json')}">c</a>`,
    `<a href="https://files.thingelstad.com/weekly-thing/audio/${file.replace('.mp3', '.vtt')}">t</a>`,
  ].join(''));
  /** The site serves each page in turn (the last one from then on); the feed has this episode. */
  function deploys(...pages: string[]) {
    let served = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://weekly.thingelstad.com/archive/350/')) {
        const html = pages[Math.min(served++, pages.length - 1)]!;
        return new Response(html, { status: 200 });
      }
      if (url.startsWith('https://weekly.thingelstad.com/podcast.xml')) {
        return new Response(`<guid>weekly-thing-350-audio</guid><enclosure url="${audio.audio_url}"/>`, { status: 200 });
      }
      return new Response('', { status: 404 });
    }));
  }

  it('an old page, then the new one: it waits, and passes on the new deploy', async () => {
    vi.useFakeTimers();
    deploys(embedding(OLD), embedding(OLD), embedding(FILE));
    const pending = verifyWebsite(sentAt(1), { wait: true });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    const { checks, recheckMs } = await pending;
    expect(recheckMs).toBeUndefined();
    expect(checks.find((c) => c.label === 'Page live')?.ok).toBe(true);
    expect(checks.find((c) => c.label === 'Page audio')?.ok).toBe(true);
    expect(checks.some((c) => c.ok === false)).toBe(false);
  });

  it('a page that never updates is waiting, with a recheck, not a problem', async () => {
    vi.useFakeTimers();
    deploys(embedding(OLD));
    const pending = verifyWebsite(sentAt(1), { wait: true });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const { checks, recheckMs } = await pending;
    expect(recheckMs).toBeGreaterThan(0);
    expect(checks.some((c) => c.ok === false)).toBe(false);
    expect(checks.find((c) => c.label === 'Page live')?.ok).toBeNull();
  });

  it('long after the send, a page without this audio is judged: re-send the website', async () => {
    deploys(embedding(OLD));
    const { checks, recheckMs } = await verifyWebsite(sentAt(180));
    expect(recheckMs).toBeUndefined();
    expect(checks.find((c) => c.label === 'Page audio')?.ok).toBe(false);
  });

  it('the recheck the Send view schedules is a waiting verdict', async () => {
    deploys(embedding(OLD));
    const verify = verifierFor('website')!;
    const { recheckMs, checks } = await verify(sentAt(1), false);
    expect(recheckMs).toBeGreaterThan(0);
    expect(checks.every((c) => c.ok !== false)).toBe(true);
  });
});
