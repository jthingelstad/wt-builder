/**
 * Another Thing's routes, over HTTP, against a throwaway database. GitHub
 * and the mp3 tagger are stubbed: nothing here reaches the network or needs
 * ffmpeg. What is pinned: the numbering, the slug following the title, the
 * outline's stale-tab refusal, the frozen fields once sent (and while
 * sending), a transcript draft never landing over edits, and every send
 * refusal (nothing to send, warnings unconfirmed, a number already taken in
 * the repository) leaving the send state as it found it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { listPaths, putTree, tagged, master, transcribe, verifyEpisode } = vi.hoisted(() => ({
  listPaths: vi.fn(), putTree: vi.fn(), tagged: vi.fn(), master: vi.fn(), transcribe: vi.fn(), verifyEpisode: vi.fn(),
}));

vi.mock('../src/server/podcast/verify.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/podcast/verify.ts')>()),
  verifyEpisode,
}));

vi.mock('../src/server/integrations/github.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/integrations/github.ts')>()),
  listPaths,
  putTree,
}));

vi.mock('../src/server/podcast/master.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/podcast/master.ts')>()),
  tagged,
  master,
}));

vi.mock('../src/server/podcast/transcribe.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/podcast/transcribe.ts')>()),
  transcribe,
}));

const work = mkdtempSync(join(tmpdir(), 'wt-podcast-routes-'));
process.env.WT_BUILDER_DB = join(work, 'podcast.db');
process.env.WT_BUILDER_EPISODE_AUDIO = join(work, 'audio');
mkdirSync(join(work, 'audio'));

const { server } = await import('../src/server/index.ts');
const eps = await import('../src/server/podcast/store.ts');
const { masteredPath } = await import('../src/server/podcast/master.ts');
const { cleanOutline } = await import('../src/shared/podcast/outline.ts');

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
  for (const e of eps.listEpisodes()) eps.deleteEpisode(e.id);
  listPaths.mockReset().mockResolvedValue(['content/episodes/001-how-do-you-start-a-podcast.md', 'uploads/2025/another-thing-1.mp3']);
  putTree.mockReset().mockResolvedValue({ sha: 'abc123', changed: ['x'], unchanged: 0, committed: true });
  tagged.mockReset().mockResolvedValue(Buffer.from('ID3 tagged mp3'));
  master.mockReset();
  transcribe.mockReset();
  verifyEpisode.mockReset().mockResolvedValue({ status: 'passed', at: new Date().toISOString(), checks: [] });
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

/** An episode with everything a send needs: a date, mastered audio on disk, notes and a transcript. */
async function ready(title = 'Ready to go') {
  const { json } = await call('POST', '/episodes', { title });
  const id = json.episode.episode.id as string;
  const row = eps.getEpisode(id)!;
  row.doc.episode.date = '2026-10-11T19:30:00-05:00';
  row.doc.episode.summary = 'A summary.';
  row.doc.show_notes = 'Notes.';
  row.doc.transcript = 'Hello.';
  row.doc.audio = { source_filename: 'take.wav', duration_seconds: 600, bytes: 14, mastered_at: '2026-10-11T19:40:00-05:00' };
  eps.saveEpisode(row.doc);
  writeFileSync(masteredPath(id), 'mastered mp3');
  return id;
}

describe('episodes', () => {
  it('number from the last published episode, and refuse a number already held', async () => {
    const first = await call('POST', '/episodes', {});
    expect(first.status).toBe(200);
    expect(first.json.episode.episode.id).toBe('at2');
    const second = await call('POST', '/episodes', { title: 'Next' });
    expect(second.json.episode.episode.number).toBe(3);

    const list = await call('GET', '/episodes');
    expect(list.json.episodes.map((e: { id: string }) => e.id)).toEqual(['at3', 'at2']);
    expect(list.json.next_number).toBe(4);

    const clash = await call('PATCH', '/episodes/at3', { number: 2 });
    expect(clash.status).toBe(409);
  });

  it('the slug follows the title until it is set by hand', async () => {
    await call('POST', '/episodes', {});
    let r = await call('PATCH', '/episodes/at2', { title: 'Why a podcast at all' });
    expect(r.json.episode.episode.slug).toBe('why-a-podcast-at-all');
    r = await call('PATCH', '/episodes/at2', { slug: 'why-podcast' });
    r = await call('PATCH', '/episodes/at2', { title: 'A different title' });
    expect(r.json.episode.episode.slug).toBe('why-podcast');
  });

  it('a date needs its offset', async () => {
    await call('POST', '/episodes', {});
    expect((await call('PATCH', '/episodes/at2', { date: '2026-10-11' })).status).toBe(400);
    expect((await call('PATCH', '/episodes/at2', { date: '2026-10-11T19:00:00-05:00' })).status).toBe(200);
  });

  it('a missing episode is a 404', async () => {
    expect((await call('GET', '/episodes/at99')).status).toBe(404);
  });
});

describe('the outline', () => {
  it('saves whole, logs what changed, and refuses a stale tab', async () => {
    const created = await call('POST', '/episodes', {});
    const segments = cleanOutline([{ title: 'Open', cards: [{ claim: 'Hello', blocks: [] }] }]);
    const saved = await call('PUT', '/episodes/at2/outline', { segments, base: created.json.outline_version });
    expect(saved.status).toBe(200);
    expect(saved.json.episode.segments[0].title).toBe('Open');
    expect(saved.json.outline_version).not.toBe(created.json.outline_version);

    const stale = await call('PUT', '/episodes/at2/outline', { segments: [], base: created.json.outline_version });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('outline-moved');
    expect(eps.getEpisode('at2')!.doc.segments).toHaveLength(1);

    const events = await call('GET', '/episodes/at2/events');
    expect(events.json.events.some((e: { kind: string }) => e.kind === 'structure')).toBe(true);
  });
});

describe('recording', () => {
  it('keeps the session and the take notes, and logs them', async () => {
    await call('POST', '/episodes', {});
    const session = { started_at: '2026-10-11T18:00:00.000Z', splits: [], ended: 312 };
    const r = await call('PUT', '/episodes/at2/session', { session });
    expect(r.status).toBe(200);
    expect(r.json.episode.session.ended).toBe(312);

    await call('POST', '/episodes/at2/notes', { text: 'Redo the intro', elapsed: 42 });
    expect(eps.getEpisode('at2')!.doc.notes.map((n) => n.text)).toEqual(['Redo the intro']);
    await call('DELETE', '/episodes/at2/notes/0');
    expect(eps.getEpisode('at2')!.doc.notes).toEqual([]);

    const kinds = (await call('GET', '/episodes/at2/events')).json.events.map((e: { kind: string }) => e.kind);
    expect(kinds.filter((k: string) => k === 'recording').length).toBeGreaterThanOrEqual(3);
  });

  it('streams a dropped recording to the master, stamps the date once, and logs both', async () => {
    await call('POST', '/episodes', {});
    let received = '';
    master.mockImplementation(async (_doc: unknown, src: string) => {
      received = (await import('node:fs')).readFileSync(src, 'utf8');
      return { path: masteredPath('at2'), bytes: 4321, durationSeconds: 1800 };
    });
    const res = await fetch(`${base}/api/episodes/at2/audio?name=${encodeURIComponent('take 3 (final).wav')}`, {
      method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: 'RIFF pretend wav bytes',
    });
    expect(res.status).toBe(200);
    expect(received).toBe('RIFF pretend wav bytes');
    const doc = eps.getEpisode('at2')!.doc;
    expect(doc.audio).toMatchObject({ source_filename: 'take 3 final.wav', duration_seconds: 1800, bytes: 4321 });
    expect(doc.episode.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[56]:00$/);

    // A re-master keeps the date: the GUID is made from it.
    const date = doc.episode.date;
    await fetch(`${base}/api/episodes/at2/audio?name=again.wav`, { method: 'POST', body: 'more' });
    expect(eps.getEpisode('at2')!.doc.episode.date).toBe(date);

    const summaries = (await call('GET', '/episodes/at2/events')).json.events.map((e: { summary: string }) => e.summary);
    expect(summaries.some((t: string) => t.startsWith('Recording dropped — take 3 final.wav'))).toBe(true);
    expect(summaries.some((t: string) => t.startsWith('Mastered — '))).toBe(true);
  });

  it('a failed master is said and logged, and leaves no audio', async () => {
    await call('POST', '/episodes', {});
    master.mockRejectedValue(new Error('ffmpeg exited 1'));
    const res = await fetch(`${base}/api/episodes/at2/audio?name=x.wav`, { method: 'POST', body: 'bytes' });
    expect(res.status).toBe(500);
    expect(eps.getEpisode('at2')!.doc.audio).toBeUndefined();
  });

  it('no audio to play is a 404', async () => {
    await call('POST', '/episodes', {});
    expect((await call('GET', '/episodes/at2/audio')).status).toBe(404);
  });
});

describe('the send', () => {
  it('refuses an episode with nothing to send, claiming nothing', async () => {
    await call('POST', '/episodes', { title: 'Empty' });
    const r = await call('POST', '/episodes/at2/send');
    expect(r.status).toBe(422);
    expect(eps.getEpisode('at2')!.doc.sends?.another).toBeUndefined();
    expect(listPaths).not.toHaveBeenCalled();
  });

  it('says the warnings and sends only when told to', async () => {
    const id = await ready();
    const row = eps.getEpisode(id)!;
    row.doc.transcript = '';
    eps.saveEpisode(row.doc);

    const warned = await call('POST', `/episodes/${id}/send`);
    expect(warned.status).toBe(409);
    expect(warned.json.code).toBe('warnings');
    expect(warned.text).toContain('No transcript');
    expect(putTree).not.toHaveBeenCalled();

    const forced = await call('POST', `/episodes/${id}/send?force=1`);
    expect(forced.status).toBe(200);
    expect(putTree).toHaveBeenCalledTimes(1);
  });

  it('commits the page, the transcript and the tagged mp3 as one, and the episode is published', async () => {
    const id = await ready();
    const r = await call('POST', `/episodes/${id}/send`);
    expect(r.status).toBe(200);
    const [files, message, target] = putTree.mock.calls[0]!;
    expect((files as { path: string }[]).map((f) => f.path)).toEqual([
      'content/episodes/002-ready-to-go.md',
      'content/episodes/002-ready-to-go.txt',
      'uploads/2026/another-thing-2.mp3',
    ]);
    expect(Buffer.isBuffer((files as { content: unknown }[])[2]!.content)).toBe(true);
    expect(message).toContain('Another Thing 2: Ready to go');
    expect(target).toEqual({ repo: 'jthingelstad/another.thingelstad.com', branch: 'main' });

    const doc = eps.getEpisode(id)!.doc;
    expect(doc.episode.status).toBe('published');
    expect(doc.sends?.another?.status).toBe('sent');
    // The first check is on the record, so a restart resumes it.
    expect(doc.verify?.another).toMatchObject({ status: 'waiting', checks: [] });
    expect(Date.parse(doc.verify!.another!.recheck_at!)).toBeGreaterThan(Date.now());
    // 7:30 PM Central is the next UTC day: the permalink says the 12th.
    expect(doc.sends?.another?.url).toBe('https://another.thingelstad.com/2026/10/12/ready-to-go.html');

    // Sent, the fields that make its URL and GUID stay put; it is not deleted.
    const slug = await call('PATCH', `/episodes/${id}`, { slug: 'another-slug' });
    expect(slug.status).toBe(409);
    expect(slug.json.code).toBe('frozen');
    expect((await call('PATCH', `/episodes/${id}`, { title: 'A better title' })).json.episode.episode.slug).toBe('ready-to-go');
    expect((await call('DELETE', `/episodes/${id}`)).status).toBe(409);
  });

  it('a re-send without the transcript takes the old one out of the repository', async () => {
    const id = await ready();
    expect((await call('POST', `/episodes/${id}/send`)).status).toBe(200);
    expect(putTree.mock.calls[0]![3]).toEqual([]);

    await call('PATCH', `/episodes/${id}`, { transcript: '' });
    listPaths.mockResolvedValue(['content/episodes/002-ready-to-go.md', 'content/episodes/002-ready-to-go.txt', 'uploads/2026/another-thing-2.mp3']);
    expect((await call('POST', `/episodes/${id}/send?force=1`)).status).toBe(200);
    const [files, , , remove] = putTree.mock.calls[1]!;
    expect((files as { path: string }[]).map((f) => f.path)).not.toContain('content/episodes/002-ready-to-go.txt');
    expect(remove).toEqual(['content/episodes/002-ready-to-go.txt']);
  });

  it('a first send that landed but was never recorded is reconciled on the retry, not refused', async () => {
    const id = await ready();
    putTree.mockRejectedValueOnce(new Error('socket hang up')); // the commit landed; the answer was lost
    expect((await call('POST', `/episodes/${id}/send`)).status).toBe(502);
    listPaths.mockResolvedValue(['content/episodes/002-ready-to-go.md', 'content/episodes/002-ready-to-go.txt', 'uploads/2026/another-thing-2.mp3']);
    putTree.mockResolvedValueOnce({ sha: 'abc123', changed: [], unchanged: 3, committed: false });
    const retry = await call('POST', `/episodes/${id}/send`);
    expect(retry.status).toBe(200);
    expect(eps.getEpisode(id)!.doc.sends?.another?.status).toBe('sent');
    expect((await call('PATCH', `/episodes/${id}`, { slug: 'moved' })).json.code).toBe('frozen');
  });

  it('after a failed send, the identity and the episode stay until the repository says it did not land', async () => {
    const id = await ready();
    putTree.mockRejectedValueOnce(new Error('socket hang up'));
    expect((await call('POST', `/episodes/${id}/send`)).status).toBe(502);

    // It landed: the page is there. No new slug, no delete.
    listPaths.mockResolvedValue(['content/episodes/002-ready-to-go.md']);
    const moved = await call('PATCH', `/episodes/${id}`, { slug: 'moved' });
    expect(moved.status).toBe(409);
    expect(moved.json.code).toBe('landed');
    expect((await call('DELETE', `/episodes/${id}`)).json.code).toBe('landed');
    // Fields that are not its identity still edit, and a new title no longer takes the slug with it.
    expect((await call('PATCH', `/episodes/${id}`, { summary: 'Still editable.' })).status).toBe(200);
    expect((await call('PATCH', `/episodes/${id}`, { title: 'A new title' })).json.episode.episode.slug).toBe('ready-to-go');

    // GitHub cannot be read: nothing is assumed either way.
    listPaths.mockRejectedValueOnce(new Error('GitHub 503'));
    expect((await call('PATCH', `/episodes/${id}`, { slug: 'moved' })).status).toBe(502);

    // It did not land: the identity is the episode's to change again.
    listPaths.mockResolvedValue([]);
    expect((await call('PATCH', `/episodes/${id}`, { slug: 'moved' })).json.episode.episode.slug).toBe('moved');
    expect((await call('DELETE', `/episodes/${id}`)).status).toBe(200);
  });

  it('refuses a number already in the repository, and leaves the send state as it was', async () => {
    const id = await ready();
    listPaths.mockResolvedValue(['content/episodes/002-published-by-hand.md']);
    const r = await call('POST', `/episodes/${id}/send`);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('number-taken');
    expect(r.text).toContain('002-published-by-hand.md');
    expect(putTree).not.toHaveBeenCalled();
    expect(eps.getEpisode(id)!.doc.sends?.another?.status ?? 'none').toBe('none');
  });

  it('a failed commit is a failed send, said, and can be sent again', async () => {
    const id = await ready();
    putTree.mockRejectedValueOnce(new Error('GitHub /git/blobs failed: 500'));
    const r = await call('POST', `/episodes/${id}/send`);
    expect(r.status).toBe(502);
    expect(eps.getEpisode(id)!.doc.sends?.another?.status).toBe('failed');
    expect((await call('POST', `/episodes/${id}/send`)).status).toBe(200);
  });

  it('refuses when the mastered file is gone from disk', async () => {
    const id = await ready();
    rmSync(masteredPath(id));
    const r = await call('POST', `/episodes/${id}/send`);
    expect(r.status).toBe(409);
    expect(r.text).toContain('not on disk');
  });

  it('while the send is out, the number, slug and date stay as they are', async () => {
    const id = await ready();
    let land!: (v: unknown) => void;
    putTree.mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
    const sending = call('POST', `/episodes/${id}/send`);
    await vi.waitFor(() => expect(putTree).toHaveBeenCalled());

    const moved = await call('PATCH', `/episodes/${id}`, { slug: 'another-slug' });
    expect(moved.status).toBe(409);
    expect(moved.json.code).toBe('sending');
    // The title still edits, and the slug does not follow it out from under the send.
    const retitled = await call('PATCH', `/episodes/${id}`, { title: 'Retitled' });
    expect(retitled.json.episode.episode.slug).toBe('ready-to-go');

    land({ sha: 'abc123', changed: ['x'], unchanged: 0, committed: true });
    expect((await sending).status).toBe(200);
    expect(eps.getEpisode(id)!.doc.sends?.another?.url).toBe('https://another.thingelstad.com/2026/10/12/ready-to-go.html');
  });
});

describe('the transcript draft', () => {
  it('replaces the transcript it was asked to replace', async () => {
    const id = await ready();
    transcribe.mockResolvedValue('A fresh draft.');
    const r = await call('POST', `/episodes/${id}/transcribe`, { replace: true });
    expect(r.status).toBe(200);
    expect(eps.getEpisode(id)!.doc.transcript).toBe('A fresh draft.');
  });

  it('never lands over an edit made while it was being drafted', async () => {
    const id = await ready();
    transcribe.mockImplementation(async () => {
      const row = eps.getEpisode(id)!;
      row.doc.transcript = 'Typed meanwhile.';
      eps.saveEpisode(row.doc);
      return 'A fresh draft.';
    });
    const r = await call('POST', `/episodes/${id}/transcribe`, { replace: true });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('transcript-moved');
    expect(eps.getEpisode(id)!.doc.transcript).toBe('Typed meanwhile.');
    const events = (await call('GET', `/episodes/${id}/events`)).json.events.map((e: { summary: string }) => e.summary);
    expect(events.some((t: string) => t.startsWith('Transcript draft set aside'))).toBe(true);
  });
});

describe('one thing at a time on the audio', () => {
  it('while a new recording is mastering, nothing sends or transcribes from the old one', async () => {
    const id = await ready();
    let done!: () => void;
    master.mockImplementation(() => new Promise((resolve) => {
      done = () => resolve({ path: masteredPath(id), bytes: 4321, durationSeconds: 1800 });
    }));
    const upload = fetch(`${base}/api/episodes/${id}/audio?name=new.wav`, { method: 'POST', body: 'RIFF new take' });
    await vi.waitFor(() => expect(master).toHaveBeenCalled());

    const send = await call('POST', `/episodes/${id}/send`);
    expect(send.status).toBe(409);
    expect(send.text).toContain('being mastered');
    expect(putTree).not.toHaveBeenCalled();
    expect(eps.getEpisode(id)!.doc.sends?.another?.status ?? 'none').toBe('none');
    expect((await call('POST', `/episodes/${id}/transcribe`, { replace: true })).status).toBe(409);
    expect(transcribe).not.toHaveBeenCalled();

    done();
    expect((await upload).status).toBe(200);
  });

  it('while a transcript is drafted, nothing sends; while a send is out, nothing drafts', async () => {
    const id = await ready();
    let done!: () => void;
    transcribe.mockImplementation(() => new Promise((resolve) => { done = () => resolve('The draft.'); }));
    const drafting = call('POST', `/episodes/${id}/transcribe`, { replace: true });
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalled());
    const send = await call('POST', `/episodes/${id}/send`);
    expect(send.status).toBe(409);
    expect(send.text).toContain('being drafted');
    expect(putTree).not.toHaveBeenCalled();
    done();
    expect((await drafting).status).toBe(200);

    let land!: (v: unknown) => void;
    putTree.mockReturnValueOnce(new Promise((resolve) => { land = resolve; }));
    const sending = call('POST', `/episodes/${id}/send`);
    await vi.waitFor(() => expect(putTree).toHaveBeenCalled());
    expect((await call('POST', `/episodes/${id}/transcribe`, { replace: true })).status).toBe(409);
    expect(transcribe).toHaveBeenCalledTimes(1);
    land({ sha: 'abc123', changed: ['x'], unchanged: 0, committed: true });
    expect((await sending).status).toBe(200);
  });

  it('while a transcript is drafted, a new recording waits', async () => {
    const id = await ready();
    let done!: () => void;
    transcribe.mockImplementation(() => new Promise((resolve) => { done = () => resolve('The draft.'); }));
    const drafting = call('POST', `/episodes/${id}/transcribe`, { replace: true });
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalled());

    const upload = await fetch(`${base}/api/episodes/${id}/audio?name=new.wav`, { method: 'POST', body: 'RIFF new take' });
    expect(upload.status).toBe(409);
    expect(master).not.toHaveBeenCalled();

    done();
    expect((await drafting).status).toBe(200);
  });
});

describe('after a new master', () => {
  it('a transcript of the old take is flagged, warns at the send, and clears when touched', async () => {
    const id = await ready();
    master.mockResolvedValue({ path: masteredPath(id), bytes: 4321, durationSeconds: 1800 });
    expect((await fetch(`${base}/api/episodes/${id}/audio?name=new.wav`, { method: 'POST', body: 'RIFF new take' })).status).toBe(200);
    expect(eps.getEpisode(id)!.doc.transcript_stale).toBe(true);
    const send = await call('POST', `/episodes/${id}/send`);
    expect(send.status).toBe(409);
    expect(send.json.code).toBe('warnings');
    expect(send.text).toContain('mastered again');

    await call('PATCH', `/episodes/${id}`, { transcript: 'Hello, read against the new take.' });
    expect(eps.getEpisode(id)!.doc.transcript_stale).toBeUndefined();
  });

  it('a first master never flags a transcript', async () => {
    await call('POST', '/episodes', {});
    await call('PATCH', '/episodes/at2', { transcript: 'Written first.' });
    master.mockResolvedValue({ path: masteredPath('at2'), bytes: 1, durationSeconds: 60 });
    await fetch(`${base}/api/episodes/at2/audio?name=first.wav`, { method: 'POST', body: 'RIFF' });
    expect(eps.getEpisode('at2')!.doc.transcript_stale).toBeUndefined();
  });
});

describe('the check after a send', () => {
  it("a look at the last send that comes back after a re-send never stands for the new one", async () => {
    const id = await ready();
    expect((await call('POST', `/episodes/${id}/send`)).status).toBe(200);
    let found!: () => void;
    verifyEpisode.mockReturnValueOnce(new Promise((resolve) => {
      found = () => resolve({ status: 'passed', at: new Date().toISOString(), checks: [] });
    }));
    const looking = call('POST', `/episodes/${id}/verify`);
    await vi.waitFor(() => expect(verifyEpisode).toHaveBeenCalled());

    await new Promise((r) => setTimeout(r, 5)); // a later send stamp
    expect((await call('POST', `/episodes/${id}/send`)).status).toBe(200);
    found();
    expect((await looking).status).toBe(200);
    expect(eps.getEpisode(id)!.doc.verify?.another?.status).toBe('waiting');
  });
});

describe('two checks of one send', () => {
  it('an older check finishing last never replaces a newer answer', async () => {
    const id = await ready();
    expect((await call('POST', `/episodes/${id}/send`)).status).toBe(200);
    let timedOut!: () => void;
    verifyEpisode.mockReturnValueOnce(new Promise((resolve) => {
      timedOut = () => resolve({ status: 'error', at: new Date().toISOString(), checks: [], error: 'timed out' });
    }));
    const older = call('POST', `/episodes/${id}/verify`);
    await vi.waitFor(() => expect(verifyEpisode).toHaveBeenCalledTimes(1));
    expect((await call('POST', `/episodes/${id}/verify`)).status).toBe(200);
    expect(eps.getEpisode(id)!.doc.verify?.another?.status).toBe('passed');

    timedOut();
    await older;
    expect(eps.getEpisode(id)!.doc.verify?.another?.status).toBe('passed');
  });
});

