/**
 * The drafting routes, over HTTP, with the model and the Librarian stubbed.
 * Pins what the Echoes route asks the Librarian for. Thingy's words are kept
 * out of the corpus by the Librarian itself (contract 4.11), so nothing here
 * filters them. No model is called and no network is reached.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';

const { create, retrieve } = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create };
  }
  return { default: Anthropic };
});

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
