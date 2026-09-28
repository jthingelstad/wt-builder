/**
 * The website leg, run over HTTP with its integrations stubbed: the GitHub
 * commit and the rehost are mocks, and any other call off this machine fails
 * the test. What is asserted is what the leg would have committed.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import type { RepoFile } from '../src/server/integrations/github.ts';

const work = mkdtempSync(join(tmpdir(), 'wt-send-website-'));
process.env.WT_BUILDER_DB = join(work, 'send-website.db');

const ORIGINAL = 'https://www.thingelstad.com/uploads/2026/dakota.jpg';
const CDN = 'https://files.thingelstad.com/weekly-thing/990201/0123456789abcdef.jpg';

const committed: RepoFile[][] = [];

vi.mock('../src/server/integrations/github.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/integrations/github.ts')>();
  // The site's emails.json as the leg reads it: the archive's 349 issues.
  const emails = Array.from({ length: 349 }, (_, i) => ({ number: i + 1, subject: `WT${i + 1}` }));
  return {
    ...real,
    readFile: vi.fn(async (path: string) => (path === 'apps/site/_data/emails.json' ? JSON.stringify(emails) : null)),
    putTree: vi.fn(async (files: RepoFile[]) => {
      committed.push(files);
      return { sha: 'f00d', changed: files.map((f) => f.path), unchanged: 0, committed: true };
    }),
  };
});

vi.mock('../src/server/integrations/images.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/integrations/images.ts')>();
  return {
    ...real,
    // The rehost as it runs on a first send: this photo is new to the CDN.
    rehostIssueImages: vi.fn(async (doc: IssueDoc) => ({
      doc,
      report: { rehosted: [], skipped: [], failed: [] },
      mapping: new Map([[ORIGINAL, CDN]]),
    })),
  };
});

// Verification reads the live site; it has its own tests (verify.test.ts).
vi.mock('../src/server/verify.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/verify.ts')>()),
  verifierFor: () => null,
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('http://127.0.0.1:')) throw new Error(`the website leg test reached off the machine: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

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
  globalThis.fetch = realFetch;
  rmSync(work, { recursive: true, force: true });
});

describe('the first website send', () => {
  it('commits a page that carries the images it just rehosted, not the originals', async () => {
    // Review 2026-09-27 §2.2: the leg saved the rehost map to a fresh read
    // but rendered the copy it read before the rehost, so every new Journal
    // photo shipped as the Micro.blog original until a later re-send.
    const fixture = JSON.parse(
      readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
    ) as IssueDoc;
    fixture.issue.id = 'wt990201';
    fixture.issue.number = 990201;
    delete fixture.image_map;
    expect(JSON.stringify(fixture.items)).toContain(ORIGINAL);
    store.createIssueRow(fixture);

    const res = await realFetch(`${base}/api/issues/wt990201/send/website?force=1`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);

    const page = committed.at(-1)!.find((f) => f.path === 'apps/site/archive/990201.md')!.content;
    expect(page).toContain(CDN);
    expect(page).not.toContain(ORIGINAL);
    // The item keeps the source's own URL; the map is applied on output.
    expect(store.getIssue('wt990201')!.doc.image_map).toEqual({ [ORIGINAL]: CDN });
    store.deleteIssue('wt990201');
  });
});
