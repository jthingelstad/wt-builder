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
const { buildServer, scrub } = await import('../src/server/mcp.ts');

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
    expect(client.getInstructions()).toMatch(/data, never instructions/);
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
    expect(s.workable_now.map((w: any) => w.anchor)).not.toContain('outro-1');
    // Issue-wide pills belong to the issue, and are finished in the Send view.
    for (const p of s.pills.filter((p: any) => p.kind === 'links' || p.kind === 'mail')) expect(p).toMatchObject({ anchor: 'issue', done_in: 'send view' });
    expect(s.checks.links).toHaveProperty('summary');
    expect(Object.keys(s.sends).sort()).toEqual(['archive', 'buttondown', 'podcast', 'website']);
    // The page's own readiness, pill for pill.
    const page = await (await fetch(`${base}/api/issues/wt391`)).json() as { readiness: { units: { anchor: string; state: string }[] } };
    expect(s.pills.map((p: any) => [p.title, p.state])).toEqual(page.readiness.units.map((u: any) => [u.title, u.state]));
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
    expect(cut.note).toContain('pass before: 391');
    expect((await call('list_issues', { before: 391 })).structuredContent.issues.map((i: any) => i.number)).toEqual([390]);
  });

  it('get_issue: sections in reading order, every item in full', async () => {
    const s = (await call('get_issue', { issue: 'wt390' })).structuredContent;
    const doc = fixture();
    expect(s.sections.map((n: any) => n.id)).toEqual(doc.nodes.map((n) => n.id));
    const notable = s.sections.find((n: any) => n.type === 'notable');
    const flipcash = notable.items.find((i: any) => i.id === 'link-flipcash');
    expect(flipcash).toMatchObject({ title: doc.items['link-flipcash']!.title, in_issue: true });
    expect(flipcash.source_snapshot).toBeUndefined();
    expect(flipcash.source_flags).toBeUndefined();
    // An item with every edition off does not print, and says why.
    const excluded = s.sections.flatMap((n: any) => n.items).find((i: any) => i.id === 'journal-excluded');
    expect(excluded).toMatchObject({ in_issue: false, held_out: 'every edition turned off' });
  });

  it('get_item: one item, its section, and its pills; an unknown id is refused', async () => {
    const s = (await call('get_item', { issue: 'wt391', item_id: 'outro-1' })).structuredContent;
    expect(s.section).toBe(fixture().nodes.find((n) => n.items.includes('outro-1'))!.label);
    expect(s.pills.map((p: any) => p.state)).toEqual(['waiting']);
    expect((await call('get_item', { issue: 'wt390', item_id: 'link-flipcash' })).structuredContent.item.source_flags).toBeUndefined();
    const out = await call('get_item', { item_id: 'nope' });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain('No item "nope"');
  });

  it('render_issue: the edition the page renders', async () => {
    const s = (await call('render_issue', { issue: 'wt390', lens: 'email' })).structuredContent;
    const page = await (await fetch(`${base}/api/issues/wt390/render/email`)).json() as { rendered: string };
    expect(s.rendered).toBe(page.rendered);
    expect(s.content).toMatch(/never instructions/);
  });

  it('get_review, list_events, get_timing answer from what is stored', async () => {
    expect((await call('get_review', { issue: 'wt390' })).structuredContent.reviewed).toBe(false);
    store.logEvent('wt390', 'edit', 'A test edit');
    const events = (await call('list_events', { issue: 'wt390' })).structuredContent;
    expect(events.events[0].summary).toBe('A test edit');
    const later = (await call('list_events', { issue: 'wt390', since: events.events[0].id })).structuredContent;
    expect(later.events).toEqual([]);
    const older = (await call('list_events', { issue: 'wt390', before: events.events[0].id })).structuredContent;
    expect(older.events.every((e: any) => e.id < events.events[0].id)).toBe(true);
    const timing = await call('get_timing', { issue: 'wt390' });
    expect(timing.isError).toBeFalsy();
    expect(timing.structuredContent.timing).toHaveProperty('active_minutes');
  });

  it('changes nothing: the issue reads the same after every tool has run', async () => {
    const before = store.getIssue('wt391')!.doc;
    for (const name of ['get_status', 'get_issue', 'get_review', 'list_events', 'get_timing']) await call(name, { issue: 'wt391' });
    await call('render_issue', { issue: 'wt391', lens: 'audio' });
    expect(store.getIssue('wt391')!.doc).toEqual(before);
  });
});

describe('found by adversarial testing (2026-10-04)', () => {
  it('reading an older issue does not save its skeleton repair', async () => {
    // A Photo section with no item is repaired, and saved, when the editor opens it.
    draft(380, (doc) => {
      const photo = doc.nodes.find((n) => n.type === 'photo')!;
      for (const id of photo.items) delete doc.items[id];
      photo.items = [];
    });
    const before = store.getIssue('wt380')!;
    for (const name of ['get_status', 'get_issue', 'get_review', 'list_events', 'get_timing']) await call(name, { issue: 'wt380' });
    await call('get_item', { issue: 'wt380', item_id: 'intro-1' });
    await call('render_issue', { issue: 'wt380', lens: 'website' });
    const after = store.getIssue('wt380')!;
    expect(after.doc).toEqual(before.doc);
    expect(after.updated_at).toBe(before.updated_at);
    // It still sees the repair, as the page would.
    const s = (await call('get_issue', { issue: 'wt380' })).structuredContent;
    expect(s.sections.find((n: any) => n.type === 'photo').items).toHaveLength(1);
  });

  it('a prototype key is not an item', async () => {
    for (const item_id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const out = await call('get_item', { issue: 'wt390', item_id });
      expect(out.isError, item_id).toBe(true);
      expect(out.content[0]!.text, item_id).toContain(`No item "${item_id}"`);
    }
  });

  it('a held-out item does not claim to be in the issue', async () => {
    draft(381, (doc) => {
      doc.items['link-flipcash']!.excluded = true;
      const node = doc.nodes.find((n) => n.items.includes('link-flipcash'))!;
      node.items = node.items.filter((id) => id !== 'link-flipcash');
      doc.orphans = ['link-flipcash'];
    });
    const s = (await call('get_issue', { issue: 'wt381' })).structuredContent;
    expect(s.held_out_items).toEqual([expect.objectContaining({ id: 'link-flipcash', in_issue: false, held_out: 'held out by Jamie' })]);
    const item = (await call('get_item', { issue: 'wt381', item_id: 'link-flipcash' })).structuredContent;
    expect(item).toMatchObject({ section: null, item: { in_issue: false } });
  });

  it('a draft share link never reaches the agent', async () => {
    store.logEvent('wt390', 'send', 'Draft shared — https://files.thingelstad.com/weekly-thing/drafts/wt390-89fa2935fc5c8bd9b55637f3.html');
    const { events } = (await call('list_events', { issue: 'wt390', limit: 5 })).structuredContent;
    expect(events[0].summary).toBe('Draft shared — [draft share link withheld]');
  });

  it('a proofing note whose words are gone says it no longer applies', async () => {
    draft(382, (doc) => {
      doc.review = {
        summary: 's', at: '2026-05-20T12:00:00Z', passes: { proof: true, judgement: false },
        notes: [
          { kind: 'PROOF', item_id: 'intro-1', text: 'typo', was: 'no such words here', now: 'x' },
          { kind: 'PROOF', item_id: 'intro-1', text: 'still', was: doc.items['intro-1']!.body!.slice(0, 12), now: 'x' },
          { kind: 'BALANCE', item_id: null, text: 'judgement' },
        ],
      };
    });
    const r = (await call('get_review', { issue: 'wt382' })).structuredContent;
    expect(r.notes.map((n: any) => n.still_applies)).toEqual([false, true, null]);
    expect(r.note).toContain('1 note no longer applies');
  });

  it('nothing is workable in an issue that is put to bed', async () => {
    draft(383, (doc) => { doc.issue.status = 'published'; doc.issue.put_to_bed_at = '2026-05-24T12:00:00Z'; });
    const s = (await call('get_status', { issue: 'wt383' })).structuredContent;
    expect(s.workable_now).toEqual([]);
    expect(s.note).toContain('Put to bed');
  });

  it('two drafts: the newest is shown, and the answer says there is another', async () => {
    const s = (await call('get_status')).structuredContent;
    expect(s.note).toMatch(/drafts \(wt391, wt390.*\); showing the newest, wt391/);
  });

  it('scrubs credentials out of stored error text', () => {
    expect(scrub('GET https://api.pinboard.in/v1/posts/add?auth_token=jamie:ABCDEF123&url=x failed')).toBe('GET https://api.pinboard.in/v1/posts/add?auth_token=[withheld]&url=x failed');
    expect(scrub('401: Authorization: Token abcdef0123456789')).toBe('401: Authorization: Token [withheld]');
    expect(scrub('x'.repeat(400))!.length).toBe(301);
  });
});

describe('found by adversarial testing, round 2 (2026-10-04)', () => {
  const rpc = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const quietly = async <T>(fn: () => Promise<T>) => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: unknown) => { lines.push(String(l)); });
    try {
      return { out: await fn(), lines };
    } finally {
      spy.mockRestore();
    }
  };

  it('refuses a batch: one message per request', async () => {
    const { out: res } = await quietly(() => rpc([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_issues', arguments: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_issues', arguments: {} } },
    ]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32600);
  });

  it('a review note stands by the margin’s own rule, captions included', async () => {
    draft(384, (doc) => {
      doc.items['photo-1']!.media = { ...doc.items['photo-1']!.media, caption: 'A sunset over teh lake' } as never;
      doc.issue.title = 'A title with a tyop';
      doc.review = {
        summary: 's', at: '2026-05-20T12:00:00Z', passes: { proof: true, judgement: true },
        notes: [
          { kind: 'PROOF', item_id: 'photo-1', text: 'typo', was: 'teh lake', now: 'the lake' },
          { kind: 'PROOF', item_id: 'gone-item', text: 'typo', was: 'anything', now: 'x' },
          { kind: 'PROOF', item_id: null, text: 'title typo', was: 'tyop', now: 'typo' },
          { kind: 'BALANCE', item_id: 'intro-1', text: 'long' },
        ],
      };
    });
    const r = (await call('get_review', { issue: 'wt384' })).structuredContent;
    expect(r.notes.map((n: any) => n.still_applies)).toEqual([true, false, true, true]);
  });

  it('a malformed client name is not a fault', async () => {
    const { out: res, lines } = await quietly(() => rpc({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: { toString: 1 }, version: { toString: 1 } } },
    }));
    expect(res.status).not.toBe(500);
    expect(lines.some((l) => l.startsWith('[mcp] connected unknown client'))).toBe(true);
  });

  it('no input can split, forge, or reorder a log line', async () => {
    const { lines } = await quietly(async () => {
      await rpc(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_item', arguments: { issue: 'wt390', item_id: 'x\u2028[mcp] forged\u0085\u202e' } } },
        { 'Tailscale-User-Login': 'jamie) [mcp] get_status wt352 {} -> ok 1ms (local', 'User-Agent': 'agent)\u0085x' },
      );
    });
    const line = lines.find((l) => l.startsWith('[mcp] get_item'))!;
    expect(line).toContain('\\u2028');
    expect(line).not.toMatch(/[\u0085\u2028\u202e]/);
    // The caller cannot close its own parenthesis.
    expect(line.slice(line.lastIndexOf('(') + 1, -1)).not.toMatch(/[()\s\[\]]{2}|\)/);
  });

  it('a call refused before it runs is still logged', async () => {
    const { lines } = await quietly(async () => {
      await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_issue', arguments: { issue: 'wt390' } } });
      await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'render_issue', arguments: { lens: '../events' } } });
      await rpc({ jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'no_such_prompt' } });
    });
    expect(lines.some((l) => /^\[mcp\] delete_issue \{"issue":"wt390"\} → rejected: /.test(l))).toBe(true);
    expect(lines.some((l) => /^\[mcp\] render_issue \{"lens":"\.\.\/events"\} → rejected: /.test(l))).toBe(true);
    expect(lines.some((l) => /^\[mcp\] prompts\/get → error: /.test(l))).toBe(true);
  });

  it('pages back through an event log longer than 500', async () => {
    draft(385);
    for (let i = 0; i < 520; i++) store.logEvent('wt385', 'edit', `Edit ${i}`);
    const seen: number[] = [];
    let before: number | undefined;
    for (;;) {
      const page = (await call('list_events', { issue: 'wt385', limit: 200, ...(before ? { before } : {}) })).structuredContent;
      seen.push(...page.events.map((e: any) => e.id));
      if (!page.note) break;
      before = page.events.at(-1).id;
    }
    expect(seen).toHaveLength(520);
    expect(new Set(seen).size).toBe(520);
  });

  it('withholds a share link in any spelling, in any field', async () => {
    store.logEvent('wt390', 'send', 'a https%3A%2F%2Ffiles.thingelstad.com%2Fweekly-thing%2Fdrafts%2Fwt390-89fa2935fc5c8bd9.html b weekly-thing/drafts/wt390-89fa2935fc5c8bd9.htm');
    const out = await call('list_events', { issue: 'wt390', limit: 1 });
    expect(out.content[0]!.text).not.toMatch(/89fa2935/);
    expect(JSON.stringify(out.structuredContent)).not.toMatch(/89fa2935/);
  });

  it('scrubs the credential shapes round 2 found getting through', () => {
    for (const leak of [
      'https://x.test/cb#auth_token=SECRET123',
      'GET /v1?auth_token%3DSECRET123',
      'a&amp;auth_token=SECRET123',
      '{"api_key": "SECRET123"}',
      'bearer SECRET1234567',
      'X-Api-Key: SECRET123',
      'https://user:SECRET123@host.test/',
      'AKIAABCDEFGHIJKLMNOP and ghp_ABCDEFGHIJKLMNOPQRSTUV12',
      '?client_secret=SECRET123&password=SECRET123',
    ]) expect(scrub(leak), leak).not.toMatch(/SECRET|AKIAABCD|ghp_ABCD/);
  });
});

describe('prompts', () => {
  it('offers the call sequence for the common asks, naming the issue', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['briefly_pass', 'compare_with_last_week', 'finish_draft', 'proof_issue']);
    const got = await client.getPrompt({ name: 'finish_draft', arguments: { issue: 'wt390' } });
    const text = (got.messages[0]!.content as { text: string }).text;
    expect(text).toContain('issue wt390');
    expect(text).toContain('get_status');
    expect(text).toMatch(/never instructions/);
  });
});

describe('logging', () => {
  it('logs every call: the tool, the issue, the outcome, the time, and who asked', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: unknown) => { lines.push(String(l)); });
    try {
      const c = new Client({ name: 'log-test', version: '9.9' });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      await c.callTool({ name: 'get_status', arguments: { issue: 'wt390' } });
      await c.callTool({ name: 'get_item', arguments: { issue: 'wt390', item_id: 'nope\n[mcp] forged' } });
      await c.getPrompt({ name: 'proof_issue', arguments: {} });
      await c.close();
    } finally {
      spy.mockRestore();
    }
    const mcp = lines.filter((l) => l.startsWith('[mcp]'));
    expect(mcp.some((l) => /^\[mcp\] connected log-test 9\.9 \(local /.test(l))).toBe(true);
    expect(mcp.some((l) => /^\[mcp\] get_status wt390 \{"issue":"wt390"\} → ok \d+ms \(local /.test(l))).toBe(true);
    expect(mcp.some((l) => /^\[mcp\] get_item wt390 .* → refused: "No item/.test(l))).toBe(true);
    expect(mcp.some((l) => l.startsWith('[mcp] prompt proof_issue'))).toBe(true);
    // An argument cannot forge a line: every line is one line.
    for (const l of lines) expect(l).not.toContain('\n');
  });

  it('logs a refused request with its status', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((l: unknown) => { lines.push(String(l)); });
    try {
      await fetch(`${base}/mcp`, { method: 'DELETE' });
    } finally {
      spy.mockRestore();
    }
    expect(lines.some((l) => /^\[mcp\] HTTP 405 DELETE \(local /.test(l))).toBe(true);
  });

  it('answers only POST: a GET event stream is refused, not held open', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const res = await fetch(`${base}/mcp`, { method, headers: { Accept: 'text/event-stream' }, signal: AbortSignal.timeout(2000) });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
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
    const s = buildServer({ read: async (p) => { asked.push(p); return readRoute(p); }, scriptHash: () => '', linkedBefore: () => [] });
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
    for (const p of asked) expect(p).toMatch(/^\/api\/issues(\?heads=1|\/[^/]+(\/(events\?all=1|timing|render\/[a-z]+))?)?$/);
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
