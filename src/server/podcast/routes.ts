/**
 * Another Thing's routes: /api/episodes and everything under it.
 *
 * A second product in the same service (docs/decisions.md, 2026-10-11). It
 * borrows the service's machinery and keeps its rules, restated here where
 * they apply:
 * - a handler that awaits (mastering, transcription, the send) applies its
 *   result to a fresh read, never to the copy it started with (`fresh`);
 * - a send is claimed synchronously before its first await, in process and
 *   on the record, so a second click finds it taken (`claim`);
 * - a `sending` found at boot was cut off by the restart and becomes
 *   `failed` (failInterruptedEpisodeSends);
 * - every save narrates itself in the shared event log, in its transaction.
 *
 * Nothing here reads or writes an issue.
 */

import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

import { took, type EventInput } from '../../shared/events.ts';
import {
  audioRepoPath, centralIso, episodePrefix, episodeStem, packageTextFiles, permalink, SITE, slugFromTitle, validate,
} from '../../shared/podcast/contract.ts';
import { cleanOutline, outlineEvents } from '../../shared/podcast/outline.ts';
import { plannedTotal } from '../../shared/podcast/pace.ts';
import { episodeReadiness } from '../../shared/podcast/readiness.ts';
import { episodeTiming } from '../../shared/podcast/timing.ts';
import { EPISODE_SCHEMA_VERSION, type EpisodeDoc, type RecordingSession, type TakeNote } from '../../shared/podcast/types.ts';
import { isOut, lastSent } from '../../shared/sends.ts';
import type { SendState } from '../../shared/types.ts';
import { config, credentials } from '../config.ts';
import { allEvents, listEvents, record } from '../db.ts';
import { ANSWERED, HttpError, type Route } from '../http.ts';
import * as github from '../integrations/github.ts';
import { log } from '../log.ts';
import { durationSeconds, master, masteredPath, tagged } from './master.ts';
import * as eps from './store.ts';
import { transcribe } from './transcribe.ts';
import { RECHECK_MS, verifyEpisode } from './verify.ts';

github.useToken(config.anotherRepo, () => credentials.anotherGithubToken, 'ANOTHER_GITHUB_PAT_TOKEN');
const target = { repo: config.anotherRepo, branch: config.anotherBranch };

/** A dropped recording, before mastering: an hour of 24-bit stereo WAV is ~1 GB. */
const MAX_UPLOAD_BYTES = 2_000_000_000;

/** The site's build takes about this long to put a sent episode on the page and in the feed. */
const FIRST_LOOK_MS = 60_000;

// ── in-process state: what is running now ────────────────────────────────

const mastering = new Set<string>();
const transcribing = new Set<string>();
const sending = new Set<string>();
const rechecks = new Map<string, NodeJS.Timeout>();
/** The latest check started per episode: an older one finishing later is dropped. */
const looks = new Map<string, number>();

function requireEpisode(id: string): EpisodeDoc {
  const row = eps.getEpisode(id);
  if (!row) throw new HttpError(404, `no episode ${id}`);
  return row.doc;
}

const isSent = (doc: EpisodeDoc) => Boolean(lastSent(doc.sends?.another));

/** A short hash of the outline, so a save from a stale editor is refused instead of winning. */
export function outlineVersion(doc: EpisodeDoc): string {
  return createHash('sha1').update(JSON.stringify(doc.segments)).digest('hex').slice(0, 12);
}

/** The episode as the page wants it: the document and everything derived from it. */
function view(doc: EpisodeDoc) {
  const id = doc.episode.id;
  return {
    episode: doc,
    outline_version: outlineVersion(doc),
    readiness: episodeReadiness(doc),
    problems: validate(doc),
    timing: episodeTiming(allEvents(id)),
    busy: { mastering: mastering.has(id), transcribing: transcribing.has(id), sending: sending.has(id) },
    audio_on_disk: existsSync(masteredPath(id)),
    ...(doc.episode.date ? { url: `${SITE}${permalink(doc.episode.date, doc.episode.slug)}` } : {}),
  };
}

function saved(doc: EpisodeDoc, events: EventInput[] = []) {
  return view(eps.saveEpisode(doc, events).doc);
}

/**
 * Re-read the episode and apply a synchronous change to that, then save:
 * savedFresh's rule (src/server/index.ts). Node runs this without
 * yielding, so nothing lands between the read and the save.
 */
function fresh(id: string, change: (doc: EpisodeDoc) => EpisodeDoc | void, events: EventInput[] | ((doc: EpisodeDoc) => EventInput[]) = []) {
  const doc = requireEpisode(id);
  const next = change(doc) ?? doc;
  return saved(next, typeof events === 'function' ? events(next) : events);
}

function summary(doc: EpisodeDoc) {
  const sent = lastSent(doc.sends?.another);
  return {
    id: doc.episode.id,
    number: doc.episode.number,
    title: doc.episode.title,
    status: doc.episode.status,
    date: doc.episode.date,
    segments: doc.segments.length,
    planned_seconds: plannedTotal(doc.segments),
    audio_seconds: doc.audio?.duration_seconds,
    readiness: episodeReadiness(doc),
    sent_at: sent?.at,
    send: doc.sends?.another?.status,
  };
}

// ── the send ─────────────────────────────────────────────────────────────

/** A leg turned down on what the repository said, after its state was set back. */
class Refusal extends HttpError {}

function guardInFlight(doc: EpisodeDoc): void {
  const id = doc.episode.id;
  if (sending.has(id)) throw new HttpError(409, 'the send is already in flight');
  const current = doc.sends?.another;
  if (isOut(current)) throw new HttpError(409, `the send is already in flight since ${current!.at}`);
}

/**
 * What the repository already holds for this number, beside this episode's
 * own files: another slug's page under `content/episodes/00N-`, or the
 * number's mp3 before this episode has ever sent it. Either means the
 * number is taken (episode 1 was published by hand), and sending would put
 * two episodes behind one number.
 */
export function clashes(doc: EpisodeDoc, paths: string[], audioPath: string): string[] {
  const own = `content/episodes/${episodeStem(doc.episode.number, doc.episode.slug)}.`;
  const prefix = episodePrefix(doc.episode.number);
  const out = paths.filter((p) => p.startsWith(prefix) && !p.startsWith(own));
  if (!isSent(doc) && paths.includes(audioPath)) out.push(audioPath);
  return out;
}

async function send(id: string, force: boolean) {
  const doc = requireEpisode(id);
  guardInFlight(doc);
  // A new master replaces the mp3 on disk: the send would package this
  // document and could read either file.
  if (mastering.has(id)) throw new HttpError(409, 'a new recording is being mastered — send when it is done');
  // A draft landing after the package was made would leave the page saying
  // what was never sent.
  if (transcribing.has(id)) throw new HttpError(409, 'the transcript is being drafted — send when it is done');
  const blocking = validate(doc).filter((p) => p.severity === 'blocks');
  if (blocking.length) throw new HttpError(422, blocking.map((p) => p.text).join(' '), 'invalid');
  if (!existsSync(masteredPath(id))) throw new HttpError(409, 'the mastered mp3 is not on disk — drop the recording again');
  const warnings = validate(doc).filter((p) => p.severity === 'warns');
  if (warnings.length && !force) {
    throw new HttpError(409, warnings.map((p) => p.text).join(' '), 'warnings');
  }

  // Claimed before the first await: a second click finds it taken.
  const previous = doc.sends?.another;
  eps.recordEpisodeSend(id, { status: 'sending', at: new Date().toISOString() });
  sending.add(id);
  record(id, {
    kind: 'send', actor: 'jamie', anchor: 'send',
    summary: `Send started — another.thingelstad.com${force && warnings.length ? ' (past the warnings)' : ''}`,
    data: { dest: 'another', action: 'start', ...(force && warnings.length ? { override: warnings.map((w) => w.text) } : {}) },
  });
  const started = Date.now();
  try {
    const e = doc.episode;
    const audioPath = audioRepoPath(e.number, e.date!);
    const paths = await github.listPaths('', target);
    const taken = clashes(doc, paths, audioPath);
    if (taken.length) {
      eps.recordEpisodeSend(id, previous ?? { status: 'none' });
      throw new Refusal(409, `episode ${e.number} is already in the repository (${taken.join(', ')}) — renumber this one before sending`, 'number-taken');
    }

    const mp3 = await tagged(doc);
    const text = packageTextFiles(doc);
    const files = [...text, { path: audioPath, content: mp3 }];
    // This episode's own files the package no longer has (a transcript
    // cleared since the last send) go in the same commit.
    const own = `content/episodes/${episodeStem(e.number, e.slug)}.`;
    const gone = paths.filter((p) => p.startsWith(own) && !text.some((f) => f.path === p));
    const pushed = await github.putTree(files, `Another Thing ${e.number}: ${e.title}\n\nSent from WT Builder.`, target, gone);
    const ms = Date.now() - started;
    const url = `${SITE}${permalink(e.date!, e.slug)}`;
    eps.recordEpisodeSend(id, {
      status: 'sent', at: new Date().toISOString(), external_id: pushed.sha, url,
      audio: { path: audioPath, bytes: mp3.length, duration_seconds: doc.audio?.duration_seconds },
    });
    record(id, {
      kind: 'send', actor: 'wt-builder', anchor: 'send',
      summary: pushed.committed
        ? `Send finished — another.thingelstad.com: ${pushed.changed.length} file${pushed.changed.length === 1 ? '' : 's'} committed, ${took(ms)}`
        : `Send finished — another.thingelstad.com already had this episode exactly`,
      data: { dest: 'another', outcome: 'sent', ms, sha: pushed.sha, changed: pushed.changed },
    });
    log.info(`[episode] ${id} sent: ${pushed.sha} ${pushed.changed.join(', ') || '(unchanged)'}`);
    // The first look is on the record, not only in a timer: a restart in the
    // next minute resumes it, and a re-send never shows the last send's pass.
    const firstLook = new Date(Date.now() + FIRST_LOOK_MS).toISOString();
    eps.recordEpisodeVerify(id, { status: 'waiting', at: new Date().toISOString(), checks: [], recheck_at: firstLook });
    scheduleRecheck(id, FIRST_LOOK_MS);
    return view(requireEpisode(id));
  } catch (err) {
    if (err instanceof Refusal) throw err;
    const ms = Date.now() - started;
    eps.recordEpisodeSend(id, { status: 'failed', at: new Date().toISOString(), error: (err as Error).message });
    record(id, {
      kind: 'send', actor: 'wt-builder', anchor: 'send',
      summary: `Send failed — another.thingelstad.com: ${(err as Error).message}`,
      data: { dest: 'another', outcome: 'failed', ms },
    });
    log.error(`[episode] ${id} send failed: ${(err as Error).message}`);
    throw new HttpError(502, (err as Error).message);
  } finally {
    sending.delete(id);
  }
}

/** Sends run in-process, so a `sending` found at boot was cut off by the restart. */
export function failInterruptedEpisodeSends(): void {
  for (const row of eps.listEpisodes()) {
    if (row.doc.sends?.another?.status !== 'sending') continue;
    eps.recordEpisodeSend(row.id, { status: 'failed', at: new Date().toISOString(), error: 'interrupted by a restart' });
    record(row.id, {
      kind: 'send', actor: 'wt-builder', anchor: 'send',
      summary: 'Send failed — another.thingelstad.com: interrupted by a restart',
      data: { dest: 'another', outcome: 'interrupted' },
    });
  }
}

// ── verification ─────────────────────────────────────────────────────────

async function runVerify(id: string, asked: boolean) {
  const doc = requireEpisode(id);
  const before = doc.verify?.another?.status;
  const send = doc.sends?.another?.at;
  const look = (looks.get(id) ?? 0) + 1;
  looks.set(id, look);
  const v = await verifyEpisode(doc);
  // A re-send landed while this looked (what it found is the last send's),
  // or a later check started meanwhile (its answer is the newer): the
  // record keeps what stands.
  const now = requireEpisode(id);
  if (now.sends?.another?.at !== send || looks.get(id) !== look) return now.verify?.another ?? v;
  const moved = before !== v.status;
  const events: EventInput[] = moved || asked || v.status === 'error'
    ? [{
        kind: 'verify', actor: 'wt-builder', anchor: 'send',
        summary: `Checked another.thingelstad.com — ${v.status}${v.error ? `: ${v.error}` : ''}`,
        data: { dest: 'another', from: before ?? null, to: v.status },
      }]
    : [];
  eps.recordEpisodeVerify(id, v, events);
  if (v.status === 'waiting') scheduleRecheck(id, RECHECK_MS);
  return v;
}

function scheduleRecheck(id: string, ms: number): void {
  clearTimeout(rechecks.get(id));
  rechecks.set(id, setTimeout(() => {
    rechecks.delete(id);
    runVerify(id, false).catch((err) => log.warn(`[episode] ${id} re-check failed: ${(err as Error).message}`));
  }, ms).unref());
}

/** A `waiting` check left by a restart looks again on its own. */
export function resumeEpisodeRechecks(): void {
  for (const row of eps.listEpisodes()) {
    const v = row.doc.verify?.another;
    if (v?.status !== 'waiting') continue;
    const due = Date.parse(v.recheck_at ?? '') - Date.now();
    scheduleRecheck(row.id, Number.isFinite(due) ? Math.max(5_000, due) : 5_000);
  }
}

// ── settings ─────────────────────────────────────────────────────────────

/** Fields a sent episode keeps for good: they make its URL, its GUID and its file names. */
const FROZEN = ['number', 'slug', 'date'] as const;

function applySettings(doc: EpisodeDoc, body: Record<string, unknown>): EventInput[] {
  const e = doc.episode;
  const events: EventInput[] = [];
  const sent = isSent(doc);
  // A send packages the episode before its first await and commits it after
  // several: the identity it packaged must still be the episode's when it
  // lands, or the repository holds one URL and the record another.
  const going = sending.has(e.id) || isOut(doc.sends?.another);

  for (const key of FROZEN) {
    if (body[key] === undefined || body[key] === e[key]) continue;
    if (sent) throw new HttpError(409, `the episode has been sent: its ${key} makes its URL and GUID, and stays as it is`, 'frozen');
    if (going) throw new HttpError(409, `the episode is being sent: its ${key} is what is going out — wait for the send`, 'sending');
  }

  if (typeof body.number === 'number' && body.number !== e.number) {
    if (!Number.isInteger(body.number) || body.number < 1) throw new HttpError(400, 'the number must be a positive whole number');
    const holder = eps.getEpisodeByNumber(body.number);
    if (holder && holder.id !== e.id) throw new HttpError(409, `episode ${body.number} is ${holder.id} already`);
    events.push({ kind: 'settings', anchor: 'episode', summary: `Number ${e.number} → ${body.number}`, data: { field: 'number' } });
    e.number = body.number;
  }
  if (typeof body.title === 'string' && body.title !== e.title) {
    // The slug follows the title until it is set by hand or the episode is sent.
    if (!sent && !going && body.slug === undefined && e.slug === slugFromTitle(e.title)) e.slug = slugFromTitle(body.title);
    e.title = body.title.slice(0, 300);
    events.push({ kind: 'settings', anchor: 'episode', summary: `Title — ${e.title || '(none)'}`, data: { field: 'title' } });
  }
  if (typeof body.slug === 'string' && body.slug !== e.slug) {
    e.slug = body.slug.trim().toLowerCase();
    events.push({ kind: 'settings', anchor: 'episode', summary: `Slug — ${e.slug}`, data: { field: 'slug' } });
  }
  if (typeof body.date === 'string' && body.date !== e.date) {
    if (Number.isNaN(Date.parse(body.date)) || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(body.date)) {
      throw new HttpError(400, 'the date needs a time and an offset, like 2026-10-11T19:00:00-05:00');
    }
    e.date = body.date;
    events.push({ kind: 'settings', anchor: 'episode', summary: `Date — ${e.date}`, data: { field: 'date' } });
  }
  if (typeof body.summary === 'string' && body.summary !== e.summary) {
    e.summary = body.summary.slice(0, 1000);
    events.push({ kind: 'edit', anchor: 'summary', summary: 'Edited the summary', data: { field: 'summary' } });
  }
  if (typeof body.explicit === 'boolean' && body.explicit !== Boolean(e.explicit)) {
    e.explicit = body.explicit || undefined;
    events.push({ kind: 'settings', anchor: 'episode', summary: body.explicit ? 'Marked explicit' : 'Not explicit', data: { field: 'explicit' } });
  }
  if (body.target_minutes !== undefined && body.target_minutes !== e.target_minutes) {
    const m = body.target_minutes;
    e.target_minutes = typeof m === 'number' && m > 0 && m < 1000 ? m : undefined;
    events.push({ kind: 'settings', anchor: 'episode', summary: `Target length — ${e.target_minutes ? `${e.target_minutes} min` : 'none'}`, data: { field: 'target_minutes' } });
  }
  if (typeof body.show_notes === 'string' && body.show_notes !== (doc.show_notes ?? '')) {
    doc.show_notes = body.show_notes.slice(0, 100_000);
    events.push({ kind: 'edit', anchor: 'show_notes', summary: 'Edited the show notes', data: { field: 'show_notes' } });
  }
  if (typeof body.transcript === 'string' && body.transcript !== (doc.transcript ?? '')) {
    doc.transcript = body.transcript.slice(0, 1_000_000);
    delete doc.transcript_stale;
    events.push({ kind: 'edit', anchor: 'transcript', summary: 'Edited the transcript', data: { field: 'transcript' } });
  }
  return events;
}

/** A recording session from the card: shape-checked, never trusted. */
function cleanSession(input: unknown): RecordingSession | null {
  if (input === null) return null;
  const s = (input ?? {}) as Record<string, unknown>;
  if (typeof s.started_at !== 'string' || Number.isNaN(Date.parse(s.started_at))) throw new HttpError(400, 'a session needs started_at');
  const splits = (Array.isArray(s.splits) ? s.splits : []).slice(0, 500).flatMap((r) => {
    const x = (r ?? {}) as Record<string, unknown>;
    return typeof x.segmentId === 'string' && typeof x.entered === 'number' && x.entered >= 0
      ? [{ segmentId: x.segmentId, entered: Math.round(x.entered) }] : [];
  });
  const ended = typeof s.ended === 'number' && s.ended >= 0 ? Math.round(s.ended) : undefined;
  return { started_at: s.started_at, splits, ...(ended !== undefined ? { ended } : {}) };
}

function fmtMinutes(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

// ── the routes ───────────────────────────────────────────────────────────

export const podcastRoutes: Route[] = [
  [/^\/api\/episodes$/, 'GET', async () => ({
    episodes: eps.listEpisodes().map((r) => summary(r.doc)),
    next_number: eps.nextEpisodeNumber(),
  })],

  [/^\/api\/episodes$/, 'POST', async ({ body }) => {
    const b = (await body()) as { number?: number; title?: string };
    const number = b.number ?? eps.nextEpisodeNumber();
    if (!Number.isInteger(number) || number < 1) throw new HttpError(400, 'the number must be a positive whole number');
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 300) : '';
    const doc: EpisodeDoc = {
      schema_version: EPISODE_SCHEMA_VERSION,
      episode: { id: `at${number}`, number, title, slug: slugFromTitle(title), summary: '', status: 'draft' },
      segments: [],
      notes: [],
    };
    try {
      const row = eps.createEpisodeRow(doc, [{
        kind: 'episode', summary: `Episode started — Another Thing ${number}`, anchor: 'episode', data: { action: 'started' },
      }]);
      return view(row.doc);
    } catch (err) {
      if (err instanceof eps.EpisodeExists) throw new HttpError(409, err.message);
      throw err;
    }
  }],

  [/^\/api\/episodes\/([^/]+)$/, 'GET', async (_ctx, [id]) => view(requireEpisode(id!))],

  [/^\/api\/episodes\/([^/]+)$/, 'PATCH', async ({ body }, [id]) => {
    const b = (await body()) as Record<string, unknown>;
    const doc = requireEpisode(id!);
    const events = applySettings(doc, b);
    if (!events.length) return view(doc);
    try {
      return saved(doc, events);
    } catch (err) {
      if (err instanceof eps.EpisodeExists) throw new HttpError(409, err.message);
      throw err;
    }
  }],

  [/^\/api\/episodes\/([^/]+)$/, 'DELETE', async (_ctx, [id]) => {
    const doc = requireEpisode(id!);
    if (isSent(doc) || doc.sends?.another?.status === 'sending') {
      throw new HttpError(409, 'a sent episode is the record of what went out — it is not deleted');
    }
    if (mastering.has(id!) || transcribing.has(id!)) throw new HttpError(409, 'the audio is being worked on — wait for it to finish');
    eps.deleteEpisode(id!);
    await unlink(masteredPath(id!)).catch(() => {});
    log.info(`[episode] ${id} deleted (its revisions are kept)`);
    return { ok: true };
  }],

  /**
   * The whole outline at once, with the version it was edited from: an
   * editor that is behind (another tab saved meanwhile) gets a 409 and
   * reloads, rather than writing over the newer outline.
   */
  [/^\/api\/episodes\/([^/]+)\/outline$/, 'PUT', async ({ body }, [id]) => {
    const b = (await body()) as { segments?: unknown; base?: string };
    let segments;
    try {
      segments = cleanOutline(b.segments);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    const doc = requireEpisode(id!);
    if (b.base && b.base !== outlineVersion(doc)) {
      throw new HttpError(409, 'the outline changed in another tab — reloaded with the newer one', 'outline-moved');
    }
    const events = outlineEvents(doc.segments, segments);
    doc.segments = segments;
    return events.length ? saved(doc, events) : view(doc);
  }],

  /** The card's session: started, its splits as segments are entered, finished, or reset (null). */
  [/^\/api\/episodes\/([^/]+)\/session$/, 'PUT', async ({ body }, [id]) => {
    const b = (await body()) as { session?: unknown };
    const session = cleanSession(b.session);
    // Read and save with nothing between: the events compare with the session as it stood.
    const before = requireEpisode(id!).session;
    const events: EventInput[] = [];
    if (!session && before) {
      events.push({ kind: 'recording', summary: 'Recording reset — its splits dropped', anchor: 'record', data: { action: 'reset' } });
    }
    if (session && before?.started_at !== session.started_at) {
      events.push({ kind: 'recording', summary: 'Recording started', anchor: 'record', data: { action: 'started' } });
    }
    if (session?.ended !== undefined && (before?.started_at !== session.started_at || before?.ended === undefined)) {
      events.push({
        kind: 'recording', summary: `Recording finished — ${fmtMinutes(session.ended)} at the card`, anchor: 'record',
        data: { action: 'finished', seconds: session.ended, segments: session.splits.length },
      });
    }
    return fresh(id!, (doc) => {
      if (session) doc.session = session;
      else delete doc.session;
    }, events);
  }],

  [/^\/api\/episodes\/([^/]+)\/notes$/, 'POST', async ({ body }, [id]) => {
    const b = (await body()) as { text?: unknown; elapsed?: unknown; segmentId?: unknown };
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 2000) : '';
    if (!text) throw new HttpError(400, 'a note needs words');
    const note: TakeNote = {
      at: new Date().toISOString(),
      text,
      ...(typeof b.elapsed === 'number' && b.elapsed >= 0 ? { elapsed: Math.round(b.elapsed) } : {}),
      ...(typeof b.segmentId === 'string' ? { segmentId: b.segmentId } : {}),
    };
    return fresh(id!, (doc) => { doc.notes = [...doc.notes, note]; }, [{
      kind: 'recording', summary: `Take note${note.elapsed !== undefined ? ` at ${fmtMinutes(note.elapsed)}` : ''} — ${text.slice(0, 80)}`,
      anchor: note.segmentId ?? 'record', data: { action: 'note' },
    }]);
  }],

  [/^\/api\/episodes\/([^/]+)\/notes\/(\d+)$/, 'DELETE', async (_ctx, [id, index]) => {
    const i = Number(index);
    const doc = requireEpisode(id!);
    const note = doc.notes[i];
    if (!note) throw new HttpError(404, `no note ${i}`);
    doc.notes = doc.notes.filter((_, n) => n !== i);
    return saved(doc, [{ kind: 'recording', summary: `Removed a take note — ${note.text.slice(0, 80)}`, anchor: 'record', data: { action: 'remove-note' } }]);
  }],

  /**
   * The edited recording, as raw bytes (?name= its file name), streamed to
   * disk and mastered. Answers when the master is done: a minute or two for
   * a half-hour episode. The first master stamps the episode's date, which
   * is what its GUID is made from; a re-master keeps the date.
   */
  [/^\/api\/episodes\/([^/]+)\/audio$/, 'POST', async ({ req, url }, [id]) => {
    const doc = requireEpisode(id!);
    if (mastering.has(id!)) throw new HttpError(409, 'a recording is already being mastered');
    // A draft being made describes the mp3 it was made from.
    if (transcribing.has(id!)) throw new HttpError(409, 'the transcript is being drafted from the current master — wait for it');
    if (sending.has(id!) || isOut(doc.sends?.another)) throw new HttpError(409, 'the episode is being sent — wait for the send');
    const name = (url.searchParams.get('name') ?? 'recording.wav').replace(/[^\w. -]/g, '').slice(0, 120) || 'recording.wav';

    mastering.add(id!);
    const work = await mkdtemp(join(tmpdir(), `wt-episode-drop-${id}-`)).catch((err) => {
      mastering.delete(id!);
      throw err;
    });
    const started = Date.now();
    try {
      const ext = /\.[a-z0-9]{1,5}$/i.exec(name)?.[0] ?? '.wav';
      const src = join(work, `source${ext}`);
      let size = 0;
      await pipeline(req, async function* (source) {
        for await (const chunk of source) {
          size += (chunk as Buffer).length;
          if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'the recording is over 2 GB');
          yield chunk;
        }
      }, createWriteStream(src));
      if (!size) throw new HttpError(400, 'the recording is empty');
      record(id!, { kind: 'audio', summary: `Recording dropped — ${name}, ${(size / 1e6).toFixed(1)} MB`, anchor: 'audio', data: { action: 'dropped', name, bytes: size } });

      let result;
      try {
        result = await master(requireEpisode(id!), src);
      } catch (err) {
        record(id!, { kind: 'audio', actor: 'wt-builder', summary: `Mastering failed — ${(err as Error).message.slice(0, 200)}`, anchor: 'audio', data: { action: 'failed', ms: Date.now() - started } });
        throw new HttpError(500, `mastering failed: ${(err as Error).message}`);
      }
      const ms = Date.now() - started;
      return fresh(id!, (d) => {
        // A transcript of the take this replaces may not match the new one.
        if (d.audio && d.transcript?.trim()) d.transcript_stale = true;
        d.audio = { source_filename: name, duration_seconds: result.durationSeconds, bytes: result.bytes, mastered_at: new Date().toISOString() };
        if (!d.episode.date) d.episode.date = centralIso(Date.now());
      }, [{
        kind: 'audio', actor: 'wt-builder', anchor: 'audio',
        summary: `Mastered — ${fmtMinutes(result.durationSeconds)}, ${(result.bytes / 1e6).toFixed(1)} MB, in ${took(ms)}`,
        data: { action: 'mastered', ms, seconds: result.durationSeconds, bytes: result.bytes },
      }]);
    } finally {
      mastering.delete(id!);
      await rm(work, { recursive: true, force: true });
    }
  }],

  /** The mastered mp3, for listening back in the page. */
  [/^\/api\/episodes\/([^/]+)\/audio$/, 'GET', async ({ res, readOnly }, [id]) => {
    if (readOnly) throw new HttpError(400, 'audio is not readable through the MCP');
    requireEpisode(id!);
    const path = masteredPath(id!);
    const info = await stat(path).catch(() => null);
    if (!info) throw new HttpError(404, 'no mastered audio for this episode');
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
    await pipeline(createReadStream(path), res);
    return ANSWERED;
  }],

  /**
   * A transcript draft from the mastered audio. It replaces a transcript
   * Jamie has already worked on only when asked to (`replace`).
   */
  [/^\/api\/episodes\/([^/]+)\/transcribe$/, 'POST', async ({ body }, [id]) => {
    const b = (await body()) as { replace?: boolean };
    const doc = requireEpisode(id!);
    if (transcribing.has(id!)) throw new HttpError(409, 'already transcribing');
    if (sending.has(id!) || isOut(doc.sends?.another)) throw new HttpError(409, 'the episode is being sent — transcribe when the send is done');
    if (mastering.has(id!)) throw new HttpError(409, 'a new recording is being mastered — transcribe when it is done');
    if (!existsSync(masteredPath(id!))) throw new HttpError(409, 'no mastered audio yet — drop the recording first');
    if (doc.transcript?.trim() && !b.replace) {
      throw new HttpError(409, 'the episode has a transcript already — replacing it loses your edits', 'has-transcript');
    }
    // What the transcript said when the draft was asked for: the draft
    // replaces that, and only that.
    const asked = doc.transcript ?? '';
    transcribing.add(id!);
    const started = Date.now();
    record(id!, { kind: 'audio', summary: 'Transcribing the mastered audio', anchor: 'transcript', data: { action: 'transcribe' } });
    try {
      const seconds = doc.audio?.duration_seconds ?? await durationSeconds(masteredPath(id!));
      const text = await transcribe(masteredPath(id!), seconds);
      const ms = Date.now() - started;
      const paragraphs = text.split('\n\n').filter(Boolean).length;
      // Edited while the audio was being listened to (another tab, or a
      // paste before the page locked the box): what Jamie wrote stays.
      if ((requireEpisode(id!).transcript ?? '') !== asked) {
        record(id!, { kind: 'audio', actor: 'wt-builder', summary: 'Transcript draft set aside — the transcript was edited meanwhile', anchor: 'transcript', data: { action: 'set-aside', ms } });
        throw new HttpError(409, 'the transcript was edited while the draft was made — your text is kept; Transcribe again to replace it', 'transcript-moved');
      }
      return fresh(id!, (d) => { d.transcript = text; delete d.transcript_stale; }, [{
        kind: 'audio', actor: 'wt-builder', anchor: 'transcript',
        summary: `Transcript drafted — ${paragraphs} paragraph${paragraphs === 1 ? '' : 's'}, in ${took(ms)}`,
        data: { action: 'transcribed', ms, paragraphs },
      }]);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      record(id!, { kind: 'audio', actor: 'wt-builder', summary: `Transcription failed — ${(err as Error).message.slice(0, 200)}`, anchor: 'transcript', data: { action: 'failed', ms: Date.now() - started } });
      throw new HttpError(502, (err as Error).message);
    } finally {
      transcribing.delete(id!);
    }
  }],

  /** What a send would commit, as text, with the problems: no network, nothing written. */
  [/^\/api\/episodes\/([^/]+)\/package$/, 'GET', async (_ctx, [id]) => {
    const doc = requireEpisode(id!);
    const problems = validate(doc);
    const blocked = problems.some((p) => p.severity === 'blocks');
    let files: { path: string; content: string }[] = [];
    let error: string | undefined;
    if (!blocked) {
      try {
        files = packageTextFiles(doc);
      } catch (err) {
        error = (err as Error).message;
      }
    }
    return {
      problems,
      files,
      audio: doc.episode.date && doc.audio ? { path: audioRepoPath(doc.episode.number, doc.episode.date), bytes: doc.audio.bytes } : null,
      repo: config.anotherRepo,
      ...(error ? { error } : {}),
    };
  }],

  [/^\/api\/episodes\/([^/]+)\/send$/, 'POST', async ({ url }, [id]) => send(id!, url.searchParams.get('force') === '1')],

  [/^\/api\/episodes\/([^/]+)\/verify$/, 'POST', async (_ctx, [id]) => {
    await runVerify(id!, true);
    return view(requireEpisode(id!));
  }],

  [/^\/api\/episodes\/([^/]+)\/events$/, 'GET', async (_ctx, [id]) => {
    requireEpisode(id!);
    return { events: listEvents(id!) };
  }],
];
