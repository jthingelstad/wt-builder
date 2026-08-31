/**
 * The route table, exercised over HTTP.
 *
 * The send dispatch has regressed once already: a QA-fix commit reverted it to
 * a Buttondown-only guard while the client still offered every leg, and the
 * source-grep test written to pin it passed anyway — the guard contained the
 * same strings. So these tests call the routes. A destination whose leg is
 * wired answers 404 for a missing issue, because the leg's first act is to
 * load it; the severed slice answered 409 before ever looking.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The database path must be decided before the server's config module loads.
// `process.loadEnvFile` never overrides a variable that is already set, so
// this wins over .env on a dev machine.
const work = mkdtempSync(join(tmpdir(), 'wt-routes-'));
process.env.WT_BUILDER_DB = join(work, 'routes.db');

const { server } = await import('../src/server/index.ts');

let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  rmSync(work, { recursive: true, force: true });
});

async function post(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { method: 'POST', body: '{}' });
  return { status: res.status, body: await res.json() };
}

describe('every send leg the screen offers is dispatched', () => {
  for (const destination of ['podcast', 'website', 'buttondown', 'archive'] as const) {
    it(`${destination} reaches its leg`, async () => {
      const { status, body } = await post(`/api/issues/nope/send/${destination}`);
      // 404 means the leg ran far enough to look for the issue. The severed
      // slice's 409 — or a 400 — means the dispatch is gone again.
      expect(status).toBe(404);
      expect(body.error).toContain('no issue');
    });
  }

  for (const leg of ['website', 'archive'] as const) {
    it(`${leg} preview reaches its handler`, async () => {
      const res = await fetch(`${base}/api/issues/nope/send/${leg}/preview`);
      expect(res.status).toBe(404); // the handler's first act is to load the issue
    });
  }

  it('an unknown destination is a 400, not a crash', async () => {
    const { status, body } = await post('/api/issues/nope/send/gopher');
    expect(status).toBe(400);
    expect(body.error).toContain('unknown destination');
  });
});

describe('the API answers for itself', () => {
  it('an unmatched /api path is a JSON 404, not the SPA shell', async () => {
    const res = await fetch(`${base}/api/no-such-thing`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('a missing issue is a 404 the client can act on', async () => {
    const res = await fetch(`${base}/api/issues/wt999999`);
    expect(res.status).toBe(404);
  });
});

describe('an item can be removed over the wire', () => {
  it('adds a Currently entry, deletes it, and the document agrees', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990002, publication_date: '2026-09-12' }),
    });
    const { issue } = await created.json();
    const id = issue.issue.id;

    const addRes = await fetch(`${base}/api/issues/${id}/nodes/currently/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'currently' }),
    });
    expect(addRes.status).toBe(200);
    const withEntry = (await addRes.json()).issue;
    const node = withEntry.nodes.find((n: any) => n.id === 'currently');
    const newId = node.items[node.items.length - 1];

    const removed = await fetch(`${base}/api/issues/${id}/nodes/currently/items/${newId}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    const after = (await removed.json()).issue;
    expect(after.items[newId]).toBeUndefined();
    expect(after.nodes.find((n: any) => n.id === 'currently').items).not.toContain(newId);

    await fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });
  });
});

describe('the event log narrates the issue', () => {
  it('records the start, an edit, and a removal — newest first', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990003, publication_date: '2026-09-19' }),
    });
    const { issue } = await created.json();
    const id = issue.issue.id;

    await fetch(`${base}/api/issues/${id}/items/intro-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'A first line.' }),
    });

    const { events } = await (await fetch(`${base}/api/issues/${id}/events`)).json();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1].summary).toContain('Issue started — WT990003');
    expect(events[0].kind).toBe('edit');
    expect(events[0].summary).toContain('Edited body');

    // Deleting the issue takes its log with it.
    await fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });
    const gone = await fetch(`${base}/api/issues/${id}/events`);
    expect(gone.status).toBe(404);
  });
});

describe('issues round-trip through the service', () => {
  it('creates, lists, and deletes an issue', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990001, publication_date: '2026-09-05' }),
    });
    expect(created.status).toBe(200);
    const { issue } = await created.json();
    expect(issue.issue.number).toBe(990001);

    const listed = await (await fetch(`${base}/api/issues`)).json();
    expect(listed.issues.some((i: any) => i.number === 990001)).toBe(true);

    const deleted = await fetch(`${base}/api/issues/${issue.issue.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
  });
});
