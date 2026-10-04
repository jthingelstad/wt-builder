/**
 * The drafting routes, over HTTP, with the model and the Librarian stubbed.
 * Pins what the Echoes route asks the Librarian for, and what the link wand
 * says about earlier issues. Thingy's words are kept out of the corpus by
 * the Librarian itself (contract 4.11), so nothing here filters them. No
 * model is called and no network is reached.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';

const { create, retrieve, fetchPublic } = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), fetchPublic: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create };
  }
  return { default: Anthropic };
});

// The link wand reads the page; here it is never reached.
vi.mock('../src/server/integrations/page.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/page.ts')>()),
  fetchPublic,
}));

vi.mock('../src/server/integrations/librarian.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/librarian.ts')>()),
  isConfigured: () => true,
  retrieve,
}));

const work = mkdtempSync(join(tmpdir(), 'wt-draft-routes-'));
process.env.WT_BUILDER_DB = join(work, 'draft-routes.db');

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
  retrieve.mockReset();
  fetchPublic.mockReset();
  fetchPublic.mockResolvedValue(new Response('', { status: 404 }));
});

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

const PARAGRAPH = 'A paragraph of commentary that clears the bar for a Notable link, written the way Jamie writes them, with a reason to read it.';

/** Notable commentary written: Echoes and the title no longer wait on it. */
function finishNotable(doc: IssueDoc): void {
  doc.items['link-flipcash']!.commentary = PARAGRAPH;
  doc.items['link-functions']!.commentary = PARAGRAPH;
}

describe('a wand on a section waiting on its inputs', () => {
  const waitingIssue = () => {
    const doc = fixture();
    doc.issue.id = 'wt390';
    doc.issue.number = 390;
    doc.items['haiku-1']!.body = '';
    // Untitled: the fixture's stand-in names WT350, and renumbered it reads as a real title.
    doc.issue.title = '';
    store.saveIssue(doc);
  };
  const post = (path: string) => fetch(`${base}/api/issues/wt390/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  // The link wand also asks the Librarian; nothing comes back.
  const candidates = () => retrieve.mockResolvedValue([]) && create.mockResolvedValue({
    stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: '{"candidates":["one","two"]}' }],
  });

  it('is refused with what it waits on, and drafts nothing', async () => {
    waitingIssue();
    const res = await post('items/haiku-1/draft');
    expect(res.status).toBe(409);
    const out = await res.json() as { error: string; code?: string };
    expect(out.code).toBe('waiting');
    expect(out.error).toContain('Haiku is waiting on Notable (0 of 2)');
    expect(create).not.toHaveBeenCalled();
  });

  it('drafts anyway with force=1, and logs the override', async () => {
    waitingIssue();
    candidates();
    const res = await post('items/haiku-1/draft?force=1');
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalled();
    expect(store.listEvents('wt390').map((e) => e.summary)).toContain('Override — drafted Haiku before Notable was done');
  });

  it('the title wand waits on Notable the same way', async () => {
    waitingIssue();
    const res = await post('items/issue/draft');
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain('Title is waiting on Notable');
  });

  it('a wand on a section that waits on nothing is never refused', async () => {
    waitingIssue();
    candidates();
    expect((await post('items/link-functions/draft')).status).toBe(200);
  });
});

describe('the Echoes route', () => {
  it('asks the Librarian for the whole archive, minus this issue and the two before it', async () => {
    const now = fixture();
    now.issue.id = 'wt360';
    now.issue.number = 360;
    now.issue.publication_date = '2026-11-28';
    const echoes = now.nodes.find((n) => n.type === 'echoes')!;
    for (const id of echoes.items) delete now.items[id];
    echoes.items = [];
    // Its inputs finished, so the Echoes pill is not waiting (the gate has its own tests).
    finishNotable(now);
    store.saveIssue(now);

    retrieve.mockResolvedValue([
      { issue_number: 221, source_kind: 'weekly_thing', label: 'WT221', publish_date: '2023-05-20',
        url: 'https://weekly.thingelstad.com/archive/221/', text: 'The boat went in on a grey morning.' },
    ]);
    create.mockResolvedValue({ stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: '{"echoes":[]}' }] });

    const res = await fetch(`${base}/api/issues/wt360/nodes/echoes/echoes/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(200);
    expect(retrieve.mock.calls[0]![2]).toMatchObject({ scope: 'all', filters: { excludeIssues: [360, 359, 358] } });
    const prompt = String(create.mock.calls[0]![0].messages[0].content);
    expect(prompt).toContain('The boat went in on a grey morning.');
  });

  it('says the archive is busy while it waits, and fails in a sentence logged on the section', async () => {
    // wt360 from the test above: Echoes empty, its inputs finished.
    const { ArchiveError } = await import('../src/server/integrations/librarian.ts');
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    retrieve.mockImplementation(async (_q: string, _k: number, _o: unknown, onBusy?: (attempt: number) => void) => {
      onBusy?.(0);
      await held;
      throw new ArchiveError('The archive was too busy to answer.', 'later', '429 Too Many Requests {"Reason":"ReservedFunctionConcurrentInvocationLimitExceeded"}');
    });
    const before = (await (await fetch(`${base}/api/issues/wt360/drafting`)).json()) as { drafting: unknown };
    expect(before.drafting).toBeNull();

    const answer = fetch(`${base}/api/issues/wt360/nodes/echoes/echoes/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    await expect.poll(async () => ((await (await fetch(`${base}/api/issues/wt360/drafting`)).json()) as { drafting: unknown }).drafting)
      .toEqual({ anchor: 'echoes', says: 'The archive is busy; trying again…' });
    release();
    const res = await answer;
    expect(res.status).toBe(500);
    const out = await res.json() as { error: string };
    expect(out.error).toBe('The archive was too busy to answer. Try Echoes again in a minute.');
    expect(out.error).not.toMatch(/[{}]|429/);
    expect(create).not.toHaveBeenCalled();

    // Logged on the section, so the log and the MCP's changes show it; the
    // draft's words are gone from /drafting once it has answered.
    const failed = store.listEvents('wt360').find((e) => e.kind === 'draft');
    expect(failed).toMatchObject({ anchor: 'echoes', summary: 'Draft failed: The archive was too busy to answer. Try Echoes again in a minute. — Echoes' });
    expect(((await (await fetch(`${base}/api/issues/wt360/drafting`)).json()) as { drafting: unknown }).drafting).toBeNull();
  });

  it("a model that is too busy is a sentence too, never the SDK's JSON", async () => {
    retrieve.mockResolvedValue([
      { issue_number: 221, source_kind: 'weekly_thing', label: 'WT221', publish_date: '2023-05-20',
        url: 'https://weekly.thingelstad.com/archive/221/', text: 'The boat went in on a grey morning.' },
    ]);
    // The SDK's InternalServerError for an overloaded model, by shape.
    class InternalServerError extends Error { status = 529; error = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }; }
    create.mockRejectedValue(new InternalServerError('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'));
    const res = await fetch(`${base}/api/issues/wt360/nodes/echoes/echoes/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const out = await res.json() as { error: string };
    expect(out.error).toBe("The draft didn't come back: the model was too busy. Try again in a minute.");
    expect(store.listEvents('wt360').find((e) => e.kind === 'draft')?.summary).toContain('the model was too busy');
  });
});

describe('the link wand', () => {
  /** An earlier issue as the pre-Builder import holds it: one published body. */
  const earlier = (number: number, date: string, body: string, status: 'published' | 'draft' = 'published') => ({
    schema_version: fixture().schema_version,
    issue: { id: `wt${number}`, number, title: `WT${number}`, dek: '', status, publication_date: date, window_days: 7, imported: true },
    nodes: [{ id: 'published', kind: 'mdblock', type: 'mdblock', label: 'Published text', movable: false, publishes_heading: false, items: ['published-text'] }],
    items: {
      'published-text': { type: 'markdown', authorship: 'Jamie', source: 'direct', channels: { website: true, email: true, audio: true }, body },
    },
    sends: {},
  }) as unknown as IssueDoc;

  it('says which earlier issues carried this exact link, and tells the draft', async () => {
    const now = fixture();
    now.issue.id = 'wt380';
    now.issue.number = 380;
    // The fixture's window, so its links are in the issue.
    store.saveIssue(now);
    store.saveIssue(earlier(274, '2024-01-27', 'Read [Flipcash](http://www.avc.xyz/create-your-own-currency-with-flipcash/?utm_source=rss).'));
    store.saveIssue(earlier(120, '2020-02-01', 'Also https://avc.xyz/create-your-own-currency-with-flipcash'));
    store.saveIssue(earlier(301, '2025-06-01', 'An unsent draft: https://avc.xyz/create-your-own-currency-with-flipcash', 'draft'));
    store.saveIssue(earlier(399, '2027-01-01', 'Later: https://avc.xyz/create-your-own-currency-with-flipcash'));

    retrieve.mockResolvedValue([]);
    create.mockResolvedValue({ stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: '{"candidates":["one","two"]}' }] });

    const res = await fetch(`${base}/api/issues/wt380/items/link-flipcash/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(200);
    const out = await res.json() as { candidates: string[]; linked_before?: { number: number; publication_date: string }[] };
    expect(out.linked_before).toEqual([
      { number: 274, publication_date: '2024-01-27' },
      { number: 120, publication_date: '2020-02-01' },
    ]);
    const prompt = String(create.mock.calls[0]![0].messages[0].content);
    expect(prompt).toContain('This exact link was in the Weekly Thing before: WT274 (2024-01-27), WT120 (2020-02-01).');
    expect(fetchPublic).toHaveBeenCalledWith('https://avc.xyz/create-your-own-currency-with-flipcash', expect.anything());
  });

  it('says nothing for a link no earlier issue carried', async () => {
    retrieve.mockResolvedValue([]);
    create.mockResolvedValue({ stop_reason: 'end_turn', stop_details: null, content: [{ type: 'text', text: '{"candidates":["one","two"]}' }] });
    const res = await fetch(`${base}/api/issues/wt380/items/link-functions/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(200);
    const out = await res.json() as { linked_before?: unknown };
    expect(out.linked_before).toBeUndefined();
    expect(String(create.mock.calls[0]![0].messages[0].content)).not.toContain('was in the Weekly Thing before');
  });
});
