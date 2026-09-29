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

import { createHash } from 'node:crypto';

import type { IssueDoc } from '../src/shared/types.ts';
import { audioScript } from '../src/shared/render/audio.ts';
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
  rehostCalls: 0,
  rehostFails: null as Error | null,
  /** What Buttondown says the email is, when the leg reads it first. */
  emailStatus: 'draft' as string | Error,
  /** The Buttondown check, when a test wants one to run; otherwise no leg is verified. */
  verifier: null as null | (() => Promise<{ checks: { label: string; ok: boolean | null; detail: string }[]; remote_status?: string }>),
  verifyCalls: 0,
  /** The next `sending` write for this leg throws, as SQLite does when the database is busy. */
  sendingWriteFails: null as string | null,
}));

vi.mock('../src/server/db.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/db.ts')>();
  return {
    ...real,
    recordSend: (...args: Parameters<typeof real.recordSend>) => {
      if (h.sendingWriteFails === args[1] && args[2].status === 'sending') {
        h.sendingWriteFails = null;
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      }
      return real.recordSend(...args);
    },
  };
});

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
    getEmail: vi.fn(async () => {
      if (h.emailStatus instanceof Error) throw h.emailStatus;
      return { subject: '', status: h.emailStatus, body: '' };
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
  return {
    ...real,
    putTree: vi.fn(async (files: RepoFile[]) => {
      h.committed.push(files);
      return { sha: `c0ffee${h.committed.length}`, changed: files.map((f) => f.path), unchanged: 0, committed: true };
    }),
  };
});

vi.mock('../src/server/integrations/images.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/images.ts')>()),
  rehostIssueImages: vi.fn(async (doc: IssueDoc) => {
    h.rehostCalls++;
    if (h.rehostGate) await h.rehostGate;
    if (h.rehostFails) throw h.rehostFails;
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
  verifierFor: (dest: string) => (dest === 'buttondown' && h.verifier
    ? async () => { h.verifyCalls++; return h.verifier!(); }
    : null),
}));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('http://127.0.0.1:')) throw new Error(`the send-state test reached off the machine: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

const { server, failInterruptedSends, HttpError } = await import('../src/server/index.ts');
const store = await import('../src/server/db.ts');

let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(() => {
  h.verifier = null;
  h.drafts.length = 0;
  h.draftFails = null;
  h.committed.length = 0;
  h.renderFails = null;
  h.rehostGate = null;
  h.rehostFails = null;
  h.emailStatus = 'draft';
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

/** Jamie's approval of the script as it stands, the way the Send view's gate records it. */
function approve(id: string): void {
  const doc = store.getIssue(id)!.doc;
  const hash = createHash('sha256').update(audioScript(doc).map((b) => b.text).join('\n')).digest('hex');
  doc.script_review = { at: new Date().toISOString(), script_hash: hash, verdict: 'ready', summary: 'test', findings: [], approved_at: new Date().toISOString() };
  store.saveIssue(doc);
}

/** POST a leg. A podcast send is approved first unless the test says otherwise. */
async function send(id: string, leg: string, query = '', opts: { approve?: boolean } = {}): Promise<{ status: number; body: any }> {
  if (leg === 'podcast' && opts.approve !== false) approve(id);
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
    expect(page).toContain(`audio_url: ${JSON.stringify(mp3)}`);
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
    const page = pageOf(h.committed.at(-1)!);
    expect(page).toContain(`absolute_url: ${JSON.stringify(url)}`);
    expect(page).toContain(`buttondown_id: ${JSON.stringify(legOf(id, 'buttondown')!.last_sent!.external_id)}`);
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

describe('the website commits without audio when told to, and says so', () => {
  const summaries = (id: string) => store.listEvents(id).map((e) => e.summary);

  it('force=1 with no audio commits the page without an episode, and logs the override', async () => {
    const id = issue(990415);
    expect((await send(id, 'website', '?force=1')).status).toBe(200);
    expect(pageOf(h.committed.at(-1)!)).not.toContain('audio_url');
    expect(summaries(id)).toContain('Override — website: committed with no podcast audio');
    store.deleteIssue(id);
  });

  it('force=1 with audio recorded is no override, and logs none', async () => {
    const id = issue(990416);
    store.recordSend(id, 'podcast', { status: 'sent', at: minutesAgo(5), audio: { audio_url: 'https://files.thingelstad.com/a.mp3' } });
    expect((await send(id, 'website', '?force=1')).status).toBe(200);
    expect(summaries(id).some((s) => s.startsWith('Override'))).toBe(false);
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

/** A gate a test opens by hand, and a wait for the leg to reach it. */
function hold(): { open: () => void } {
  let open!: () => void;
  h.rehostGate = new Promise<void>((resolve) => { open = resolve; });
  return { open };
}
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

describe('a leg is in flight from the moment it passes the guard', () => {
  it('records sending before its first await', async () => {
    const id = issue(990421);
    const gate = hold();
    const calls = h.rehostCalls;
    const first = send(id, 'buttondown');
    await until(() => h.rehostCalls > calls);
    // Held at the rehost: the leg already says it is sending.
    expect(legOf(id, 'buttondown')).toMatchObject({ status: 'sending' });
    gate.open();
    expect((await first).status).toBe(200);
    store.deleteIssue(id);
  });

  it('two clicks at once make one draft, and the second is refused as in flight', async () => {
    const id = issue(990422);
    const gate = hold();
    const calls = h.rehostCalls;
    const first = send(id, 'buttondown');
    await until(() => h.rehostCalls > calls);
    const second = await send(id, 'buttondown');
    expect(second.status).toBe(409);
    expect(second.body.error).toContain('in flight');
    gate.open();
    expect((await first).status).toBe(200);
    expect(h.drafts.filter((d) => d.op === 'create')).toHaveLength(1);
    store.deleteIssue(id);
  });

  it('a send still running past ten minutes is still in flight: the process knows, whatever the record says', async () => {
    const id = issue(990423);
    const gate = hold();
    const calls = h.rehostCalls;
    const first = send(id, 'buttondown');
    await until(() => h.rehostCalls > calls);
    // A long leg (podcast synthesis can pass ten minutes) looks like a
    // crash strand to the persisted record alone.
    store.recordSend(id, 'buttondown', { status: 'sending', at: minutesAgo(11) });
    const second = await send(id, 'buttondown');
    expect(second.status).toBe(409);
    gate.open();
    expect((await first).status).toBe(200);
    expect(h.drafts.filter((d) => d.op === 'create')).toHaveLength(1);
    store.deleteIssue(id);
  });

  it('a failure before the destination is reached records failed, and the retry is not refused', async () => {
    const id = issue(990424);
    h.rehostFails = new Error('the CDN upload failed');
    const res = await send(id, 'buttondown');
    expect(res.status).toBe(502);
    expect(legOf(id, 'buttondown')).toMatchObject({ status: 'failed', error: 'the CDN upload failed' });
    h.rehostFails = null;
    expect((await send(id, 'buttondown')).status).toBe(200);
    store.deleteIssue(id);
  });
});

describe('a restart strands no leg in sending', () => {
  it('boot turns every persisted sending into failed, keeping the last good send', () => {
    const id = issue(990425);
    store.recordSend(id, 'buttondown', { status: 'sent', at: minutesAgo(60), external_id: 'em-7', url: 'https://buttondown.test/archive/em-7/' });
    store.recordSend(id, 'buttondown', { status: 'sending', at: minutesAgo(1), external_id: 'em-7' });
    store.recordSend(id, 'podcast', { status: 'sending', at: minutesAgo(1) });
    store.recordSend(id, 'archive', { status: 'sent', at: minutesAgo(30), external_id: 'abc1234' });

    failInterruptedSends();

    const sends = store.getIssue(id)!.doc.sends!;
    expect(sends.buttondown).toMatchObject({ status: 'failed', error: 'interrupted by a restart', external_id: 'em-7' });
    expect(sends.buttondown!.last_sent).toMatchObject({ status: 'sent', external_id: 'em-7' });
    expect(sends.podcast).toMatchObject({ status: 'failed', error: 'interrupted by a restart' });
    expect(sends.podcast!.last_sent).toBeUndefined();
    // A leg that was not in flight is left exactly as it was.
    expect(sends.archive).toMatchObject({ status: 'sent', external_id: 'abc1234' });
    store.deleteIssue(id);
  });
});

describe('Buttondown is asked what the email is before it is changed', () => {
  async function sentOnce(number: number): Promise<{ id: string; before: unknown }> {
    const id = issue(number);
    expect((await send(id, 'buttondown')).status).toBe(200);
    h.drafts.length = 0;
    return { id, before: structuredClone(legOf(id, 'buttondown')) };
  }

  // Jamie decided 2026-09-29: the email is edited only while it is a draft.
  // The archive is not hosted on Buttondown, so a sent email has no copy
  // worth editing, and every other status is somewhere a PATCH is unsafe.
  const notDraft = ['scheduled', 'about_to_send', 'in_flight', 'sent', 'imported', 'something_new'];
  notDraft.forEach((status, i) => {
    it(`${status}: refused as no longer a draft; the leg is untouched and the refusal is logged`, async () => {
      const { id, before } = await sentOnce(990500 + i);
      const events = store.listEvents(id).length;
      h.emailStatus = status;
      const res = await send(id, 'buttondown');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('not_draft');
      expect(res.body.error).toContain('no longer a draft');
      expect(res.body.error).toContain(`"${status}"`);
      expect(h.drafts).toHaveLength(0);
      expect(legOf(id, 'buttondown')).toEqual(before);
      expect(store.getIssue(id)!.doc.verify!.buttondown!.remote_status).toBe(status);
      // One line in the log, so `npm run watch` shows the refusal.
      const logged = store.listEvents(id).slice(0, store.listEvents(id).length - events);
      expect(logged.map((e) => e.summary)).toEqual([expect.stringMatching(/^Send refused — buttondown: .*no longer a draft/)]);
      store.deleteIssue(id);
    });
  });

  // Jamie, 2026-09-29: nothing in their own tool they cannot override. The
  // card warns and asks; `?force=1` is what it sends. The update is the
  // same PATCH as a draft's — subject and body, never a status.
  notDraft.forEach((status, i) => {
    it(`${status}, overridden: updated anyway, and the override is logged`, async () => {
      const { id, before } = await sentOnce(990510 + i);
      const events = store.listEvents(id).length;
      h.emailStatus = status;
      const res = await send(id, 'buttondown', '?force=1');
      expect(res.status).toBe(200);
      expect(h.drafts).toEqual([expect.objectContaining({ op: 'update', id: (before as { external_id: string }).external_id })]);
      expect(legOf(id, 'buttondown')).toMatchObject({ status: 'sent' });
      const logged = store.listEvents(id).slice(0, store.listEvents(id).length - events).map((e) => e.summary);
      expect(logged).toContain(`Override — buttondown: the email is "${status}", not a draft; updating it anyway`);
      expect(logged).toContain(`Send finished — buttondown (updated while "${status}", by override; status unchanged)`);
      store.deleteIssue(id);
    });
  });

  it('draft, with force=1: an ordinary update, and no override logged', async () => {
    const { id } = await sentOnce(990516);
    h.emailStatus = 'draft';
    expect((await send(id, 'buttondown', '?force=1')).status).toBe(200);
    expect(h.drafts).toEqual([expect.objectContaining({ op: 'update' })]);
    expect(store.listEvents(id).some((e) => e.summary.startsWith('Override'))).toBe(false);
    store.deleteIssue(id);
  });

  it('sent: a web-copy update is no longer offered, and asking for one changes nothing', async () => {
    const { id, before } = await sentOnce(990443);
    h.emailStatus = 'sent';
    const refused = await send(id, 'buttondown', '?web_copy=1');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('not_draft');
    expect(refused.body.error).not.toContain('web_copy');
    expect(h.drafts).toHaveLength(0);
    expect(legOf(id, 'buttondown')).toEqual(before);
    store.deleteIssue(id);
  });

  it('sent: the refusal records what Buttondown said, so the card drops its action at once', async () => {
    // WT350 and WT351: verified before the check read the email's status back.
    const { id } = await sentOnce(990447);
    const at = '2026-09-26T15:00:00Z';
    const checks = [{ label: 'Subject', ok: true, detail: 'matches' }];
    store.recordVerify(id, 'buttondown', { status: 'passed', at, checks });
    h.emailStatus = 'sent';
    const refused = await send(id, 'buttondown');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('not_draft');
    // The check's own findings are kept; only what Buttondown said is added.
    expect(store.getIssue(id)!.doc.verify!.buttondown).toEqual({ status: 'passed', at, checks, remote_status: 'sent' });
    store.deleteIssue(id);
  });

  it('sent: the refusal adds no revision, so it pushes no real edit out of the history', async () => {
    const { id } = await sentOnce(990449);
    store.recordVerify(id, 'buttondown', { status: 'passed', at: '2026-09-26T15:00:00Z', checks: [] });
    const revisions = store.listRevisions(id).length;
    h.emailStatus = 'sent';
    expect((await send(id, 'buttondown')).status).toBe(409);
    expect(store.getIssue(id)!.doc.verify!.buttondown!.remote_status).toBe('sent');
    expect(store.listRevisions(id)).toHaveLength(revisions);
    store.deleteIssue(id);
  });

  it('sent, never verified: the refusal records only what Buttondown said, never a pass', async () => {
    const { id } = await sentOnce(990448);
    const doc = store.getIssue(id)!.doc;
    delete doc.verify;
    store.saveIssue(doc);
    h.emailStatus = 'sent';
    expect((await send(id, 'buttondown')).status).toBe(409);
    const v = store.getIssue(id)!.doc.verify!.buttondown!;
    expect(v.remote_status).toBe('sent');
    // Subject, body and delivery never ran: nothing here may read as verified.
    expect(v.status).not.toBe('passed');
    expect(v.checks.every((c) => c.ok !== true)).toBe(true);
    store.deleteIssue(id);
  });

  it('sent, never verified: the real check runs once the leg is set back', async () => {
    const { id, before } = await sentOnce(990450);
    const doc = store.getIssue(id)!.doc;
    delete doc.verify;
    store.saveIssue(doc);
    h.emailStatus = 'sent';
    h.verifier = async () => ({ checks: [{ label: 'Status', ok: true, detail: 'Sent' }, { label: 'Subject', ok: true, detail: 'matches' }], remote_status: 'sent' });
    const calls = h.verifyCalls;
    expect((await send(id, 'buttondown')).status).toBe(409);
    await until(() => h.verifyCalls > calls && store.getIssue(id)!.doc.verify!.buttondown!.status === 'passed');
    expect(store.getIssue(id)!.doc.verify!.buttondown!.checks).toHaveLength(2);
    expect(legOf(id, 'buttondown')).toEqual(before);
    store.deleteIssue(id);
  });

  it('draft: updated as before', async () => {
    const { id, before } = await sentOnce(990444);
    h.emailStatus = 'draft';
    expect((await send(id, 'buttondown')).status).toBe(200);
    expect(h.drafts).toEqual([expect.objectContaining({ op: 'update', id: (before as { external_id: string }).external_id })]);
    store.deleteIssue(id);
  });

  it('a status Buttondown will not give is a failed send that changes nothing there', async () => {
    const { id } = await sentOnce(990446);
    h.emailStatus = new Error('Buttondown /emails/em-1 failed: 503');
    const res = await send(id, 'buttondown');
    expect(res.status).toBe(502);
    expect(h.drafts).toHaveLength(0);
    expect(legOf(id, 'buttondown')).toMatchObject({ status: 'failed' });
    expect(legOf(id, 'buttondown')!.last_sent?.external_id).toBeTruthy();
    store.deleteIssue(id);
  });
});

describe('the server holds the podcast to the script Jamie approved', () => {
  it('an unapproved script is refused before anything is synthesized or recorded', async () => {
    const id = issue(990451);
    const renders = h.renders;
    const res = await send(id, 'podcast', '', { approve: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/approve/i);
    expect(h.renders).toBe(renders);
    expect(legOf(id, 'podcast')).toBeUndefined();
    store.deleteIssue(id);
  });

  it('an approval of an earlier script does not cover this one', async () => {
    const id = issue(990452);
    approve(id);
    const doc = store.getIssue(id)!.doc;
    doc.items[Object.keys(doc.items).find((k) => doc.items[k]!.type === 'intro')!]!.body = 'A different intro, said aloud.';
    store.saveIssue(doc);
    const renders = h.renders;
    const res = await send(id, 'podcast', '', { approve: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed/i);
    expect(h.renders).toBe(renders);
    store.deleteIssue(id);
  });

  it('a podcast already sent re-synthesizes without asking again', async () => {
    const id = issue(990453);
    expect((await send(id, 'podcast')).status).toBe(200);
    const doc = store.getIssue(id)!.doc;
    delete doc.script_review;
    store.saveIssue(doc);
    expect((await send(id, 'podcast', '', { approve: false })).status).toBe(200);
    store.deleteIssue(id);
  });

  // Jamie, 2026-09-29: once an mp3 has gone out, a re-send does not ask
  // again, even when the latest attempt failed. The gate is for the first
  // episode; after that it is a forced step in Jamie's own tool.
  it('a podcast whose re-send failed after a good send re-synthesizes without asking again', async () => {
    const id = issue(990454);
    expect((await send(id, 'podcast')).status).toBe(200);
    store.recordSend(id, 'podcast', { status: 'failed', at: new Date().toISOString(), error: 'OpenAI TTS failed: 500' });
    expect(legOf(id, 'podcast')!.last_sent?.status).toBe('sent');
    const doc = store.getIssue(id)!.doc;
    delete doc.script_review;
    store.saveIssue(doc);
    expect((await send(id, 'podcast', '', { approve: false })).status).toBe(200);
    store.deleteIssue(id);
  });

  // Jamie, 2026-09-29: the approval can be skipped on purpose. The card
  // asks first; `?force=1` is what it sends, and the log says it happened.
  it('an unapproved script is synthesized with force=1, and the override is logged', async () => {
    const id = issue(990456);
    const renders = h.renders;
    const res = await send(id, 'podcast', '?force=1', { approve: false });
    expect(res.status).toBe(200);
    expect(h.renders).toBe(renders + 1);
    expect(legOf(id, 'podcast')).toMatchObject({ status: 'sent' });
    expect(store.listEvents(id).map((e) => e.summary))
      .toContain('Override — podcast: synthesized without approval (the podcast script has not been approved)');
    store.deleteIssue(id);
  });

  it('a script changed since its approval is synthesized as it stands with force=1', async () => {
    const id = issue(990457);
    approve(id);
    const doc = store.getIssue(id)!.doc;
    doc.items[Object.keys(doc.items).find((k) => doc.items[k]!.type === 'intro')!]!.body = 'A different intro, said aloud.';
    store.saveIssue(doc);
    expect((await send(id, 'podcast', '?force=1', { approve: false })).status).toBe(200);
    expect(store.listEvents(id).map((e) => e.summary))
      .toContain('Override — podcast: synthesized without approval (the script has changed since it was approved)');
    store.deleteIssue(id);
  });

  it('an approved script with force=1 is no override, and logs none', async () => {
    const id = issue(990458);
    expect((await send(id, 'podcast', '?force=1')).status).toBe(200);
    expect(store.listEvents(id).some((e) => e.summary.startsWith('Override'))).toBe(false);
    store.deleteIssue(id);
  });

  it('a podcast that has only ever failed is still held to the approval', async () => {
    const id = issue(990455);
    store.recordSend(id, 'podcast', { status: 'failed', at: new Date().toISOString(), error: 'OpenAI TTS failed: 500' });
    const res = await send(id, 'podcast', '', { approve: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/approve/i);
    store.deleteIssue(id);
  });
});

describe('the website leg commits the issue page alone', () => {
  it('the commit is this issue\'s page and nothing the site shares, so there is no index to merge or refuse', async () => {
    // The site derives its issue index from the pages (2026-09-29). The leg
    // once merged emails.json inside its commit and refused a missing or
    // truncated one; with no shared file there is nothing to race either.
    const id = issue(990461);
    store.recordSend(id, 'podcast', { status: 'sent', at: new Date().toISOString(), audio: { audio_url: 'https://files.thingelstad.com/a.mp3' } });
    expect((await send(id, 'website')).status).toBe(200);
    expect(h.committed).toHaveLength(1);
    expect(h.committed[0]!.map((f) => f.path)).toEqual(['apps/site/archive/990461.md']);
    store.deleteIssue(id);
  });
});

describe('a claim that cannot be recorded is not held', () => {
  it('a busy database on the sending write leaves the leg free to retry', async () => {
    const id = issue(990481);
    store.recordSend(id, 'podcast', { status: 'sent', at: new Date().toISOString(), audio: { audio_url: 'https://files.thingelstad.com/a.mp3' } });
    h.sendingWriteFails = 'website';
    const first = await send(id, 'website');
    expect(first.status).toBe(500);
    expect(first.body.error).toMatch(/locked/);
    expect(legOf(id, 'website')).toBeUndefined();
    // Not "already in flight" until a restart: the key was never kept.
    expect((await send(id, 'website')).status).toBe(200);
    store.deleteIssue(id);
  });
});

describe('a Buttondown failure recorded before last_sent still names its draft', () => {
  // A failed state from before last_sent carried the draft id on itself;
  // the Buttondown retry read it there, and the page and archive must too.
  const legacy = (id: string) => {
    const doc = store.getIssue(id)!.doc;
    doc.sends = { ...(doc.sends ?? {}), buttondown: { status: 'failed', at: '2026-09-20T15:00:00Z', error: 'Buttondown failed: 503', external_id: 'em-legacy' } };
    store.saveIssue(doc);
  };
  const committedField = (path: RegExp) => h.committed.at(-1)!.find((f) => path.test(f.path))!.content;

  it('the website page carries its id, not an empty one', async () => {
    const id = issue(990491);
    store.recordSend(id, 'podcast', { status: 'sent', at: new Date().toISOString(), audio: { audio_url: 'https://files.thingelstad.com/a.mp3' } });
    legacy(id);
    expect((await send(id, 'website')).status).toBe(200);
    expect(committedField(/archive\/990491\.md$/)).toContain('buttondown_id: "em-legacy"');
    store.deleteIssue(id);
  });

  it('the archive carries its id, not an empty one', async () => {
    const id = issue(990492);
    legacy(id);
    expect((await send(id, 'archive')).status).toBe(200);
    const files = h.committed.at(-1)!.map((f) => f.content).join('\n');
    expect(files).toContain('em-legacy');
    expect(files).not.toMatch(/buttondown_id: ""/);
    store.deleteIssue(id);
  });
});

describe('only the refusal skips the failure record', () => {
  it('a 409 from anything else in the Buttondown leg is a failed send, not a stranded sending', async () => {
    const id = issue(990493);
    h.rehostFails = new HttpError(409, 'something else said conflict');
    const res = await send(id, 'buttondown');
    expect(res.status).toBe(502);
    expect(legOf(id, 'buttondown')).toMatchObject({ status: 'failed', error: 'something else said conflict' });
    h.rehostFails = null;
    // And the next attempt is not refused as in flight.
    expect((await send(id, 'buttondown')).status).toBe(200);
    store.deleteIssue(id);
  });
});

describe('checking again keeps what Buttondown last said', () => {
  it('the running record carries remote_status, so the card does not flip back to "Update draft"', async () => {
    const id = issue(990494);
    expect((await send(id, 'buttondown')).status).toBe(200);
    store.recordVerify(id, 'buttondown', { status: 'passed', at: '2026-09-26T15:00:00Z', checks: [], remote_status: 'sent' });
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    h.verifier = async () => { await held; return { checks: [{ label: 'Status', ok: true, detail: 'Sent' }], remote_status: 'sent' }; };
    const res = await realFetch(`${base}/api/issues/${id}/verify/buttondown`, { method: 'POST', body: '{}' });
    const running = (await res.json()).issue.verify.buttondown;
    expect(running).toMatchObject({ status: 'running', remote_status: 'sent' });
    release();
    await until(() => store.getIssue(id)!.doc.verify!.buttondown!.status !== 'running');
    expect(store.getIssue(id)!.doc.verify!.buttondown).toMatchObject({ status: 'passed', remote_status: 'sent' });
    store.deleteIssue(id);
  });

  it('a check that cannot reach Buttondown keeps it too', async () => {
    const id = issue(990495);
    expect((await send(id, 'buttondown')).status).toBe(200);
    store.recordVerify(id, 'buttondown', { status: 'passed', at: '2026-09-26T15:00:00Z', checks: [], remote_status: 'sent' });
    h.verifier = async () => { throw new Error('Buttondown /emails failed: 503'); };
    await realFetch(`${base}/api/issues/${id}/verify/buttondown`, { method: 'POST', body: '{}' });
    await until(() => store.getIssue(id)!.doc.verify!.buttondown!.status !== 'running');
    expect(store.getIssue(id)!.doc.verify!.buttondown).toMatchObject({ status: 'error', remote_status: 'sent' });
    store.deleteIssue(id);
  });
});
