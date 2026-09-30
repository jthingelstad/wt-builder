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

describe('the Echoes route', () => {
  it('asks the Librarian for the whole archive, minus this issue and the two before it', async () => {
    const now = fixture();
    now.issue.id = 'wt360';
    now.issue.number = 360;
    now.issue.publication_date = '2026-11-28';
    const echoes = now.nodes.find((n) => n.type === 'echoes')!;
    for (const id of echoes.items) delete now.items[id];
    echoes.items = [];
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
