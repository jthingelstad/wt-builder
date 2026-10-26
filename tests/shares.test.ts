/**
 * Sharing a published issue (docs/share-plan.md): the helpers, the table,
 * the routes over HTTP, the contents templates a share starts from, and the sweep that never
 * offers a share's own blog post to the next issue. The model and Micropub
 * are stubbed; no network is reached and nothing is posted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IssueDoc, Share } from '../src/shared/types.ts';
import { issueWindow } from '../src/shared/dates.ts';
import { blogContents, carriedRef, foldAt, linkedinContents, linksIssue, plainText, shareLink, startingText, LINKEDIN_FOLD } from '../src/shared/shares.ts';

const { create, createPost } = vi.hoisted(() => ({ create: vi.fn(), createPost: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create };
  }
  return { default: Anthropic };
});

vi.mock('../src/server/integrations/microblog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/microblog.ts')>()),
  createPost,
}));

const work = mkdtempSync(join(tmpdir(), 'wt-shares-'));
process.env.WT_BUILDER_DB = join(work, 'shares.db');

const { server } = await import('../src/server/index.ts');
const store = await import('../src/server/db.ts');

let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(work, { recursive: true, force: true });
});

beforeEach(() => {
  create.mockReset();
  createPost.mockReset();
});

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

const COMMENTARY = 'A paragraph of commentary that clears the bar for a Notable link, written the way Jamie writes them, with a reason to read it.';

/** A published issue, put to bed, numbered `n`. */
function sleeping(n: number): IssueDoc {
  const doc = fixture();
  doc.issue.id = `wt${n}`;
  doc.issue.number = n;
  doc.issue.status = 'published';
  doc.issue.put_to_bed_at = '2026-05-23T20:00:00.000Z';
  doc.items['link-flipcash']!.commentary = COMMENTARY;
  doc.items['link-functions']!.commentary = COMMENTARY;
  store.saveIssue(doc);
  return doc;
}

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/api/issues/${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const start = async (id: string, destination: string) => {
  const res = await call('POST', `${id}/shares`, { destination });
  expect(res.status).toBe(200);
  return (await res.json() as { share: Share }).share;
};

describe('the share helpers', () => {
  const doc = fixture();

  it('links the issue page with the destination and the issue as its ref', () => {
    // Jamie, 2026-10-11: one row per share in Tinylytics' Sources.
    expect(shareLink(doc, 'linkedin')).toBe(`https://weekly.thingelstad.com/archive/${doc.issue.number}/?ref=linkedin-wt${doc.issue.number}`);
    expect(shareLink(doc, 'blog')).toBe(`https://weekly.thingelstad.com/archive/${doc.issue.number}/?ref=blog-wt${doc.issue.number}`);
    const imported = { ...doc, issue: { ...doc.issue, number: 12, archive_url: 'https://weekly.thingelstad.com/archive/12/' } };
    expect(shareLink(imported, 'linkedin')).toBe('https://weekly.thingelstad.com/archive/12/?ref=linkedin-wt12');
  });

  it('reads the ref a share carried, then or now', () => {
    expect(carriedRef('Words.\n\nhttps://weekly.thingelstad.com/archive/353/?ref=linkedin', 353)).toBe('linkedin');
    expect(carriedRef('[Weekly Thing 354](https://weekly.thingelstad.com/archive/354/?ref=blog-wt354)', 354)).toBe('blog-wt354');
    expect(carriedRef('https://weekly.thingelstad.com/archive/354/?a=1&ref=linkedin-wt354#x', 354)).toBe('linkedin-wt354');
    expect(carriedRef('https://weekly.thingelstad.com/archive/354/', 354)).toBeUndefined();
    expect(carriedRef('https://weekly.thingelstad.com/archive/3540/?ref=blog', 354)).toBeUndefined();
  });


  it('knows the issue is linked with or without the ref', () => {
    expect(linksIssue(`see weekly.thingelstad.com/archive/${doc.issue.number}/`, doc)).toBe(true);
    expect(linksIssue(`[it](https://weekly.thingelstad.com/archive/${doc.issue.number}/?ref=blog)`, doc)).toBe(true);
    expect(linksIssue('no link here', doc)).toBe(false);
  });

  it('folds after three lines or about two hundred characters, and not a short post', () => {
    expect(foldAt('one\ntwo\nthree\nfour')).toBe('one\ntwo\nthree'.length);
    expect(foldAt('one\ntwo\nthree\n')).toBeNull();
    expect(foldAt('x'.repeat(LINKEDIN_FOLD + 50))).toBe(LINKEDIN_FOLD);
    expect(foldAt('short')).toBeNull();
  });

  it('makes a LinkedIn draft plain: link words kept, emphasis marks gone', () => {
    expect(plainText('Read [the piece](https://x.test/a_(b)) by **someone**, _really_.')).toBe('Read the piece by someone, really.');
    expect(plainText('snake_case_name stays')).toBe('snake_case_name stays');
  });
});

describe('the door lets shares through', () => {
  it('an issue put to bed takes a share, and still refuses an edit', async () => {
    sleeping(501);
    const share = await start('wt501', 'linkedin');
    expect(share).toMatchObject({ issue_id: 'wt501', destination: 'linkedin', state: 'draft' });
    expect(share.text).toMatch(/^Weekly Thing 501\n\nIn this issue:\n[\s\S]*\n\nhttps:\/\/weekly\.thingelstad\.com\/archive\/501\/\?ref=linkedin-wt501$/);
    expect((await call('PATCH', 'wt501/meta', { title: 'x' })).status).toBe(423);
    expect(store.listEvents('wt501').map((e) => e.summary)).toContain('Share started — LinkedIn');
  });

  it('a draft issue has no page to share', async () => {
    const doc = fixture();
    doc.issue.id = 'wt502';
    doc.issue.number = 502;
    store.saveIssue(doc);
    const res = await call('POST', 'wt502/shares', { destination: 'linkedin' });
    expect(res.status).toBe(409);
    expect(store.listShares('wt502')).toEqual([]);
  });

  it('only LinkedIn and a blog post', async () => {
    sleeping(503);
    expect((await call('POST', 'wt503/shares', { destination: 'reddit' })).status).toBe(400);
  });
});

describe('a LinkedIn share', () => {
  it('is edited, marked shared with its URL, and then is the record', async () => {
    sleeping(510);
    const s = await start('wt510', 'linkedin');
    const text = 'Words above the link.\n\nhttps://weekly.thingelstad.com/archive/510/?ref=linkedin';
    expect((await call('PATCH', `wt510/shares/${s.id}`, { text, title: 'ignored' })).status).toBe(200);
    expect(store.getShare(s.id)).toMatchObject({ text });
    expect(store.getShare(s.id)?.title).toBeUndefined();

    expect((await call('POST', `wt510/shares/${s.id}/shared`, { url: 'not a link' })).status).toBe(400);
    const res = await call('POST', `wt510/shares/${s.id}/shared`, { url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/' });
    expect(res.status).toBe(200);
    const done = store.getShare(s.id)!;
    expect(done.state).toBe('shared');
    expect(done.url).toBe('https://www.linkedin.com/feed/update/urn:li:activity:1/');
    expect(done.shared_at).toBeTruthy();

    expect((await call('PATCH', `wt510/shares/${s.id}`, { text: 'changed' })).status).toBe(409);
    expect((await call('DELETE', `wt510/shares/${s.id}`)).status).toBe(409);
    expect((await call('POST', `wt510/shares/${s.id}/shared`, {})).status).toBe(409);
    expect(store.getShare(s.id)?.text).toBe(text);
  });

  it('takes either link LinkedIn hands out: the post\'s address, or "Link to this post", a short lnkd.in one', async () => {
    // WT354: Share gave the long /posts/ address, "Link to this post" a short one (Jamie, 2026-10-25).
    sleeping(511);
    const long = 'https://www.linkedin.com/posts/jthingelstad_weekly-thing-354-a-museum-for-nnxyz-art-share-7520215199014879233-ITDK/?utm_source=share&utm_medium=member_desktop';
    const short = 'https://lnkd.in/p/gmsVxuKe';
    for (const url of [long, short]) {
      const s = await start('wt511', 'linkedin');
      expect((await call('POST', `wt511/shares/${s.id}/shared`, { url })).status).toBe(200);
      expect(store.getShare(s.id)).toMatchObject({ state: 'shared', url });
    }
  });

  it('is not posted from here, and belongs to its own issue', async () => {
    sleeping(511);
    sleeping(512);
    const s = await start('wt511', 'linkedin');
    expect((await call('POST', `wt511/shares/${s.id}/post`)).status).toBe(400);
    expect((await call('PATCH', `wt512/shares/${s.id}`, { text: 'x' })).status).toBe(404);
    expect(createPost).not.toHaveBeenCalled();
  });

  it('a draft is deleted', async () => {
    sleeping(513);
    const s = await start('wt513', 'linkedin');
    expect((await call('DELETE', `wt513/shares/${s.id}`)).status).toBe(200);
    expect(store.getShare(s.id)).toBeNull();
  });
});

describe('a blog share', () => {
  it('posts once through Micropub under Weekly Thing, and records the post', async () => {
    sleeping(520);
    const s = await start('wt520', 'blog');
    const text = 'What this issue had.\n\n[Weekly Thing 520](https://weekly.thingelstad.com/archive/520/?ref=blog)';
    await call('PATCH', `wt520/shares/${s.id}`, { text, title: 'A title' });
    createPost.mockResolvedValue('https://www.thingelstad.com/2026/05/23/weekly-thing.html');

    const res = await call('POST', `wt520/shares/${s.id}/post`);
    expect(res.status).toBe(200);
    expect(createPost).toHaveBeenCalledWith({ title: 'A title', content: text, category: ['Weekly Thing'] });
    expect(store.getShare(s.id)).toMatchObject({ state: 'shared', url: 'https://www.thingelstad.com/2026/05/23/weekly-thing.html' });
    expect(store.sharedBlogUrls()).toContain('https://www.thingelstad.com/2026/05/23/weekly-thing.html');

    expect((await call('POST', `wt520/shares/${s.id}/post`)).status).toBe(409);
    expect(createPost).toHaveBeenCalledTimes(1);
  });

  it('starts titled as the email was; a LinkedIn share has no title', async () => {
    const doc = sleeping(523);
    doc.issue.title = 'Interviewing Otto for the Job';
    store.saveIssue(doc);
    expect((await start('wt523', 'blog')).title).toBe('WT523 — Interviewing Otto for the Job');
    expect((await start('wt523', 'linkedin')).title).toBeUndefined();
  });

  it('a refused post stays a draft, and says why', async () => {
    sleeping(521);
    const s = await start('wt521', 'blog');
    createPost.mockRejectedValue(new Error('Micro.blog refused the post: 401 Unauthorized'));
    const res = await call('POST', `wt521/shares/${s.id}/post`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('401');
    expect(store.getShare(s.id)?.state).toBe('draft');
  });

  it('a double click makes one post', async () => {
    sleeping(522);
    const s = await start('wt522', 'blog');
    let land!: (url: string) => void;
    createPost.mockReturnValue(new Promise<string>((r) => { land = r; }));
    const first = call('POST', `wt522/shares/${s.id}/post`);
    await vi.waitFor(() => expect(createPost).toHaveBeenCalled());
    expect((await call('POST', `wt522/shares/${s.id}/post`)).status).toBe(409);
    land('https://www.thingelstad.com/2026/05/30/one.html');
    expect((await first).status).toBe(200);
    expect(createPost).toHaveBeenCalledTimes(1);
  });
});

describe('the contents templates a share starts from', () => {
  // Jamie, 2026-10-11: a list of what is in the issue, plainly neither Jamie
  // writing nor a model pretending to be him. Nothing is generated.
  const issue = () => {
    const doc = fixture();
    doc.issue.title = 'Release Notes for Every Day';
    doc.issue.dek = 'Release Notes, Claude Haiku 5.5, zkAPI';
    return doc;
  };

  it('LinkedIn: the name, the Notable links as the pages title them (no sites), the rest counted, the link last', () => {
    const doc = issue();
    doc.sends = { ...doc.sends, podcast: { status: 'sent', at: '2026-05-23T12:00:00.000Z', audio: { audio_duration_seconds: 1018 } } } as IssueDoc['sends'];
    expect(linkedinContents(doc)).toBe([
      'Weekly Thing 350: Release Notes for Every Day',
      'In this issue:\n- Create Your Own Currency With Flipcash\n- LLMs are functions, not brains.',
      'Plus 3 more links, 4 journal posts, a photo, and a 17-minute audio edition.',
      'https://weekly.thingelstad.com/archive/350/?ref=linkedin-wt350',
    ].join('\n\n'));
    // Plain text: LinkedIn shows Markdown as typed.
    expect(plainText(linkedinContents(doc))).toBe(linkedinContents(doc));
    // No site beside a title: LinkedIn links a bare domain and cards the first one (WT354).
    expect(linkedinContents(doc).replace(/https:\/\/weekly\.thingelstad\.com\S*/, '')).not.toMatch(/\b[a-z0-9-]+\.(?:com|xyz|org|net|io|run|im|works)\b/i);
    expect(startingText(doc, 'linkedin')).toBe(linkedinContents(doc));
  });

  it('LinkedIn: a title that names the issue is not said twice; no podcast, no audio line', () => {
    const doc = issue();
    doc.issue.title = 'Weekly Thing for May 13, 2017';
    const text = linkedinContents(doc);
    expect(text.startsWith('Weekly Thing 350\n\n')).toBe(true);
    expect(text).not.toContain('audio');
  });

  it('LinkedIn: a pre-Builder record is its name, its dek and the link, never its body parsed', () => {
    const doc = issue();
    doc.issue.imported = true;
    expect(linkedinContents(doc)).toBe(
      'Weekly Thing 350: Release Notes for Every Day\n\nRelease Notes, Claude Haiku 5.5, zkAPI\n\nhttps://weekly.thingelstad.com/archive/350/?ref=linkedin-wt350',
    );
  });

  it('blog: the same contents in Markdown, titles alone, with no name line (the subject titles it), ending on the link', () => {
    const doc = issue();
    doc.items['link-functions']!.title = 'A *starred* [bracketed] title';
    expect(blogContents(doc)).toBe([
      'In this issue:',
      '- Create Your Own Currency With Flipcash\n- A \\*starred\\* \\[bracketed\\] title',
      'Plus 3 more links, 4 journal posts, and a photo.',
      '[Weekly Thing 350](https://weekly.thingelstad.com/archive/350/?ref=blog-wt350)',
    ].join('\n\n'));
  });

  it('blog: a pre-Builder record is its dek, Jamie\'s own words, ending on a Markdown link', () => {
    const doc = issue();
    doc.issue.imported = true;
    expect(blogContents(doc)).toBe('Release Notes, Claude Haiku 5.5, zkAPI. [Weekly Thing 350](https://weekly.thingelstad.com/archive/350/?ref=blog-wt350)');
    doc.issue.dek = 'Ends on its own stop.';
    expect(blogContents(doc)).toBe('Ends on its own stop. [Weekly Thing 350](https://weekly.thingelstad.com/archive/350/?ref=blog-wt350)');
    doc.issue.dek = '';
    expect(startingText(doc, 'blog')).toBe('[Weekly Thing 350](https://weekly.thingelstad.com/archive/350/?ref=blog-wt350)');
  });

  it('a new share starts from its template, and there is no share wand to ask', async () => {
    const doc = sleeping(530);
    const s = await start('wt530', 'blog');
    expect(s.text).toBe(blogContents(doc));
    expect(s.title).toMatch(/^WT530 — /);
    expect((await call('POST', `wt530/shares/${s.id}/draft`)).status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the sweep skips a share\'s blog post', () => {
  it('by URL, whatever the scheme or trailing slash, and keeps Jamie\'s own Weekly Thing posts', async () => {
    const { credentials } = await import('../src/server/config.ts');
    const { sweepMicroblog } = await vi.importActual<typeof import('../src/server/integrations/microblog.ts')>('../src/server/integrations/microblog.ts');
    credentials.microblogToken = 'test-token';
    const post = (url: string) => ({ type: ['h-entry'], properties: {
      url: [url], published: ['2026-05-20T15:00:00Z'], content: ['words'], category: ['Weekly Thing'],
    } });
    vi.stubGlobal('fetch', async () => Response.json({ items: [
      post('https://www.thingelstad.com/2026/05/20/announcing.html'),
      post('https://www.thingelstad.com/2026/05/20/about-the-weekly-thing.html'),
    ] }));
    try {
      const swept = await sweepMicroblog(
        issueWindow('2026-05-23', 7),
        ['http://WWW.thingelstad.com/2026/05/20/announcing.html/'],
      );
      expect(swept.map((c) => c.url)).toEqual(['https://www.thingelstad.com/2026/05/20/about-the-weekly-thing.html']);
    } finally {
      vi.unstubAllGlobals();
      credentials.microblogToken = undefined;
    }
  });
});

describe('createPost', () => {
  it('sends an h-entry and answers the Location; no Location is a failure', async () => {
    const { credentials } = await import('../src/server/config.ts');
    const real = await vi.importActual<typeof import('../src/server/integrations/microblog.ts')>('../src/server/integrations/microblog.ts');
    credentials.microblogToken = 'test-token';
    let sent: unknown;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(null, { status: 202, headers: { Location: 'https://www.thingelstad.com/2026/05/23/p.html' } });
    });
    try {
      expect(await real.createPost({ title: ' ', content: 'hi', category: ['Weekly Thing'] })).toBe('https://www.thingelstad.com/2026/05/23/p.html');
      expect(sent).toEqual({ type: ['h-entry'], properties: { content: ['hi'], category: ['Weekly Thing'] } });
      vi.stubGlobal('fetch', async () => new Response(null, { status: 201 }));
      await expect(real.createPost({ content: 'hi', category: ['Weekly Thing'] })).rejects.toThrow('without the new post');
    } finally {
      vi.unstubAllGlobals();
      credentials.microblogToken = undefined;
    }
  });
});

describe('the Share view survives a content blocker', () => {
  // Social filter lists hide elements named like share buttons; the New
  // share row vanished in Jamie's Safari on the first day (2026-10-07).
  it('names no class or attribute "share" or "linkedin", and holds no linkedin.com href', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/client/components/Share.tsx', import.meta.url)), 'utf8');
    const names = [...src.matchAll(/\b(?:class|data-[a-z-]+|id)=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => (m[1] ?? m[2]!).replace(/\$\{[^}]*\}/g, ' '));
    // Interpolated parts are code; what renders is the literal text plus the values below.
    expect(src).toContain("linkedin ? 'dest-li' : 'dest-blog'");
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(n).not.toMatch(/share|linkedin|social/i);
    expect(src).not.toMatch(/href=\{?[^>]*linkedin/i);
    const css = readFileSync(fileURLToPath(new URL('../src/client/styles.css', import.meta.url)), 'utf8');
    const block = css.slice(css.indexOf('the Share view: a layer like Send'), css.indexOf('.after {'));
    expect(block).not.toMatch(/\.(share|linkedin)/);
  });
});
