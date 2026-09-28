/**
 * Send state over HTTP, with every integration a mock: Buttondown, the
 * GitHub commit, the rehost and the audio render are stubs, and any other
 * call off this machine fails the test. What is asserted is the state each
 * leg records and what it would have handed its destination.
 *
 * Review 2026-09-27 §2.1: a failed or interrupted leg must never erase what
 * the last good one did.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import type { RepoFile } from '../src/server/integrations/github.ts';

const work = mkdtempSync(join(tmpdir(), 'wt-send-state-'));
process.env.WT_BUILDER_DB = join(work, 'send-state.db');

/** What each mocked destination was handed, and how it will answer next. */
const h = vi.hoisted(() => ({
  drafts: [] as { op: 'create' | 'update'; id?: string; subject: string }[],
  draftFails: null as Error | null,
  committed: [] as { path: string; content: string }[][],
  renders: 0,
  renderFails: null as Error | null,
  /** Resolves the rehost when set: lets a test hold a leg mid-flight. */
  rehostGate: null as Promise<void> | null,
}));

vi.mock('../src/server/integrations/buttondown.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/integrations/buttondown.ts')>();
  const draft = (id: string, subject: string) => ({ id, url: `https://buttondown.test/archive/${id}/`, edit_url: `https://buttondown.test/emails/${id}`, subject });
  return {
    ...real,
    createDraft: vi.fn(async (subject: string) => {
      h.drafts.push({ op: 'create', subject });
      if (h.draftFails) throw h.draftFails;
      return draft(`em-${h.drafts.length}`, subject);
    }),
    updateDraft: vi.fn(async (id: string, subject: string) => {
      h.drafts.push({ op: 'update', id, subject });
      if (h.draftFails) throw h.draftFails;
      return draft(id, subject);
    }),
  };
});

vi.mock('../src/server/integrations/github.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/integrations/github.ts')>();
  const emails = Array.from({ length: 349 }, (_, i) => ({ number: i + 1, subject: `WT${i + 1}` }));
  return {
    ...real,
    readFile: vi.fn(async (path: string) => (path === 'apps/site/_data/emails.json' ? JSON.stringify(emails) : null)),
    putTree: vi.fn(async (files: RepoFile[]) => {
      h.committed.push(files);
      return { sha: `c0ffee${h.committed.length}`, changed: files.map((f) => f.path), unchanged: 0, committed: true };
    }),
  };
});

vi.mock('../src/server/integrations/images.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/images.ts')>()),
  rehostIssueImages: vi.fn(async (doc: IssueDoc) => {
    if (h.rehostGate) await h.rehostGate;
    return { doc, report: { rehosted: [], skipped: [], failed: [] }, mapping: new Map() };
  }),
}));

vi.mock('../src/server/integrations/audio.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/audio.ts')>()),
  renderAudio: vi.fn(async () => {
    h.renders++;
    if (h.renderFails) throw h.renderFails;
    const base = `https://files.thingelstad.com/weekly-thing/audio/take-${h.renders}`;
    return {
      url: `${base}.mp3`, bytes: 1000, durationSeconds: 600, voice: 'echo', pieces: 3, synthesized: 3,
      loudnormVersion: 'test', coverUrl: '', coverSource: 'show art',
      chaptersUrl: `${base}.chapters.json`, transcriptUrl: `${base}.vtt`, chapters: [],
    };
  }),
}));

// Verification reads the live destinations; it has its own tests.
vi.mock('../src/server/verify.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/verify.ts')>()),
  verifierFor: () => null,
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('http://127.0.0.1:')) throw new Error(`the send-state test reached off the machine: ${url}`);
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

afterEach(() => {
  h.drafts.length = 0;
  h.draftFails = null;
  h.committed.length = 0;
  h.renderFails = null;
  h.rehostGate = null;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  globalThis.fetch = realFetch;
  rmSync(work, { recursive: true, force: true });
});

/** A fresh draft issue from the representative fixture, under its own number. */
function issue(number: number): string {
  const doc = JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;
  doc.issue.id = `wt${number}`;
  doc.issue.number = number;
  store.createIssueRow(doc);
  return doc.issue.id;
}

async function send(id: string, leg: string, query = ''): Promise<{ status: number; body: any }> {
  const res = await realFetch(`${base}/api/issues/${id}/send/${leg}${query}`, { method: 'POST', body: '{}' });
  return { status: res.status, body: await res.json() };
}

const legOf = (id: string, leg: 'buttondown' | 'website' | 'podcast' | 'archive') => store.getIssue(id)!.doc.sends?.[leg];
const pageOf = (files: { path: string; content: string }[]) => files.find((f) => f.path.startsWith('apps/site/archive/'))!.content;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe('a leg that fails or is interrupted keeps its last good send', () => {
  it('recordSend carries the last success through sending and failed, and a new success replaces it', () => {
    const id = issue(990401);
    const audio = { audio_url: 'https://files.thingelstad.com/a.mp3' };
    store.recordSend(id, 'podcast', { status: 'sent', at: '2026-09-26T12:00:00Z', url: 'https://files.thingelstad.com/a.mp3', audio });

    store.recordSend(id, 'podcast', { status: 'sending', at: '2026-09-27T12:00:00Z' });
    expect(legOf(id, 'podcast')!.last_sent).toMatchObject({ status: 'sent', at: '2026-09-26T12:00:00Z', audio });

    store.recordSend(id, 'podcast', { status: 'failed', at: '2026-09-27T12:01:00Z', error: 'ffmpeg exited 1' });
    expect(legOf(id, 'podcast')).toMatchObject({ status: 'failed', error: 'ffmpeg exited 1' });
    expect(legOf(id, 'podcast')!.last_sent).toMatchObject({ status: 'sent', at: '2026-09-26T12:00:00Z', audio });

    // A new success is its own last good send: nothing older rides along.
    store.recordSend(id, 'podcast', { status: 'sent', at: '2026-09-27T13:00:00Z', url: 'https://files.thingelstad.com/b.mp3' });
    expect(legOf(id, 'podcast')!.last_sent).toBeUndefined();
    expect(legOf(id, 'podcast')!.url).toBe('https://files.thingelstad.com/b.mp3');
    store.deleteIssue(id);
  });

  it('a Buttondown retry after a send cut off mid-flight updates the draft it made, never a second one', async () => {
    const id = issue(990402);
    expect((await send(id, 'buttondown')).status).toBe(200);
    const draftId = legOf(id, 'buttondown')!.external_id;
    expect(h.drafts).toEqual([{ op: 'create', subject: expect.any(String) }]);

    // A restart mid-PATCH leaves `sending` behind; the ten-minute-old strand
    // passes the in-flight guard so the leg can be retried.
    store.recordSend(id, 'buttondown', { status: 'sending', at: minutesAgo(11) });
    expect(legOf(id, 'buttondown')!.last_sent?.external_id).toBe(draftId);

    expect((await send(id, 'buttondown')).status).toBe(200);
    expect(h.drafts.at(-1)).toMatchObject({ op: 'update', id: draftId });
    expect(h.drafts.filter((d) => d.op === 'create')).toHaveLength(1);
    store.deleteIssue(id);
  });

  it('a failed Buttondown update keeps the draft, and the retry updates it', async () => {
    const id = issue(990403);
    expect((await send(id, 'buttondown')).status).toBe(200);
    const draftId = legOf(id, 'buttondown')!.external_id;

    h.draftFails = new Error('Buttondown /emails failed: 503');
    expect((await send(id, 'buttondown')).status).toBe(502);
    expect(legOf(id, 'buttondown')).toMatchObject({ status: 'failed' });
    expect(legOf(id, 'buttondown')!.last_sent).toMatchObject({ status: 'sent', external_id: draftId });

    h.draftFails = null;
    expect((await send(id, 'buttondown')).status).toBe(200);
    expect(h.drafts.at(-1)).toMatchObject({ op: 'update', id: draftId });
    expect(h.drafts.filter((d) => d.op === 'create')).toHaveLength(1);
    store.deleteIssue(id);
  });

  it('a failed podcast re-render leaves the episode on the page the website commits', async () => {
    const id = issue(990404);
    expect((await send(id, 'podcast')).status).toBe(200);
    const mp3 = legOf(id, 'podcast')!.url!;

    h.renderFails = new Error('chapter art did not load');
    expect((await send(id, 'podcast')).status).toBe(502);
    expect(legOf(id, 'podcast')).toMatchObject({ status: 'failed', error: 'chapter art did not load' });

    // force=1 skips the ordering gate only; the page still embeds the last good audio.
    expect((await send(id, 'website', '?force=1')).status).toBe(200);
    const page = pageOf(h.committed.at(-1)!);
    expect(page).toContain(mp3);
    const emails = JSON.parse(h.committed.at(-1)!.find((f) => f.path === 'apps/site/_data/emails.json')!.content);
    expect(emails.find((e: { number: number }) => e.number === 990404).audio_url).toBe(mp3);
    store.deleteIssue(id);
  });

  it('the website page keeps the email URL while a Buttondown update is failing', async () => {
    const id = issue(990405);
    expect((await send(id, 'buttondown')).status).toBe(200);
    const url = legOf(id, 'buttondown')!.url!;
    h.draftFails = new Error('Buttondown /emails failed: 503');
    expect((await send(id, 'buttondown')).status).toBe(502);
    h.draftFails = null;

    expect((await send(id, 'website', '?force=1')).status).toBe(200);
    const emails = JSON.parse(h.committed.at(-1)!.find((f) => f.path === 'apps/site/_data/emails.json')!.content);
    const entry = emails.find((e: { number: number }) => e.number === 990405);
    expect(entry.absolute_url).toBe(url);
    expect(entry.id).toBe(legOf(id, 'buttondown')!.last_sent!.external_id);
    store.deleteIssue(id);
  });
});

describe('the email links the last good episode', () => {
  it('a failed podcast re-render keeps "Listen to it" on the mp3 that exists', async () => {
    const { otherWaysLine } = await import('../src/shared/render/email.ts');
    const doc = { issue: { number: 351 }, sends: {
      podcast: {
        status: 'failed', error: 'chapter art did not load',
        last_sent: { status: 'sent', url: 'https://files.thingelstad.com/weekly-thing/audio/wt351.mp3' },
      },
    } } as unknown as IssueDoc;
    expect(otherWaysLine(doc)).toContain('[Listen to it](https://files.thingelstad.com/weekly-thing/audio/wt351.mp3)');
  });
});

describe('the website waits for an audio reference, not for a podcast status', () => {
  it('a failed podcast re-render does not block a website re-send: the last good audio is embedded', async () => {
    const id = issue(990411);
    expect((await send(id, 'podcast')).status).toBe(200);
    const mp3 = legOf(id, 'podcast')!.url!;
    h.renderFails = new Error('chapter art did not load');
    expect((await send(id, 'podcast')).status).toBe(502);

    const res = await send(id, 'website');
    expect(res.status).toBe(200);
    expect(pageOf(h.committed.at(-1)!)).toContain(mp3);
    store.deleteIssue(id);
  });

  it('a podcast that never ran is refused as not run, with force=1 offered', async () => {
    const id = issue(990412);
    const res = await send(id, 'website');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('has not run');
    expect(res.body.error).toContain('force=1');
    expect(h.committed).toHaveLength(0);
    store.deleteIssue(id);
  });

  it('a podcast that ran and failed with no audio yet is refused as failed, not as "has not run"', async () => {
    const id = issue(990413);
    h.renderFails = new Error('OpenAI speech failed: 500');
    expect((await send(id, 'podcast')).status).toBe(502);
    const res = await send(id, 'website');
    expect(res.status).toBe(409);
    expect(res.body.error).not.toContain('has not run');
    expect(res.body.error).toContain('OpenAI speech failed: 500');
    expect(h.committed).toHaveLength(0);
    store.deleteIssue(id);
  });
});

describe('the website refusal says what the podcast leg did', () => {
  it('a podcast recorded as sent with no audio record is not called "not run"', async () => {
    const id = issue(990414);
    store.recordSend(id, 'podcast', { status: 'sent', at: minutesAgo(60), url: 'https://files.thingelstad.com/x.mp3' });
    const res = await send(id, 'website');
    expect(res.status).toBe(409);
    expect(res.body.error).not.toContain('has not run');
    expect(res.body.error).toContain('no audio reference');
    store.deleteIssue(id);
  });
});
