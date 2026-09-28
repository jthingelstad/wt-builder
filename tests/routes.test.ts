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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The database path must be decided before the server's config module loads.
// vitest runs with WT_BUILDER_OFFLINE=1 (vite.config.ts), so .env is never
// read and no credential is present.
const work = mkdtempSync(join(tmpdir(), 'wt-routes-'));
process.env.WT_BUILDER_DB = join(work, 'routes.db');
// The knob that extends the edge's allow-list without a code change.
// "null" is here to prove it is dropped: an opaque origin is never allowed.
process.env.WT_BUILDER_ALLOWED_ORIGINS = 'https://extra.example:8443, https://another.example, null';
process.env.WT_BUILDER_ALLOWED_HOSTS = 'extra.example:8443';

const { server, logStrayErrors } = await import('../src/server/index.ts');

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

/**
 * Bytes on a socket, for what fetch will not send: a malformed Host or
 * request target. Resolves with whatever came back, or '' if the connection
 * died without an answer (which is what a crashed request looks like).
 */
function raw(request: string): Promise<string> {
  const port = Number(new URL(base).port);
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => socket.end(request));
    let out = '';
    socket.setTimeout(3000, () => socket.destroy());
    socket.on('data', (d) => (out += d.toString('utf8')));
    socket.on('close', () => resolve(out));
    socket.on('error', () => resolve(out));
  });
}

const statusOf = (response: string) => Number(/^HTTP\/1\.1 (\d{3})/.exec(response)?.[1] ?? 0);

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

describe('echoes append over the wire', () => {
  it('ticked echoes become echo items, a second run appends, one can be removed alone', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990006, publication_date: '2026-09-26' }),
    });
    const id = (await created.json()).issue.issue.id;
    const wt = (n: number) => ({ kind: 'issue', issue: n, url: `https://weekly.thingelstad.com/archive/${n}/`, note: 'why' });

    const append = (echoes: unknown) => fetch(`${base}/api/issues/${id}/nodes/echoes/echoes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ echoes }),
    });

    const first = await append([
      { text: 'The boat went in, as every May since [WT221](https://weekly.thingelstad.com/archive/221/).', ask: 'When does the boat go in?', archive_references: [wt(221)] },
      { text: 'The rails again.', ask: '', archive_references: [wt(261), { nope: true }] },
    ]);
    expect(first.status).toBe(200);
    const one = await first.json();
    expect(one.ids).toHaveLength(2);
    const a = one.issue.items[one.ids[0]];
    expect(a.type).toBe('echo');
    expect(a.ask).toBe('When does the boat go in?');
    expect(a.archive_references).toEqual([wt(221)]);
    expect(a.reviewed).toBe(true);
    expect(one.issue.items[one.ids[1]].ask).toBeUndefined();
    expect(one.issue.items[one.ids[1]].archive_references).toEqual([wt(261)]);
    // One readiness chip per echo, named for the thread.
    const chips = one.readiness.units.filter((u: any) => String(u.anchor).startsWith('echo-'));
    expect(chips.map((u: any) => u.anchor)).toEqual(one.ids);
    expect(chips[0].title.startsWith('The boat went in')).toBe(true);

    const second = await append([{ text: 'A later thought.', archive_references: [] }]);
    const two = await second.json();
    expect(two.issue.nodes.find((n: any) => n.id === 'echoes').items).toEqual([...one.ids, ...two.ids]);

    const removed = await fetch(`${base}/api/issues/${id}/nodes/echoes/items/${one.ids[0]}`, { method: 'DELETE' });
    const after = (await removed.json()).issue;
    expect(after.items[one.ids[0]]).toBeUndefined();
    expect(after.nodes.find((n: any) => n.id === 'echoes').items).toEqual([one.ids[1], ...two.ids]);

    // Nothing to append is a 400; the wrong section is a 400; a missing one a 404.
    expect((await append([{ text: '   ' }])).status).toBe(400);
    const wrong = await fetch(`${base}/api/issues/${id}/nodes/currently/echoes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ echoes: [{ text: 'x' }] }),
    });
    expect(wrong.status).toBe(400);
    const missing = await fetch(`${base}/api/issues/${id}/nodes/nope/echoes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ echoes: [{ text: 'x' }] }),
    });
    expect(missing.status).toBe(404);

    await fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });
  });
});

describe('the Echoes wands are wired', () => {
  it('the section wand reaches its handler and refuses a section that is not Echoes', async () => {
    const missing = await post('/api/issues/nope/nodes/echoes/echoes/draft');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain('no issue');

    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990007, publication_date: '2026-09-26' }),
    });
    const id = (await created.json()).issue.issue.id;
    const wrong = await post(`/api/issues/${id}/nodes/currently/echoes/draft`);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toContain('does not hold echoes');
    const gone = await post(`/api/issues/${id}/nodes/nope/echoes/draft`);
    expect(gone.status).toBe(404);
    await fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });
  });
});

describe('a link moves between Notable and Briefly over the wire', () => {
  it('moves both ways, carrying the _brief tag with it', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990005, publication_date: '2026-10-03' }),
    });
    const { issue } = await created.json();
    const id = issue.issue.id;

    // A written link — no Pinboard record, so the move is purely local.
    const addRes = await fetch(`${base}/api/issues/${id}/nodes/notable/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pinboard_link' }),
    });
    const withLink = (await addRes.json()).issue;
    const linkId = withLink.nodes.find((n: any) => n.id === 'notable').items.at(-1);

    const down = await fetch(`${base}/api/issues/${id}/items/${linkId}/section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'Briefly' }),
    });
    expect(down.status).toBe(200);
    const moved = (await down.json()).issue;
    expect(moved.nodes.find((n: any) => n.id === 'briefly').items).toContain(linkId);
    expect(moved.items[linkId].tags).toContain('_brief');

    const up = await fetch(`${base}/api/issues/${id}/items/${linkId}/section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'Notable' }),
    });
    const back = (await up.json()).issue;
    expect(back.nodes.find((n: any) => n.id === 'notable').items).toContain(linkId);
    expect(back.items[linkId].tags).not.toContain('_brief');

    const bad = await fetch(`${base}/api/issues/${id}/items/${linkId}/section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'Journal' }),
    });
    expect(bad.status).toBe(400);

    await fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });
  });
});

describe('the draft share routes are wired', () => {
  it('share and unshare both reach their handlers', async () => {
    // 404 means the handler ran far enough to look for the issue.
    const { status } = await post('/api/issues/nope/share');
    expect(status).toBe(404);
    const res = await fetch(`${base}/api/issues/nope/share`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('the send guards refuse before any leg runs', () => {
  it('website without a sent podcast is a 409, and force is the escape', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990004, publication_date: '2026-09-26' }),
    });
    const { issue } = await created.json();
    const id = issue.issue.id;

    const refused = await post(`/api/issues/${id}/send/website`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('podcast');
    expect(refused.body.error).toContain('force=1');

    await fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });
  });

  it('a leg already in flight is a 409; a stranded one is not', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990005, publication_date: '2026-10-03' }),
    });
    const { issue } = await created.json();
    const id = issue.issue.id;

    const store = await import('../src/server/db.ts');
    store.recordSend(id, 'podcast', { status: 'sending', at: new Date().toISOString() });
    const inflight = await post(`/api/issues/${id}/send/podcast`);
    expect(inflight.status).toBe(409);
    expect(inflight.body.error).toContain('in flight');

    // Ten-minutes-stale `sending` is a crash strand, not an active send: the
    // guard passes and the leg itself is reached (it will fail later on its
    // own terms in this environment; the guard's answer is what is pinned).
    store.recordSend(id, 'website', {
      status: 'sending',
      at: new Date(Date.now() - 11 * 60_000).toISOString(),
    });
    const strandRetry = await post(`/api/issues/${id}/send/website`);
    // Passes the in-flight guard, then hits the podcast-ordering 409 — which
    // proves the stale strand did not block the retry.
    expect(strandRetry.status).toBe(409);
    expect(strandRetry.body.error).toContain('podcast');

    // A leg has been attempted, so the route will not delete it (see
    // "deleting an issue"); the test drops its own throwaway row directly.
    store.deleteIssue(id);
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

describe('a request that cannot be parsed is refused, and the service keeps answering', () => {
  it('Host: a b is a 4xx, not a crash', async () => {
    // Before, the URL was built from the Host header outside the try: this
    // request killed the process (an unhandled rejection) with no answer.
    // Now it never reaches the parser, and the Host allow-list refuses it.
    const answer = await raw('GET /api/health HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n');
    expect(statusOf(answer)).toBe(421);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('a request target that is not a URL is a 400', async () => {
    const port = new URL(base).port;
    const answer = await raw(`GET http://[/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    expect(statusOf(answer)).toBe(400);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});

describe('a stray error is logged, not fatal', () => {
  it('the service logs an uncaught exception and an unhandled rejection instead of exiting', () => {
    // A stand-in for process: the real one belongs to vitest.
    const proc = new EventEmitter();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      logStrayErrors(proc as unknown as NodeJS.Process);
      expect(proc.listenerCount('uncaughtException')).toBe(1);
      expect(proc.listenerCount('unhandledRejection')).toBe(1);
      proc.emit('uncaughtException', new Error('mid-send'));
      proc.emit('unhandledRejection', new Error('nobody awaited'));
      const lines = logged.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('uncaught exception') && l.includes('mid-send'))).toBe(true);
      expect(lines.some((l) => l.includes('unhandled rejection') && l.includes('nobody awaited'))).toBe(true);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('the edge refuses what a browser sends on behalf of another site', () => {
  let id = '';
  beforeAll(async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990006, publication_date: '2026-10-10', title: 'Before' }),
    });
    id = (await created.json()).issue.issue.id;
  });
  afterAll(async () => {
    await fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });
  });

  const settings = (headers: Record<string, string>, title: string) =>
    fetch(`${base}/api/issues/${id}/settings`, {
      method: 'POST',
      // text/plain: a CORS-simple request, which a page on any site can send
      // without a preflight. The server parses it as JSON regardless.
      headers: { 'Content-Type': 'text/plain', ...headers },
      body: JSON.stringify({ title }),
    });
  const title = async () => (await (await fetch(`${base}/api/issues/${id}`)).json()).issue.issue.title;

  it('a POST from another origin is a 403, is logged by its origin, and saves nothing', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await settings({ Origin: 'https://evil.example' }, 'Pwned');
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('https://evil.example');
      expect(warned.mock.calls.map((c) => String(c[0])).join('\n')).toContain('https://evil.example');
    } finally {
      warned.mockRestore();
    }
    expect(await title()).toBe('Before');
    const { events } = await (await fetch(`${base}/api/issues/${id}/events`)).json();
    expect(events.some((e: any) => e.kind === 'settings')).toBe(false);
  });

  it('a POST the browser marks cross-site or same-site is a 403', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const res = await settings({ 'Sec-Fetch-Site': site }, 'Pwned');
      expect(res.status, site).toBe(403);
    }
    expect(await title()).toBe('Before');
  });

  it('a same-origin POST still works', async () => {
    const res = await settings({ Origin: base, 'Sec-Fetch-Site': 'same-origin' }, 'Same origin');
    expect(res.status).toBe(200);
    expect(await title()).toBe('Same origin');
  });

  it('the tailnet, the Vite dev client, and the configured extras are allowed origins', async () => {
    for (const origin of [
      'https://otto.tail09aaf9.ts.net:10001',
      'http://localhost:5317',
      'http://127.0.0.1:5317',
      `http://localhost:${new URL(base).port}`,
      'https://extra.example:8443',
      'https://another.example',
    ]) {
      const res = await settings({ Origin: origin, 'Sec-Fetch-Site': 'same-origin' }, origin);
      expect(res.status, origin).toBe(200);
    }
  });

  it('an origin the env allows is let in whatever Sec-Fetch-Site says', async () => {
    // A proxy or name the browser counts as same-site: the escape hatch must
    // be able to lift the refusal without a code change.
    const res = await settings({ Origin: 'https://extra.example:8443', 'Sec-Fetch-Site': 'same-site' }, 'Via the hatch');
    expect(res.status).toBe(200);
    expect(await title()).toBe('Via the hatch');
  });

  it('the same request from an origin not on the list is a 403, logged by origin and site', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await settings({ Origin: 'https://unlisted.example:8443', 'Sec-Fetch-Site': 'same-site' }, 'Pwned');
      expect(res.status).toBe(403);
      const line = warned.mock.calls.map((c) => String(c[0])).join('\n');
      expect(line).toContain('https://unlisted.example:8443');
      expect(line).toContain('same-site');
    } finally {
      warned.mockRestore();
    }
    expect(await title()).toBe('Via the hatch');
  });

  it('the env entry is what lets it in', async () => {
    const edge = await import('../src/server/edge.ts');
    const headers = { origin: 'https://extra.example:8443', 'sec-fetch-site': 'same-site' };
    const without = edge.crossSiteRefusal('POST', headers, edge.allowedOrigins(4317));
    expect(without).toContain('https://extra.example:8443');
    expect(without).toContain('same-site');
    expect(edge.crossSiteRefusal('POST', headers, edge.allowedOrigins(4317), ['https://extra.example:8443'])).toBeNull();
    // No Origin at all: Sec-Fetch-Site alone still refuses, and says so.
    expect(edge.crossSiteRefusal('POST', { 'sec-fetch-site': 'cross-site' }, edge.allowedOrigins(4317))).toContain('cross-site');
  });

  it('a built-in origin marked cross-site is still a 403: only the env list bypasses Sec-Fetch-Site', async () => {
    for (const origin of ['http://localhost:5317', 'http://127.0.0.1:5317', base, 'https://otto.tail09aaf9.ts.net:10001']) {
      for (const site of ['cross-site', 'same-site']) {
        const res = await settings({ Origin: origin, 'Sec-Fetch-Site': site }, 'Pwned');
        expect(res.status, `${origin} ${site}`).toBe(403);
      }
    }
    expect(await title()).not.toBe('Pwned');
    const edge = await import('../src/server/edge.ts');
    const builtIn = { origin: 'http://localhost:5317', 'sec-fetch-site': 'cross-site' };
    expect(edge.crossSiteRefusal('POST', builtIn, edge.allowedOrigins(4317), ['https://extra.example:8443'])).toContain('cross-site');
    // Absent, same-origin or none: a built-in origin passes.
    for (const site of [undefined, 'same-origin', 'none']) {
      const headers = site ? { origin: 'http://localhost:5317', 'sec-fetch-site': site } : { origin: 'http://localhost:5317' };
      expect(edge.crossSiteRefusal('POST', headers, edge.allowedOrigins(4317)), String(site)).toBeNull();
    }
  });

  it('Origin: null is refused even when the env lists it', async () => {
    // Sandboxed iframes, data: URLs and file: pages all send "null": allowing
    // it would let any of them write.
    const res = await settings({ Origin: 'null' }, 'Pwned');
    expect(res.status).toBe(403);
    expect(await title()).not.toBe('Pwned');

    const { config, parseAllowedOrigins } = await import('../src/server/config.ts');
    expect(config.allowedOrigins).toEqual(['https://extra.example:8443', 'https://another.example']);
    const warn = vi.fn();
    expect(parseAllowedOrigins('https://a.example, NULL ,null', warn)).toEqual(['https://a.example']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('null');

    const edge = await import('../src/server/edge.ts');
    expect(edge.crossSiteRefusal('POST', { origin: 'null' }, edge.allowedOrigins(4317), ['null'])).toContain('null');
  });

  it('a request with neither header passes (scripts, curl), and a read is never refused', async () => {
    expect((await settings({}, 'No headers')).status).toBe(200);
    const read = await fetch(`${base}/api/issues/${id}`, { headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } });
    expect(read.status).toBe(200);
  });
});

describe('the edge answers only to its own names (DNS rebinding)', () => {
  const port = () => new URL(base).port;
  const get = (host: string, path = '/api/health') =>
    raw(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);

  it('a foreign Host is a 421 that names it, logged, for a read as much as a write', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const read = await get(`rebound.example:${port()}`);
      expect(statusOf(read)).toBe(421);
      expect(read).toContain(`rebound.example:${port()}`);
      expect(warned.mock.calls.map((c) => String(c[0])).join('\n')).toContain(`rebound.example:${port()}`);
    } finally {
      warned.mockRestore();
    }
  });

  it('a rebound DELETE is refused before it reaches the route', async () => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 990007, publication_date: '2026-10-17' }),
    });
    const id = (await created.json()).issue.issue.id;
    const answer = await raw(`DELETE /api/issues/${id} HTTP/1.1\r\nHost: rebound.example:${port()}\r\nConnection: close\r\n\r\n`);
    expect(statusOf(answer)).toBe(421);
    expect((await fetch(`${base}/api/issues/${id}`)).status).toBe(200);
    await fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });
  });

  it('loopback on the listening port, the tailnet name, and the configured extras answer', async () => {
    for (const host of [
      `127.0.0.1:${port()}`,
      `localhost:${port()}`,
      `LOCALHOST:${port()}`,
      'otto.tail09aaf9.ts.net',
      'otto.tail09aaf9.ts.net:10001',
      'extra.example:8443',
    ]) {
      expect(statusOf(await get(host)), host).toBe(200);
    }
  });

  it('loopback on another port, and no Host at all, are refused', async () => {
    const other = Number(port()) === 4317 ? 4318 : 4317;
    expect(statusOf(await get(`127.0.0.1:${other}`))).toBe(421);
    const bare = await raw('GET /api/health HTTP/1.0\r\n\r\n');
    expect(statusOf(bare.replace(/^HTTP\/1\.0/, 'HTTP/1.1'))).toBe(421);
  });
});

describe('deleting an issue', () => {
  const create = async (number: number, publication_date: string) => {
    const created = await fetch(`${base}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, publication_date }),
    });
    return (await created.json()).issue.issue.id as string;
  };
  const del = (id: string) => fetch(`${base}/api/issues/${id}`, { method: 'DELETE' });

  it('a published issue is refused, and is still there', async () => {
    const id = await create(990008, '2026-10-24');
    const store = await import('../src/server/db.ts');
    store.recordSend(id, 'website', { status: 'sent', at: new Date().toISOString() });
    store.recordSend(id, 'buttondown', { status: 'sent', at: new Date().toISOString() });
    expect(store.getIssue(id)!.doc.issue.status).toBe('published');

    const res = await del(id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('published');
    expect((await fetch(`${base}/api/issues/${id}`)).status).toBe(200);
    store.deleteIssue(id);
  });

  it('a draft with any leg sent, in flight, or failed is refused', async () => {
    const store = await import('../src/server/db.ts');
    const cases = [
      ['sent', 990009, '2026-10-31'],
      ['sending', 990010, '2026-11-07'],
      ['failed', 990011, '2026-11-21'],
    ] as const;
    for (const [status, number, date] of cases) {
      const id = await create(number, date);
      store.recordSend(id, 'podcast', { status, at: new Date().toISOString() });
      expect(store.getIssue(id)!.doc.issue.status).toBe('draft');
      const res = await del(id);
      expect(res.status, status).toBe(409);
      expect((await fetch(`${base}/api/issues/${id}`)).status, status).toBe(200);
      store.deleteIssue(id);
    }
  });

  it('a draft with a live share page is refused until it is unshared', async () => {
    const id = await create(990013, '2026-11-28');
    const store = await import('../src/server/db.ts');
    const doc = store.getIssue(id)!.doc;
    doc.draft_share = { token: 't0k3n', url: 'https://files.example/weekly-thing/drafts/wt990013-t0k3n.html', at: new Date().toISOString() };
    store.saveIssue(doc);

    const res = await del(id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('unshare');
    expect((await fetch(`${base}/api/issues/${id}`)).status).toBe(200);

    // Unshared (as DELETE /share leaves it), the same draft goes.
    const unshared = store.getIssue(id)!.doc;
    delete unshared.draft_share;
    store.saveIssue(unshared);
    expect((await del(id)).status).toBe(200);
  });

  it('an unsent draft is deleted, and its last version is kept among its revisions', async () => {
    const id = await create(990012, '2026-11-14');
    await fetch(`${base}/api/issues/${id}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'The last thing it said' }),
    });

    expect((await del(id)).status).toBe(200);
    expect((await fetch(`${base}/api/issues/${id}`)).status).toBe(404);

    const store = await import('../src/server/db.ts');
    const [last] = store.listRevisions(id);
    expect(last?.doc.issue.title).toBe('The last thing it said');
  });
});
