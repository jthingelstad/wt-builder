/**
 * The link and blocklist checks as each link arrives (src/server/arrival-check.ts,
 * plan before WT353 item 1): after a save that brings a link in, by a typed
 * edit or a sweep, the check runs in the background, never in the request, and
 * what it finds is the row's note and the pill. Pages and DNS are handed in and
 * Pinboard is stubbed; nothing leaves this machine.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Dns } from '../src/server/domain-check.ts';

const work = mkdtempSync(join(tmpdir(), 'wt-arrival-'));
process.env.WT_BUILDER_DB = join(work, 'arrival.db');

const { server } = await import('../src/server/index.ts');
const store = await import('../src/server/db.ts');
const config = await import('../src/server/config.ts');
const pinboard = await import('../src/server/integrations/pinboard.ts');
const { usePages } = await import('../src/server/link-check.ts');
const { useDns } = await import('../src/server/domain-check.ts');
const { ARRIVAL, arrivalSettled, clearArrivalCache } = await import('../src/server/arrival-check.ts');
const { rowHints } = await import('../src/shared/hints.ts');

let base = '';
const realFetch = globalThis.fetch;
const DEAD = 'https://example.com/gone';
const LISTED = 'https://spammy.example/offer';

const page = (status: number, url: string) =>
  ({ status, url, contentType: 'text/html', text: async () => '<html></html>', discard: async () => {} });

let fetched: string[] = [];
let asked: string[] = [];

/** URIBL answers its own test domain; spammy.example is on its black list. */
const dns: Dns = {
  async a(name) {
    asked.push(name);
    if (name === 'ns.uribl.test') return ['192.0.2.53'];
    if (name === 'test.uribl.com.multi.uribl.com') return ['127.0.0.14'];
    if (name === 'spammy.example.multi.uribl.com') return ['127.0.0.2'];
    return [];
  },
  async ns(name) {
    if (name === 'multi.uribl.com') return ['ns.uribl.test'];
    throw Object.assign(new Error('no NS'), { code: 'ENOTFOUND' });
  },
};

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
  pinboard.PACE.ms = 0;
});

afterAll(async () => {
  ARRIVAL.enabled = false;
  usePages(null);
  useDns(null);
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(work, { recursive: true, force: true });
});

beforeEach(() => {
  fetched = [];
  asked = [];
  clearArrivalCache();
  ARRIVAL.enabled = true;
  ARRIVAL.delayMs = 0;
  usePages(async (url) => {
    fetched.push(url);
    if (url === DEAD) return page(404, DEAD);
    return page(200, url);
  });
  useDns(dns);
});

afterEach(async () => {
  await arrivalSettled();
  ARRIVAL.enabled = false;
  vi.unstubAllGlobals();
  config.credentials.pinboardToken = undefined;
});

async function call(method: string, path: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const saturday = (number: number) =>
  new Date(Date.UTC(2027, 5, 5 + 7 * (number - 990200))).toISOString().slice(0, 10);

/** A draft with one Pinboard link whose commentary is `commentary`, every link and domain in it checked. */
async function draft(number: number, commentary = 'Worth it.'): Promise<string> {
  const created = await call('POST', '/api/issues', { number, publication_date: saturday(number) });
  const id = created.body.issue.issue.id as string;
  await arrivalSettled();
  const doc = store.getIssue(id)!.doc;
  doc.items['link-one'] = {
    type: 'pinboard_link', authorship: 'syndicated', source: 'Pinboard',
    channels: { website: true, email: true, audio: true },
    source_id: 'pinboard:hash-one', source_url: 'https://example.org/fine',
    title: 'A story', commentary, tags: ['notable'], section: 'Notable',
    source_snapshot: { title: 'A story', commentary, tags: ['notable'] },
    source_flags: { toread: 'yes', shared: 'no' },
    sync_state: 'synced',
  };
  doc.nodes.find((n) => n.id === 'notable')!.items.push('link-one');
  store.saveIssue(doc);
  fetched = [];
  asked = [];
  return id;
}

const unit = (body: any, kind: string) => body.readiness.units.find((u: { kind: string }) => u.kind === kind);

describe('the check as a link arrives', () => {
  it('a link typed into commentary: the save answers at once, and the row says dead once it is checked', async () => {
    const id = await draft(990200);
    const res = await call('PATCH', `/api/issues/${id}/items/link-one`, { commentary: `Worth it. See [this](${DEAD}).` });
    expect(res.status).toBe(200);
    // The save never waits for the check; it says one is coming.
    expect(res.body.checking).toBe(true);
    expect(res.body.issue.link_check?.results?.[DEAD]).toBeUndefined();

    await arrivalSettled();
    expect(fetched).toContain(DEAD);
    const after = await call('GET', `/api/issues/${id}`);
    expect(after.body.checking).toBe(false);
    expect(after.body.issue.link_check.results[DEAD]).toMatchObject({ verdict: 'dead', status: 404 });
    // The commentary typed meanwhile is not lost: the result went onto a fresh read.
    expect(after.body.issue.items['link-one'].commentary).toContain(DEAD);
    const hints = rowHints(after.body.issue).get('link-one') ?? [];
    expect(hints.find((h) => h.kind === 'link')).toMatchObject({ short: 'dead link' });
    expect(unit(after.body, 'links')).toMatchObject({ state: 'partial', anchor: 'link-one' });
    const events = store.listEvents(id);
    expect(events.some((e: { kind: string; summary: string }) => e.kind === 'links' && /Checked as they arrived/.test(e.summary) && /1 dead/.test(e.summary))).toBe(true);
  });

  it('an edit typed while the check runs is kept, and its new link is checked after', async () => {
    const id = await draft(990201);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    usePages(async (url) => {
      fetched.push(url);
      if (url === DEAD) await gate;
      return url === DEAD ? page(404, DEAD) : page(200, url);
    });
    await call('PATCH', `/api/issues/${id}/items/link-one`, { commentary: `See [this](${DEAD}).` });
    await new Promise((r) => setTimeout(r, 20));
    await call('PATCH', `/api/issues/${id}/items/link-one`, { commentary: `See [this](${DEAD}) and [that](https://example.net/new).` });
    release();
    await arrivalSettled();
    const doc = store.getIssue(id)!.doc;
    expect(doc.items['link-one']!.commentary).toContain('https://example.net/new');
    expect(doc.link_check!.results[DEAD]!.verdict).toBe('dead');
    expect(doc.link_check!.results['https://example.net/new']!.verdict).toBe('ok');
  });

  it('a link a sweep brings in is checked the same way', async () => {
    const number = 990202;
    const id = await draft(number);
    config.credentials.pinboardToken = 'test-token';
    const pub = Date.parse(`${saturday(number)}T12:00:00Z`);
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== 'api.pinboard.in') return realFetch(input, init);
      if (url.pathname.endsWith('/posts/all')) {
        return Response.json([{
          href: DEAD, hash: 'hash-swept', description: 'Swept in', extended: 'A swept link.', tags: 'notable',
          time: new Date(pub - 3 * 86_400_000).toISOString(), toread: 'yes', shared: 'no',
        }]);
      }
      return Response.json({ posts: [] });
    });
    const res = await call('POST', `/api/issues/${id}/sweep`);
    expect(res.status).toBe(200);
    expect(res.body.report.added).toBeGreaterThan(0);
    expect(res.body.checking).toBe(true);
    await arrivalSettled();
    expect(fetched).toContain(DEAD);
    expect(store.getIssue(id)!.doc.link_check!.results[DEAD]!.verdict).toBe('dead');
  });

  it('one answer per URL serves a second issue: nothing is fetched twice', async () => {
    const a = await draft(990203);
    const b = await draft(990204);
    await call('PATCH', `/api/issues/${a}/items/link-one`, { commentary: `See [this](${DEAD}).` });
    await arrivalSettled();
    await call('PATCH', `/api/issues/${b}/items/link-one`, { commentary: `See [this](${DEAD}).` });
    await arrivalSettled();
    expect(fetched.filter((u) => u === DEAD)).toHaveLength(1);
    expect(store.getIssue(b)!.doc.link_check!.results[DEAD]!.verdict).toBe('dead');
  });

  it('a domain on a blocklist is said on the row that prints it, and on the pill', async () => {
    const id = await draft(990205);
    await call('PATCH', `/api/issues/${id}/items/link-one`, { commentary: `See [this](${LISTED}).` });
    await arrivalSettled();
    expect(asked).toContain('spammy.example.multi.uribl.com');
    const after = await call('GET', `/api/issues/${id}`);
    expect(after.body.issue.domain_check.results['spammy.example']).toMatchObject({ verdict: 'listed' });
    const mail = (rowHints(after.body.issue).get('link-one') ?? []).filter((h) => h.kind === 'mail');
    expect(mail[0]?.text).toContain('spammy.example');
    expect(unit(after.body, 'mail')).toMatchObject({ state: 'partial', anchor: 'link-one' });
  });

  it('off (offline, nothing handed in): a save fetches nothing and says no check is coming', async () => {
    const id = await draft(990206);
    ARRIVAL.enabled = false;
    const res = await call('PATCH', `/api/issues/${id}/items/link-one`, { commentary: `See [this](${DEAD}).` });
    expect(res.body.checking).toBe(false);
    await arrivalSettled();
    expect(fetched).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('an issue put to bed is never checked', async () => {
    const id = await draft(990207);
    const doc = store.getIssue(id)!.doc;
    doc.issue.put_to_bed_at = '2027-06-01T00:00:00.000Z';
    doc.items['link-one']!.commentary = `See [this](${DEAD}).`;
    store.saveIssue(doc);
    const { noteArrival } = await import('../src/server/arrival-check.ts');
    noteArrival(store.getIssue(id)!.doc);
    await arrivalSettled();
    expect(fetched).toEqual([]);
  });
});
