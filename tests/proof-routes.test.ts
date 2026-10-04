/**
 * Review → Apply over HTTP: POST /api/issues/:id/proof (2026-10-04). The
 * note is found in the stored review, never trusted from the client; the
 * fix is made on a fresh read, logged as an edit, and written back like a
 * hand edit; anything doubtful is a 409 with nothing written. Micro.blog
 * and Pinboard are stubbed; nothing leaves this machine.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IssueDoc, Item } from '../src/shared/types.ts';

const work = mkdtempSync(join(tmpdir(), 'wt-proof-routes-'));
process.env.WT_BUILDER_DB = join(work, 'routes.db');

const { server } = await import('../src/server/index.ts');
const store = await import('../src/server/db.ts');
const config = await import('../src/server/config.ts');
const pinboard = await import('../src/server/integrations/pinboard.ts');

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
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(work, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  config.credentials.pinboardToken = undefined;
  config.config.pinboardWriteBack = false;
  config.credentials.microblogToken = undefined;
  config.config.microblogWriteBack = false;
});

async function post(path: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const res = await realFetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const IMG = '<img src="https://cdn.example/lake.jpg" alt="">';
const REVIEW_AT = '2027-07-01T12:00:00.000Z';

const local = (over: Partial<Item>): Item => ({
  type: 'currently', authorship: 'direct', source: 'direct',
  channels: { website: true, email: true, audio: true }, ...over,
} as Item);

/** A draft with a local item, a Micro.blog post and a Pinboard link, and a review of PROOF notes on them. */
async function draft(number: number, notes: unknown[], dress?: (d: IssueDoc) => void): Promise<string> {
  const saturday = new Date(Date.UTC(2027, 6, 3 + 7 * (number - 990200))).toISOString().slice(0, 10);
  const created = await post('/api/issues', { number, publication_date: saturday });
  const id = created.body.issue.issue.id as string;
  const doc = store.getIssue(id)!.doc;
  doc.items['cur-one'] = local({ body: 'I had never heard of TLA. Now I have.' });
  doc.items['post-lake'] = {
    type: 'journal_post', authorship: 'syndicated', source: 'Micro.blog',
    channels: { website: true, email: true, audio: true },
    source_id: 'mb-1', source_url: 'https://www.thingelstad.com/2027/06/30/lake.html',
    body: `By teh lake.\n\n${IMG}`,
    source_snapshot: { title: '', body: `By teh lake.\n\n${IMG}` },
    sync_state: 'synced',
  } as Item;
  doc.items['link-one'] = {
    type: 'pinboard_link', authorship: 'syndicated', source: 'Pinboard',
    channels: { website: true, email: true, audio: true },
    source_id: 'pinboard:h1', source_url: 'https://example.com/story',
    title: 'A story', commentary: 'These kind of tools matter.', tags: ['notable'], section: 'Notable',
    source_snapshot: { title: 'A story', commentary: 'These kind of tools matter.', tags: ['notable'] },
    source_flags: { toread: 'no', shared: 'yes' },
    sync_state: 'synced',
  } as Item;
  doc.nodes.find((n) => n.id === 'currently')?.items.push('cur-one');
  doc.nodes.find((n) => n.id === 'notable')?.items.push('link-one');
  doc.review = { summary: 'Mechanical errors.', at: REVIEW_AT, passes: { proof: true, judgement: false }, notes };
  dress?.(doc);
  store.saveIssue(doc);
  return id;
}

const TLA = { kind: 'PROOF', item_id: 'cur-one', text: 'TLA+ is the name.', was: 'TLA.', now: 'TLA+.' };
const events = (id: string) => store.allEvents(id).map((e) => ({ kind: e.kind, summary: e.summary, anchor: e.anchor }));

describe('POST /proof — apply', () => {
  it('replaces the words in place, answers where the fix sits, and logs an edit', async () => {
    const id = await draft(990200, [TLA]);
    const res = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0 });
    expect(res.status).toBe(200);
    expect(store.getIssue(id)!.doc.items['cur-one']!.body).toBe('I had never heard of TLA+. Now I have.');
    expect(res.body.applied).toEqual({ item_id: 'cur-one', field: 'body', offset: 21 });
    expect(res.body.issue.items['cur-one'].body).toBe('I had never heard of TLA+. Now I have.');
    // The review is left as it was: the note drops because its words are gone.
    expect((store.getIssue(id)!.doc.review as { notes: unknown[] }).notes).toHaveLength(1);
    expect(events(id)).toContainEqual({ kind: 'edit', summary: expect.stringMatching(/^Applied proof fix "TLA\." → "TLA\+\." — /), anchor: 'cur-one' });
  });

  it('is a 409 with nothing written once the words are gone', async () => {
    const id = await draft(990201, [TLA], (d) => { d.items['cur-one']!.body = 'I had never heard of TLA+ before.'; });
    const before = store.getIssue(id)!.doc;
    const res = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('"TLA." is no longer there');
    expect(res.body.code).toBe('proof_gone');
    expect(store.getIssue(id)!.doc.items).toEqual(before.items);
    expect(events(id).some((e) => e.summary.startsWith('Applied proof fix'))).toBe(false);
  });

  it('refuses words found twice with no nth, and applies the nth one when told', async () => {
    const twice = { kind: 'PROOF', item_id: 'cur-one', text: 'Doubled.', was: 'had', now: 'have' };
    const id = await draft(990202, [twice, { ...twice, nth: 2 }], (d) => { d.items['cur-one']!.body = 'I had it and I had it again.'; });
    const refused = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0 });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('proof_twice');
    const second = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 1 });
    expect(second.status).toBe(200);
    expect(store.getIssue(id)!.doc.items['cur-one']!.body).toBe('I had it and I have it again.');
  });

  it('reads the note from the stored review: a different review, or a note with no fix, is refused', async () => {
    const haiku = { kind: 'PROOF', item_id: 'cur-one', text: 'Not 5-7-5.', was: 'I had never heard' };
    const id = await draft(990203, [TLA, haiku]);
    expect((await post(`/api/issues/${id}/proof`, { review_at: '2027-01-01T00:00:00.000Z', index: 0 })).body.code).toBe('proof_stale');
    expect((await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 1 })).body.code).toBe('proof_none');
    expect((await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 9 })).body.code).toBe('proof_none');
    expect((await post(`/api/issues/${id}/proof`, { index: 0 })).status).toBe(400);
    // Words the client sends are not what is applied.
    await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0, was: 'heard', now: 'HEARD' });
    expect(store.getIssue(id)!.doc.items['cur-one']!.body).toBe('I had never heard of TLA+. Now I have.');
  });

  it('is refused while the issue is put to bed', async () => {
    const id = await draft(990204, [TLA], (d) => { d.issue.put_to_bed_at = new Date().toISOString(); });
    const res = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0 });
    expect(res.status).toBe(423);
    expect(store.getIssue(id)!.doc.items['cur-one']!.body).toBe('I had never heard of TLA. Now I have.');
  });

  it('a note on the issue fixes the title as a settings edit', async () => {
    const title = { kind: 'PROOF', item_id: null, text: 'Typo in the title.', was: 'Thnig', now: 'Thing' };
    const id = await draft(990205, [title], (d) => { d.issue.title = 'The Weekly Thnig'; });
    const res = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0 });
    expect(res.status).toBe(200);
    expect(store.getIssue(id)!.doc.issue.title).toBe('The Weekly Thing');
    expect(res.body.applied).toEqual({ item_id: null, field: 'issue.title', offset: 11 });
    expect(events(id)).toContainEqual({ kind: 'settings', summary: 'Settings — title: Applied proof fix "Thnig" → "Thing"', anchor: null });
  });
});

describe('POST /proof — undo', () => {
  it('puts the old words back at the spot the Apply answered with', async () => {
    const id = await draft(990210, [TLA]);
    const applied = (await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0 })).body.applied;
    const res = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0, undo: applied });
    expect(res.status).toBe(200);
    expect(store.getIssue(id)!.doc.items['cur-one']!.body).toBe('I had never heard of TLA. Now I have.');
    expect(events(id)).toContainEqual({ kind: 'edit', summary: expect.stringMatching(/^Undid proof fix "TLA\+\." → "TLA\." — /), anchor: 'cur-one' });
  });

  it('refuses a spot that is not one, or a fix that is no longer there', async () => {
    const id = await draft(990211, [TLA]);
    expect((await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0, undo: { item_id: 'cur-one', field: 'source_url', offset: 0 } })).status).toBe(400);
    const res = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0, undo: { item_id: 'cur-one', field: 'body', offset: 21 } });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('"TLA+." is no longer there');
    expect(store.getIssue(id)!.doc.items['cur-one']!.body).toBe('I had never heard of TLA. Now I have.');
  });
});

describe('POST /proof — write-back, as a hand edit', () => {
  it('a Micro.blog post: the prose is fixed, the image tag kept, and the post written', async () => {
    config.credentials.microblogToken = 'test-token';
    config.config.microblogWriteBack = true;
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== 'micro.blog') return realFetch(input, init);
      if (url.searchParams.get('q') === 'source') {
        return Response.json({ properties: { content: [`By teh lake.\n\n${IMG}`] } });
      }
      writes.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    });
    const id = await draft(990220, [{ kind: 'PROOF', item_id: 'post-lake', text: 'Typo.', was: 'teh', now: 'the' }]);
    const res = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0 });
    expect(res.status).toBe(200);
    expect(res.body.result.sync_state).toBe('synced');
    expect(writes).toEqual([{
      action: 'update', url: 'https://www.thingelstad.com/2027/06/30/lake.html',
      replace: { content: [`By the lake.\n\n${IMG}`] },
    }]);
    const saved = store.getIssue(id)!.doc.items['post-lake']!;
    expect(saved.body).toBe(`By the lake.\n\n${IMG}`);
    expect(saved.sync_state).toBe('synced');
  });

  it('a Pinboard link: the commentary is written with the bookmark\'s flags', async () => {
    config.credentials.pinboardToken = 'test-token';
    config.config.pinboardWriteBack = true;
    const adds: URLSearchParams[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== 'api.pinboard.in') return realFetch(input, init);
      const path = url.pathname.replace('/v1', '');
      if (path === '/posts/get') {
        return Response.json({ posts: [{
          href: 'https://example.com/story', description: 'A story', extended: 'These kind of tools matter.',
          tags: 'notable', time: '2027-06-30T14:00:00Z', toread: 'no', shared: 'yes',
        }] });
      }
      if (path === '/posts/add') { adds.push(url.searchParams); return Response.json({ result_code: 'done' }); }
      throw new Error(`unexpected Pinboard call ${path}`);
    });
    const id = await draft(990221, [{ kind: 'PROOF', item_id: 'link-one', text: 'Agreement.', was: 'These kind of', now: 'These kinds of' }]);
    const res = await post(`/api/issues/${id}/proof`, { review_at: REVIEW_AT, index: 0 });
    expect(res.status).toBe(200);
    expect(adds).toHaveLength(1);
    expect(adds[0]!.get('extended')).toBe('These kinds of tools matter.');
    expect(adds[0]!.get('shared')).toBe('yes');
    expect(store.getIssue(id)!.doc.items['link-one']!.sync_state).toBe('synced');
    expect(events(id).map((e) => e.kind)).toEqual(expect.arrayContaining(['edit', 'sync']));
  });
});
