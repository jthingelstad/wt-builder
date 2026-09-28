/**
 * Send state over HTTP, with every integration a mock: Buttondown, the
 * GitHub commit, the rehost and the audio render are stubs, and any other
 * call off this machine fails the test. What is asserted is the state each
 * leg records and what it would have handed its destination.
 *
 * Review 2026-09-27 §2.1: a failed or interrupted leg must never erase what
 * the last good one did.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  /** The site's emails.json on GitHub, as it stands now: the archive's 349 issues. */
  siteEmails: '',
  /**
   * Another writer's commits that land between a leg's read and its ref
   * update: each one makes the next ref update lose the race, as GitHub
   * answers it, and changes emails.json before the leg reads it again.
   */
  raceWinners: [] as ((emails: { number: number; [k: string]: unknown }[]) => void)[],
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
  const EMAILS = 'apps/site/_data/emails.json';
  const commit = (files: RepoFile[]) => {
    h.committed.push(files);
    const emails = files.find((f) => f.path === EMAILS);
    if (emails) h.siteEmails = emails.content;
    return { sha: `c0ffee${h.committed.length}`, changed: files.map((f) => f.path), unchanged: 0, committed: true };
  };
  return {
    ...real,
    readFile: vi.fn(async (path: string) => (path === EMAILS ? h.siteEmails : null)),
    putTree: vi.fn(async (files: RepoFile[]) => commit(files)),
    // As the real one does: each attempt edits the files as they stand, and
    // a lost ref update re-reads and edits again.
    editTree: vi.fn(async (paths: string[], edit: (path: string, current: string | null) => string | null) => {
      for (;;) {
        const files = paths
          .map((path) => ({ path, content: edit(path, path === EMAILS ? h.siteEmails : null) }))
          .filter((f): f is RepoFile => f.content !== null);
        const winner = h.raceWinners.shift();
        if (!winner) return commit(files);
        const emails = JSON.parse(h.siteEmails);
        winner(emails);
        h.siteEmails = JSON.stringify(emails);
      }
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
  verifierFor: () => null,
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

const ARCHIVE_EMAILS = JSON.stringify(Array.from({ length: 349 }, (_, i) => ({ number: i + 1, subject: `WT${i + 1}` })));
beforeEach(() => {
  h.siteEmails = ARCHIVE_EMAILS;
  h.raceWinners.length = 0;
});

afterEach(() => {
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

  for (const status of ['about_to_send', 'in_flight']) {
    it(`${status}: refused while Buttondown delivers it, and nothing is recorded`, async () => {
      const { id, before } = await sentOnce(status === 'in_flight' ? 990441 : 990442);
      const events = store.listEvents(id).length;
      h.emailStatus = status;
      const res = await send(id, 'buttondown');
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Buttondown is delivering it now');
      expect(h.drafts).toHaveLength(0);
      expect(legOf(id, 'buttondown')).toEqual(before);
      expect(store.listEvents(id).length).toBe(events);
      store.deleteIssue(id);
    });
  }

  it('sent: refused unless it is asked for as a web-copy update, which is logged', async () => {
    const { id, before } = await sentOnce(990443);
    h.emailStatus = 'sent';
    const refused = await send(id, 'buttondown');
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('web_copy=1');
    expect(h.drafts).toHaveLength(0);
    expect(legOf(id, 'buttondown')).toEqual(before);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const updated = await send(id, 'buttondown', '?web_copy=1');
      expect(updated.status).toBe(200);
      expect(h.drafts).toEqual([expect.objectContaining({ op: 'update', id: (before as { external_id: string }).external_id })]);
      expect(store.listEvents(id).some((e) => /web copy/i.test(e.summary))).toBe(true);
      expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/web copy/i);
    } finally {
      log.mockRestore();
    }
    store.deleteIssue(id);
  });

  it('sent: the refusal records what Buttondown said, so the card offers the web-copy update at once', async () => {
    // WT350 and WT351: verified before the check read the email's status back.
    const { id } = await sentOnce(990447);
    const at = '2026-09-26T15:00:00Z';
    const checks = [{ label: 'Subject', ok: true, detail: 'matches' }];
    store.recordVerify(id, 'buttondown', { status: 'passed', at, checks });
    h.emailStatus = 'sent';
    const refused = await send(id, 'buttondown');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('email_sent');
    // The check's own findings are kept; only what Buttondown said is added.
    expect(store.getIssue(id)!.doc.verify!.buttondown).toEqual({ status: 'passed', at, checks, remote_status: 'sent' });
    store.deleteIssue(id);
  });

  it('sent, never verified: the refusal leaves a record that says the email has gone', async () => {
    const { id } = await sentOnce(990448);
    const doc = store.getIssue(id)!.doc;
    delete doc.verify;
    store.saveIssue(doc);
    h.emailStatus = 'sent';
    expect((await send(id, 'buttondown')).status).toBe(409);
    const v = store.getIssue(id)!.doc.verify!.buttondown!;
    expect(v.remote_status).toBe('sent');
    expect(v.checks).toEqual([expect.objectContaining({ label: 'Status', ok: true })]);
    store.deleteIssue(id);
  });

  for (const status of ['draft', 'scheduled']) {
    it(`${status}: updated as before`, async () => {
      const { id, before } = await sentOnce(status === 'draft' ? 990444 : 990445);
      h.emailStatus = status;
      expect((await send(id, 'buttondown')).status).toBe(200);
      expect(h.drafts).toEqual([expect.objectContaining({ op: 'update', id: (before as { external_id: string }).external_id })]);
      store.deleteIssue(id);
    });
  }

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
});

describe('the website leg merges emails.json as it stands when the commit lands', () => {
  const EMAILS = 'apps/site/_data/emails.json';
  const withAudio = (id: string) => store.recordSend(id, 'podcast', {
    status: 'sent', at: new Date().toISOString(), url: 'https://files.thingelstad.com/a.mp3',
    audio: { audio_url: 'https://files.thingelstad.com/a.mp3' },
  });
  const committedEmails = () => JSON.parse(h.committed.at(-1)!.find((f) => f.path === EMAILS)!.content) as { number: number; [k: string]: unknown }[];

  it('a commit to emails.json while the leg rehosts is kept, not overwritten', async () => {
    const id = issue(990461);
    withAudio(id);
    const gate = hold();
    const calls = h.rehostCalls;
    const sent = send(id, 'website');
    await until(() => h.rehostCalls > calls);
    // Another commit to the site changes WT12's entry meanwhile.
    const emails = JSON.parse(h.siteEmails);
    emails[11].audio_url = 'https://files.thingelstad.com/wt12.mp3';
    h.siteEmails = JSON.stringify(emails);
    gate.open();
    expect((await sent).status).toBe(200);
    const merged = committedEmails();
    expect(merged.find((e) => e.number === 12)!.audio_url).toBe('https://files.thingelstad.com/wt12.mp3');
    expect(merged.find((e) => e.number === 990461)).toBeTruthy();
    expect(merged).toHaveLength(350);
    store.deleteIssue(id);
  });

  it('a lost ref race merges again against the winner, not the copy first read', async () => {
    const id = issue(990462);
    withAudio(id);
    h.raceWinners.push((emails) => { emails[12]!.audio_url = 'https://files.thingelstad.com/wt13.mp3'; });
    expect((await send(id, 'website')).status).toBe(200);
    const merged = committedEmails();
    expect(merged.find((e) => e.number === 13)!.audio_url).toBe('https://files.thingelstad.com/wt13.mp3');
    expect(merged.find((e) => e.number === 990462)).toBeTruthy();
    store.deleteIssue(id);
  });

  it('an index truncated by the time of the commit is refused, and nothing is committed', async () => {
    const id = issue(990463);
    withAudio(id);
    h.raceWinners.push((emails) => { emails.splice(10); });
    const res = await send(id, 'website');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/below the 349/);
    expect(h.committed).toHaveLength(0);
    expect(legOf(id, 'website')?.status).toBe('failed');
    store.deleteIssue(id);
  });
});

describe('the emails.json floor follows the archive', () => {
  const archive = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i + 1, subject: `WT${i + 1}` })));

  it('an index shorter than the last published issue is refused, one that holds it is merged', async () => {
    // WT360 went out: the site's index has held 360 issues since.
    const published = issue(360);
    const doc = store.getIssue(published)!.doc;
    doc.issue.status = 'published';
    store.saveIssue(doc);
    expect(store.lastPublishedNumber()).toBe(360);

    const id = issue(990471);
    store.recordSend(id, 'podcast', { status: 'sent', at: new Date().toISOString(), audio: { audio_url: 'https://files.thingelstad.com/a.mp3' } });
    // Above the old fixed floor of 349, but eleven issues short.
    h.siteEmails = archive(355);
    const refused = await send(id, 'website');
    expect(refused.status).toBe(502);
    expect(refused.body.error).toMatch(/355 entries, below the 360/);
    expect(h.committed).toHaveLength(0);

    h.siteEmails = archive(360);
    expect((await send(id, 'website')).status).toBe(200);
    store.deleteIssue(id);
    store.deleteIssue(published);
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

  it('the website page and index carry its id, not an empty one', async () => {
    const id = issue(990491);
    store.recordSend(id, 'podcast', { status: 'sent', at: new Date().toISOString(), audio: { audio_url: 'https://files.thingelstad.com/a.mp3' } });
    legacy(id);
    expect((await send(id, 'website')).status).toBe(200);
    expect(committedField(/archive\/990491\.md$/)).toContain('buttondown_id: "em-legacy"');
    const entry = JSON.parse(committedField(/emails\.json$/)).find((e: { number: number }) => e.number === 990491);
    expect(entry.id).toBe('em-legacy');
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
