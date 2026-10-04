/**
 * The MCP interface (src/server/mcp.ts, docs/mcp-plan.md Part B), over real
 * HTTP with the SDK's own client against a server on port 0. Pins that it is
 * read-only: every tool says so, no tool reaches a route that is not a GET,
 * and a browser page on another site cannot reach it at all. No model, no
 * network.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { IssueDoc } from '../src/shared/types.ts';

const work = mkdtempSync(join(tmpdir(), 'wt-mcp-'));
process.env.WT_BUILDER_DB = join(work, 'mcp.db');

const { server, readRoute } = await import('../src/server/index.ts');
const store = await import('../src/server/db.ts');
const { buildServer } = await import('../src/server/mcp.ts');

let base = '';
let client: Client;

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

/** A draft numbered `n`, saved: the fixture renumbered. */
function draft(n: number, edit?: (doc: IssueDoc) => void): IssueDoc {
  const doc = fixture();
  doc.issue.id = `wt${n}`;
  doc.issue.number = n;
  doc.issue.title = '';
  doc.issue.status = 'draft';
  edit?.(doc);
  store.saveIssue(doc);
  return doc;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
  draft(390);
  draft(391, (doc) => { doc.items['outro-1']!.body = ''; });
  client = new Client({ name: 'wt-builder-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
});

afterAll(async () => {
  await client.close();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(work, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const out = await client.callTool({ name, arguments: args });
  return out as { structuredContent?: any; content: { type: string; text: string }[]; isError?: boolean };
};

describe('the MCP interface', () => {
  it('says it is read-only, and every tool is annotated read-only', async () => {
    expect(client.getInstructions()).toMatch(/READ-ONLY/);
    expect(client.getServerVersion()?.name).toBe('wt-builder');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_issue', 'get_item', 'get_review', 'get_status', 'get_timing', 'list_events', 'list_issues', 'render_issue',
    ]);
    for (const t of tools) expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it('get_status: the newest draft by default, with every pill and what the waiting ones wait on', async () => {
    const out = await call('get_status');
    expect(out.isError).toBeFalsy();
    const s = out.structuredContent;
    expect(s.issue).toMatchObject({ id: 'wt391', number: 391, status: 'draft' });
    const outro = s.pills.find((p: any) => p.anchor === 'outro-1');
    expect(outro).toMatchObject({ state: 'waiting', section: 'outro', waiting: 'Waiting on Intro (0 of 1)' });
    expect(outro.waiting_on).toEqual([{ section: 'intro', name: 'Intro', done: 0, total: 1 }]);
    // The counts are the strip's, and nothing is lost between them.
    const { done, partial, waiting, todo, total } = s.counts;
    expect(done + partial + waiting + todo).toBe(total);
    expect(s.summary).toContain(`${waiting} waiting`);
    expect(s.workable_now).not.toContain('Outro');
    expect(Object.keys(s.sends).sort()).toEqual(['archive', 'buttondown', 'podcast', 'website']);
    // The page's own readiness, pill for pill.
    const page = await (await fetch(`${base}/api/issues/wt391`)).json() as { readiness: { units: { anchor: string; state: string }[] } };
    expect(s.pills.map((p: any) => [p.anchor, p.state])).toEqual(page.readiness.units.map((u) => [u.anchor, u.state]));
  });

  it('names an issue as wt390, 390, or its id; an unknown one is refused, not guessed', async () => {
    for (const issue of ['wt390', '390', 'WT390']) {
      expect((await call('get_status', { issue })).structuredContent.issue.number).toBe(390);
    }
    const out = await call('get_status', { issue: 'wt999' });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain('No issue "wt999"');
  });

  it('list_issues: drafts newest first, and says when the list is cut', async () => {
    const all = (await call('list_issues')).structuredContent;
    expect(all.issues.map((i: any) => i.number)).toEqual([391, 390]);
    expect(all.note).toBeUndefined();
    const cut = (await call('list_issues', { limit: 1 })).structuredContent;
    expect(cut).toMatchObject({ shown: 1, matching: 2 });
    expect(cut.note).toContain('newest 1 of 2');
  });

  it('get_issue: sections in reading order, every item in full', async () => {
    const s = (await call('get_issue', { issue: 'wt390' })).structuredContent;
    const doc = fixture();
    expect(s.sections.map((n: any) => n.id)).toEqual(doc.nodes.map((n) => n.id));
    const notable = s.sections.find((n: any) => n.type === 'notable');
    const flipcash = notable.items.find((i: any) => i.id === 'link-flipcash');
    expect(flipcash).toMatchObject({ title: doc.items['link-flipcash']!.title, in_issue: true });
    expect(flipcash.source_snapshot).toBeUndefined();
  });

  it('get_item: one item, its section, and its pills; an unknown id is refused', async () => {
    const s = (await call('get_item', { issue: 'wt391', item_id: 'outro-1' })).structuredContent;
    expect(s.section).toBe(fixture().nodes.find((n) => n.items.includes('outro-1'))!.label);
    expect(s.pills.map((p: any) => p.state)).toEqual(['waiting']);
    const out = await call('get_item', { item_id: 'nope' });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain('No item "nope"');
  });

  it('render_issue: the edition the page renders', async () => {
    const s = (await call('render_issue', { issue: 'wt390', lens: 'email' })).structuredContent;
    const page = await (await fetch(`${base}/api/issues/wt390/render/email`)).json() as { rendered: string };
    expect(s.rendered).toBe(page.rendered);
  });

  it('get_review, list_events, get_timing answer from what is stored', async () => {
    expect((await call('get_review', { issue: 'wt390' })).structuredContent.reviewed).toBe(false);
    store.logEvent('wt390', 'edit', 'A test edit');
    const events = (await call('list_events', { issue: 'wt390' })).structuredContent;
    expect(events.events[0].summary).toBe('A test edit');
    const later = (await call('list_events', { issue: 'wt390', since: events.events[0].id })).structuredContent;
    expect(later.events).toEqual([]);
    const timing = await call('get_timing', { issue: 'wt390' });
    expect(timing.isError).toBeFalsy();
    expect(timing.structuredContent).toHaveProperty('timing');
  });

  it('changes nothing: the issue reads the same after every tool has run', async () => {
    const before = store.getIssue('wt391')!.doc;
    for (const name of ['get_status', 'get_issue', 'get_review', 'list_events', 'get_timing']) await call(name, { issue: 'wt391' });
    await call('render_issue', { issue: 'wt391', lens: 'audio' });
    expect(store.getIssue('wt391')!.doc).toEqual(before);
  });
});

describe('what the MCP interface cannot reach', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('readRoute runs GET routes only', async () => {
    await expect(readRoute('/api/issues/wt390/put-to-bed')).rejects.toThrow(/no GET route/);
    await expect(readRoute('/api/issues/wt390/items/haiku-1/draft')).rejects.toThrow(/no GET route/);
    await expect(readRoute('/api/issues/wt390')).resolves.toHaveProperty('issue');
  });

  it('no tool reads anything but a GET route', async () => {
    // Every path each tool asks for, checked against the route table.
    const asked: string[] = [];
    const s = buildServer({ read: async (p) => { asked.push(p); return readRoute(p); }, scriptHash: () => '' });
    const { Client: C } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new C({ name: 't', version: '0' });
    await Promise.all([s.connect(b), c.connect(a)]);
    for (const { name } of (await c.listTools()).tools) {
      const args: Record<string, unknown> = { issue: 'wt390' };
      if (name === 'get_item') args.item_id = 'haiku-1';
      if (name === 'render_issue') args.lens = 'website';
      const out = await c.callTool({ name, arguments: args });
      expect(out.isError, name).toBeFalsy();
    }
    await c.close();
    expect(asked.length).toBeGreaterThan(0);
    for (const p of asked) expect(p).toMatch(/^\/api\/issues(\/[^/]+(\/(events|timing|render\/[a-z]+))?)?$/);
  });

  it('a browser page on another site is refused at the edge', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'https://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(403);
  });

  it('a request addressed to another name is refused at the edge', async () => {
    // fetch will not send a Host of our choosing; a socket will.
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const answer = await new Promise<string>((resolve) => {
      const socket = connect(Number(new URL(base).port), '127.0.0.1', () => socket.end(
        `POST /mcp HTTP/1.1\r\nHost: rebound.example\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
      ));
      let out = '';
      socket.on('data', (d) => (out += d.toString('utf8')));
      socket.on('close', () => resolve(out));
      socket.on('error', () => resolve(out));
    });
    expect(warned).toHaveBeenCalled();
    expect(answer).toMatch(/^HTTP\/1\.1 421/);
  });
});
