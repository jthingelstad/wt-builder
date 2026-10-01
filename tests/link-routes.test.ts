/**
 * The link check over HTTP: the on-demand check, acting on a finding, moving
 * a bookmark, and the dead-link gate on the website and email legs (plan
 * 2026-10-01 §3). Pages are handed in (usePages) and Pinboard is stubbed;
 * nothing leaves this machine.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const work = mkdtempSync(join(tmpdir(), 'wt-link-routes-'));
process.env.WT_BUILDER_DB = join(work, 'routes.db');

const { server } = await import('../src/server/index.ts');
const store = await import('../src/server/db.ts');
const config = await import('../src/server/config.ts');
const pinboard = await import('../src/server/integrations/pinboard.ts');
const { usePages } = await import('../src/server/link-check.ts');
const { useDns } = await import('../src/server/domain-check.ts');

let base = '';
const realFetch = globalThis.fetch;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
  pinboard.PACE.ms = 0;
});

afterAll(async () => {
  usePages(null);
  useDns(null);
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(work, { recursive: true, force: true });
});

const SHORT = 'https://t.co/abc';
const FULL = 'https://example.com/story';
const DEAD = 'https://example.com/gone';

const page = (status: number, url: string) =>
  ({ status, url, contentType: 'text/html', text: async () => '<html></html>', discard: async () => {} });

/** Every fetch the check makes, in order. */
let fetched: string[] = [];

beforeEach(() => {
  fetched = [];
  usePages(async (url) => {
    fetched.push(url);
    if (url === SHORT) return page(200, FULL);
    if (url === DEAD) return page(404, DEAD);
    return page(200, url);
  });
});

async function post(path: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** A draft with one Pinboard link and one link in its commentary. */
async function draft(number: number, link = SHORT, inline = 'https://example.org/fine'): Promise<string> {
  const saturday = new Date(Date.UTC(2027, 5, 5 + 7 * (number - 990100))).toISOString().slice(0, 10);
  const created = await post('/api/issues', { number, publication_date: saturday });
  const id = created.body.issue.issue.id as string;
  const doc = store.getIssue(id)!.doc;
  doc.items['link-one'] = {
    type: 'pinboard_link', authorship: 'syndicated', source: 'Pinboard',
    channels: { website: true, email: true, audio: true },
    source_id: `pinboard:hash-old`, source_url: link,
    title: 'A story', commentary: `Worth it. See also [this](${inline}).`, tags: ['notable'], section: 'Notable',
    source_snapshot: { title: 'A story', commentary: `Worth it. See also [this](${inline}).`, tags: ['notable'] },
    source_flags: { toread: 'yes', shared: 'no' },
    sync_state: 'synced',
  };
  doc.nodes.find((n) => n.id === 'notable')!.items.push('link-one');
  store.saveIssue(doc);
  return id;
}

describe('POST /links/check', () => {
  it('fetches every printed link and stores what answered', async () => {
    const id = await draft(990100);
    const { status, body } = await post(`/api/issues/${id}/links/check`);
    expect(status).toBe(200);
    expect(fetched).toEqual(expect.arrayContaining([SHORT, 'https://example.org/fine']));
    const results = body.issue.link_check.results;
    expect(results[SHORT]).toMatchObject({ verdict: 'moved', suggestion: FULL, note: 'shortened' });
    expect(results['https://example.org/fine'].verdict).toBe('ok');
    const unit = body.readiness.units.find((u: { title: string }) => u.title === 'Links checked');
    expect(unit).toMatchObject({ state: 'partial', kind: 'links', anchor: 'link-one' });
  });
});

describe('POST /items/:id/link', () => {
  it('use prints the suggestion and leaves source_url alone; original goes back', async () => {
    const id = await draft(990101);
    await post(`/api/issues/${id}/links/check`);
    const used = await post(`/api/issues/${id}/items/link-one/link`, { action: 'use' });
    expect(used.status).toBe(200);
    const item = used.body.issue.items['link-one'];
    expect(item.canonical_url).toBe(FULL);
    expect(item.source_url).toBe(SHORT);
    const back = await post(`/api/issues/${id}/items/link-one/link`, { action: 'original' });
    expect(back.body.issue.items['link-one'].canonical_url).toBeUndefined();
  });

  it('use without a suggestion is refused', async () => {
    const id = await draft(990102, 'https://example.com/plain');
    await post(`/api/issues/${id}/links/check`);
    const res = await post(`/api/issues/${id}/items/link-one/link`, { action: 'use' });
    expect(res.status).toBe(409);
  });

  it('keep stops counting a finding', async () => {
    const id = await draft(990103, DEAD);
    await post(`/api/issues/${id}/links/check`);
    const kept = await post(`/api/issues/${id}/items/link-one/link`, { action: 'keep', url: DEAD });
    expect(kept.body.issue.link_check.accepted).toEqual([DEAD]);
    const unit = kept.body.readiness.units.find((u: { title: string }) => u.title === 'Links checked');
    expect(unit.state).toBe('done');
  });
});

describe('the dead-link gate on the website and email legs', () => {
  for (const destination of ['website', 'buttondown'] as const) {
    it(`${destination}: checks first, refuses a dead link with dead_links, and leaves the leg alone`, async () => {
      const id = await draft(destination === 'website' ? 990104 : 990105, DEAD);
      const res = await post(`/api/issues/${id}/send/${destination}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('dead_links');
      expect(res.body.error).toContain(DEAD);
      expect(fetched).toContain(DEAD);
      const doc = store.getIssue(id)!.doc;
      expect(doc.link_check!.results[DEAD]!.verdict).toBe('dead');
      expect(doc.sends?.[destination]).toBeUndefined();
    });
  }

  it('?force=1 goes past it and records the link as kept, so the next send does not ask', async () => {
    const id = await draft(990106, DEAD);
    // Past the gate the leg goes on to its own work, which fails offline;
    // what matters here is that the gate let it through and said so.
    await post(`/api/issues/${id}/send/website?force=1`);
    const doc = store.getIssue(id)!.doc;
    expect(doc.link_check!.accepted).toEqual([DEAD]);
    fetched = [];
    const again = await post(`/api/issues/${id}/send/website?force=1`);
    expect(again.body.code).not.toBe('dead_links');
    expect(fetched).toEqual([]); // nothing new to check
  });
});

describe('the blocklist gate on the email leg', () => {
  // example.org (the commentary's link) is on URIBL's red list here.
  const listing = {
    async a(name: string) {
      return ({
        'ns.uribl.test': ['192.0.2.53'],
        'test.uribl.com.multi.uribl.com': ['127.0.0.14'],
        'example.org.multi.uribl.com': ['127.0.0.8'],
      } as Record<string, string[]>)[name] ?? [];
    },
    async ns() { return ['ns.uribl.test']; },
  };
  beforeEach(() => useDns(listing));
  afterEach(() => useDns(null));

  it('POST /links/check looks the domains up beside the links', async () => {
    const id = await draft(990120);
    const { body } = await post(`/api/issues/${id}/links/check`);
    expect(body.issue.domain_check.results['example.org']).toMatchObject({ verdict: 'listed', lists: ['URIBL: red list'] });
    const unit = body.readiness.units.find((u: { title: string }) => u.title === 'Deliverability');
    expect(unit).toMatchObject({ state: 'partial', kind: 'mail', anchor: 'link-one' });
  });

  it('refuses the email with listed_domains, and leaves the leg alone', async () => {
    const id = await draft(990121);
    const res = await post(`/api/issues/${id}/send/buttondown`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('listed_domains');
    expect(res.body.error).toContain('example.org (URIBL: red list)');
    expect(store.getIssue(id)!.doc.sends?.buttondown).toBeUndefined();
  });

  it('never stops the website: a blocklist is a mail filter\'s', async () => {
    const id = await draft(990122);
    const res = await post(`/api/issues/${id}/send/website`);
    expect(res.body.code).not.toBe('listed_domains');
  });

  it('?force=1 sends past it and records the domain, so the next send does not ask', async () => {
    const id = await draft(990123);
    await post(`/api/issues/${id}/send/buttondown?force=1`);
    expect(store.getIssue(id)!.doc.domain_check!.accepted).toEqual(['example.org']);
    const again = await post(`/api/issues/${id}/send/buttondown`);
    expect(again.body.code).not.toBe('listed_domains');
  });

  it('POST /deliverability/keep keeps a finding and puts it back', async () => {
    const id = await draft(990124, SHORT, 'http://example.org/plain');
    const key = 'http:http://example.org/plain';
    const kept = await post(`/api/issues/${id}/deliverability/keep`, { key });
    expect(kept.body.issue.deliverability.kept).toEqual([key]);
    const back = await post(`/api/issues/${id}/deliverability/keep`, { key, keep: false });
    expect(back.body.issue.deliverability.kept).toEqual([]);
    expect((await post(`/api/issues/${id}/deliverability/keep`, {})).status).toBe(400);
  });
});

describe('POST /items/:id/move-bookmark', () => {
  let calls: { path: string; params: URLSearchParams }[];
  let atNew: boolean;
  let deleteAnswer: string;

  beforeEach(() => {
    calls = [];
    atNew = false;
    deleteAnswer = 'done';
    config.credentials.pinboardToken = 'test-token';
    config.config.pinboardWriteBack = true;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== 'api.pinboard.in') return realFetch(input, init);
      const path = url.pathname.replace('/v1', '');
      calls.push({ path, params: url.searchParams });
      if (path === '/posts/get') {
        const asked = url.searchParams.get('url');
        if (asked === SHORT) {
          return Response.json({ posts: [{
            href: SHORT, description: 'A story', extended: 'Worth it.', tags: 'notable _brief',
            time: '2027-06-01T14:00:00Z', toread: 'no', shared: 'no', hash: 'hash-old',
          }] });
        }
        return Response.json({ posts: atNew ? [{ href: FULL, hash: 'hash-new', time: '2027-06-01T14:00:00Z' }] : [] });
      }
      if (path === '/posts/add') {
        atNew = true;
        return Response.json({ result_code: 'done' });
      }
      if (path === '/posts/delete') return Response.json({ result_code: deleteAnswer });
      throw new Error(`unexpected Pinboard call ${path}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    config.credentials.pinboardToken = undefined;
    config.config.pinboardWriteBack = false;
  });

  it('copies every field to the new URL, deletes the old, and the item follows', async () => {
    const id = await draft(990107);
    await post(`/api/issues/${id}/links/check`);
    await post(`/api/issues/${id}/items/link-one/link`, { action: 'use' });
    const res = await post(`/api/issues/${id}/items/link-one/move-bookmark`);
    expect(res.status).toBe(200);
    expect(res.body.result.removed).toBe(true);
    expect(calls.map((c) => c.path)).toEqual(['/posts/get', '/posts/get', '/posts/add', '/posts/get', '/posts/delete']);
    const add = calls.find((c) => c.path === '/posts/add')!.params;
    expect(Object.fromEntries(['url', 'description', 'extended', 'tags', 'dt', 'toread', 'shared', 'replace'].map((k) => [k, add.get(k)])))
      .toEqual({ url: FULL, description: 'A story', extended: 'Worth it.', tags: 'notable _brief', dt: '2027-06-01T14:00:00Z', toread: 'no', shared: 'no', replace: 'no' });
    expect(calls.at(-1)!.params.get('url')).toBe(SHORT);
    const item = store.getIssue(id)!.doc.items['link-one']!;
    expect(item.source_url).toBe(FULL);
    expect(item.source_id).toBe('pinboard:hash-new');
    expect(item.canonical_url).toBeUndefined();
  });

  it('never adds over a bookmark already at the new URL', async () => {
    const id = await draft(990108);
    await post(`/api/issues/${id}/links/check`);
    await post(`/api/issues/${id}/items/link-one/link`, { action: 'use' });
    atNew = true;
    const res = await post(`/api/issues/${id}/items/link-one/move-bookmark`);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('already has a bookmark');
    expect(calls.some((c) => c.path === '/posts/add' || c.path === '/posts/delete')).toBe(false);
    expect(store.getIssue(id)!.doc.items['link-one']!.source_url).toBe(SHORT);
  });

  it('says so when the old bookmark could not be deleted', async () => {
    const id = await draft(990109);
    await post(`/api/issues/${id}/links/check`);
    await post(`/api/issues/${id}/items/link-one/link`, { action: 'use' });
    deleteAnswer = 'something went wrong';
    const res = await post(`/api/issues/${id}/items/link-one/move-bookmark`);
    expect(res.status).toBe(200);
    expect(res.body.result.removed).toBe(false);
    expect(store.getIssue(id)!.doc.items['link-one']!.source_url).toBe(FULL);
  });

  it('refuses an item with an edit Pinboard does not have, and one with nothing applied', async () => {
    const id = await draft(990110);
    const none = await post(`/api/issues/${id}/items/link-one/move-bookmark`);
    expect(none.status).toBe(409);
    await post(`/api/issues/${id}/links/check`);
    await post(`/api/issues/${id}/items/link-one/link`, { action: 'use' });
    const doc = store.getIssue(id)!.doc;
    doc.items['link-one']!.sync_state = 'failed';
    store.saveIssue(doc);
    const res = await post(`/api/issues/${id}/items/link-one/move-bookmark`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('write it back first');
    expect(calls).toEqual([]);
  });
});
