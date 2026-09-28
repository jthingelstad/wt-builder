/**
 * The Buttondown leg, run over HTTP with its integrations stubbed: the draft
 * API and the rehost are mocks, and any other call off this machine fails
 * the test. What is asserted is what the leg would have handed Buttondown.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';

const work = mkdtempSync(join(tmpdir(), 'wt-send-buttondown-'));
process.env.WT_BUILDER_DB = join(work, 'send-buttondown.db');

const drafts: { subject: string; body: string }[] = [];

vi.mock('../src/server/integrations/buttondown.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/integrations/buttondown.ts')>();
  const draft = (id: string) => ({ id, url: `https://buttondown.test/${id}`, edit_url: `https://buttondown.test/${id}/edit` });
  return {
    ...real,
    createDraft: vi.fn(async (subject: string, body: string) => { drafts.push({ subject, body }); return draft('em-new'); }),
    updateDraft: vi.fn(async (id: string, subject: string, body: string) => { drafts.push({ subject, body }); return draft(id); }),
  };
});

vi.mock('../src/server/integrations/images.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/images.ts')>()),
  rehostIssueImages: vi.fn(async (doc: IssueDoc) => ({
    doc,
    report: { rehosted: [], skipped: [], failed: [] },
    mapping: new Map(),
  })),
}));

// Verification reads Buttondown; it has its own tests (verify.test.ts).
vi.mock('../src/server/verify.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/verify.ts')>()),
  verifierFor: () => null,
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('http://127.0.0.1:')) throw new Error(`the Buttondown leg test reached off the machine: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

const { server } = await import('../src/server/index.ts');
const store = await import('../src/server/db.ts');
const { emailSubject, subjectFor } = await import('../src/server/publish.ts');

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

describe('the Buttondown send', () => {
  it('hands Buttondown a subject with no template tag it did not write', async () => {
    // Buttondown templates the subject as it does the body (review
    // 2026-09-27 §3): a title carrying {{ or {% must reach it broken.
    const fixture = JSON.parse(
      readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
    ) as IssueDoc;
    fixture.issue.id = 'wt990202';
    fixture.issue.number = 990202;
    fixture.issue.title = 'Moving {{ braces }} and {% blocks %}';
    store.createIssueRow(fixture);

    const res = await realFetch(`${base}/api/issues/wt990202/send/buttondown`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);

    const sent = drafts.at(-1)!.subject;
    const doc = store.getIssue('wt990202')!.doc;
    expect(sent).toBe(emailSubject(doc));
    expect(sent).not.toBe(subjectFor(doc));
    expect(sent).not.toMatch(/\{[{%#]/);
    store.deleteIssue('wt990202');
  });
});
