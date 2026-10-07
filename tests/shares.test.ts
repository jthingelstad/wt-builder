/**
 * Sharing a published issue (docs/share-plan.md): the helpers, the table,
 * the routes over HTTP, the wand's post-processing, and the sweep that never
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
import { foldAt, linksIssue, plainText, shareLink, startingText, LINKEDIN_FOLD } from '../src/shared/shares.ts';

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

  it('links the issue page with the destination as its ref', () => {
    expect(shareLink(doc, 'linkedin')).toBe(`https://weekly.thingelstad.com/archive/${doc.issue.number}/?ref=linkedin`);
    expect(startingText(doc, 'blog')).toBe(`https://weekly.thingelstad.com/archive/${doc.issue.number}/?ref=blog`);
    const imported = { ...doc, issue: { ...doc.issue, archive_url: 'https://weekly.thingelstad.com/archive/12/' } };
    expect(shareLink(imported, 'linkedin')).toBe('https://weekly.thingelstad.com/archive/12/?ref=linkedin');
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
    expect(share.text).toBe('https://weekly.thingelstad.com/archive/501/?ref=linkedin');
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

describe('the share wand', () => {
  const answer = (candidates: unknown[]) => create.mockResolvedValue({
    stop_reason: 'end_turn', stop_details: null,
    content: [{ type: 'text', text: JSON.stringify({ candidates }) }],
  });

  it('LinkedIn: leads named, made plain, the link always last; nothing written', async () => {
    sleeping(530);
    const s = await start('wt530', 'linkedin');
    answer([
      { lead: 'link-flipcash', title: 'dropped', text: 'About [Flipcash](https://x.test/) and **why**.\n\nWeekly Thing 530 has more.' },
      { lead: 'link-functions', title: '', text: 'Second.\n\nhttps://weekly.thingelstad.com/archive/530/?ref=linkedin' },
      { lead: 'nope', title: '', text: '   ' },
    ]);
    const res = await call('POST', `wt530/shares/${s.id}/draft`);
    expect(res.status).toBe(200);
    const { candidates } = await res.json() as { candidates: { lead?: string; lead_title?: string; title?: string; text: string }[] };
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ lead: 'link-flipcash', text: 'About Flipcash and why.\n\nWeekly Thing 530 has more.\n\nhttps://weekly.thingelstad.com/archive/530/?ref=linkedin' });
    expect(candidates[0]!.title).toBeUndefined();
    expect(candidates[1]!.text.match(/archive\/530/g)).toHaveLength(1);

    // The prompt carries Jamie's strategy and the Notable links by id.
    const params = create.mock.calls[0]![0] as { system: string; messages: { content: string }[] };
    expect(params.system).toContain('lead with the strongest Notable link');
    expect(params.messages[0]!.content).toContain('id: link-flipcash');
    expect(store.getShare(s.id)?.text).toBe('https://weekly.thingelstad.com/archive/530/?ref=linkedin');
  });

  it('blog: a title only when given, and the issue linked in Markdown when missing', async () => {
    sleeping(531);
    const s = await start('wt531', 'blog');
    answer([{ lead: '', title: 'A week of it', text: 'This issue had a photo.' }]);
    const { candidates } = await (await call('POST', `wt531/shares/${s.id}/draft`)).json() as { candidates: { title?: string; text: string }[] };
    expect(candidates[0]).toEqual({ title: 'A week of it', text: 'This issue had a photo.\n\n[Weekly Thing 531](https://weekly.thingelstad.com/archive/531/?ref=blog)' });
  });

  it('nothing back is a failure the error bar can say', async () => {
    sleeping(532);
    const s = await start('wt532', 'linkedin');
    answer([]);
    const res = await call('POST', `wt532/shares/${s.id}/draft`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).error).toContain('came back empty');
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
