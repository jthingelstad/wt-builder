/**
 * The WT Builder service.
 *
 * A thin Node service: it holds the credentials, talks to Pinboard,
 * Micro.blog, and Buttondown, and owns the database. The client never sees a
 * secret and never calls a third party directly.
 *
 * Reached over Tailscale. Binding is loopback by default because the tailnet
 * terminates identity in front of this process; there is no auth layer here and
 * exposing it on a public interface would publish an unauthenticated editor.
 */

import { dateTaken, issueSaturday, nextIssueDate, todayCentral } from '../shared/dates.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ArchiveReference, Channel, Destination, IssueDoc, Item, SendState, Verification } from '../shared/types.ts';
import { render } from '../shared/render/index.ts';
import { emailOf, isOut, lastSent, recordedAudioUrl, refusedAsSent } from '../shared/sends.ts';
import { renderEmail } from '../shared/render/email.ts';
import { config, describeConfig } from './config.ts';
import * as edge from './edge.ts';
import * as store from './db.ts';
import * as issues from './issue.ts';
import { holds } from './reconcile.ts';
import * as buttondown from './integrations/buttondown.ts';
import * as pinboard from './integrations/pinboard.ts';
import * as microblog from './integrations/microblog.ts';
import { applyRehost, rehostIssueImages, storeUpload } from './integrations/images.ts';
import * as geocode from './integrations/geocode.ts';
import * as editorial from './editorial.ts';
import * as githubRepo from './integrations/github.ts';
import * as audio from './integrations/audio.ts';
import { audioScript } from '../shared/render/audio.ts';
import { heldOut, outOfWindow, windowOf } from '../shared/render/plan.ts';
import { archiveInputs, emailSubject, issueEntry, siteInputs, type IssueEntry } from './publish.ts';
import * as draftShare from './share.ts';
import { verifierFor } from './verify.ts';
import { issueTiming, type IssueTiming } from '../shared/timing.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const DIST = config.distDir;

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: () => Promise<any>;
  raw: () => Promise<Buffer>;
}

export class HttpError extends Error {
  /** `code` names a refusal the client acts on, beside the message it shows. */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/**
 * A leg turned down on what the destination said, after its state was set
 * back as it was: the one error a leg's catch passes through without
 * recording a failure. Any other error — a 409 included — is a failed send.
 */
class Refusal extends HttpError {}

/**
 * The build a reload would load: `build-id.txt`, which vite writes beside
 * the client it names. Read per answer, not at boot, because it is the
 * client on disk that counts. None under the dev server, or before a build.
 */
function servedBuild(): string | undefined {
  try {
    return readFileSync(join(DIST, 'build-id.txt'), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  const build = servedBuild();
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    // A tab left open across a deploy compares this with its own build and
    // offers a reload (review 2026-09-27 §2.4).
    ...(build ? { 'X-WT-Builder-Build': build } : {}),
  });
  res.end(body);
}

/**
 * Raw request bytes, for a photo upload. Kept separate from readBody so an
 * image never has to survive a base64 round trip through the JSON parser —
 * which inflates it by a third and pushes real photos past the size limit.
 */
async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 40_000_000) throw new HttpError(413, 'image too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 8_000_000) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

/** Load an issue or fail with a 404 the client can act on. */
function requireIssue(id: string): IssueDoc {
  const row = store.getIssue(id);
  if (!row) throw new HttpError(404, `no issue ${id}`);
  return row.doc;
}

function saved(doc: IssueDoc) {
  const row = store.saveIssue(doc);
  return { issue: row.doc, readiness: issues.readiness(row.doc) };
}

/**
 * Re-read the issue and apply a synchronous change to that, then save.
 *
 * The rule for every handler that awaits the network: do the slow work
 * against the copy you read, then apply its *result* to a fresh read. A
 * handler that reads, awaits for seconds, and saves the copy it read writes
 * over whatever Jamie saved in between - a re-scan on page open did exactly
 * that to two Currently lines (2026-09-20). Node runs this function without
 * yielding, so nothing can land between the read and the save.
 */
function savedFresh(id: string, change: (doc: IssueDoc) => IssueDoc | void) {
  const fresh = requireIssue(id);
  return saved(change(fresh) ?? fresh);
}

/**
 * The legs running in this process, `${id}:${dest}` — the real in-flight
 * guard. Sends run in-process, so this knows exactly what is running: a
 * podcast synthesis past ten minutes is still in flight, and a `sending`
 * left by a restart is not (review 2026-09-27 §2.1).
 */
const legsInFlight = new Set<string>();

/**
 * Refuse a leg that is already in flight — the client disables its buttons,
 * but two tabs are a documented workflow, and a second POST re-runs paid TTS
 * and re-uploads, or creates a second Buttondown draft. The persisted
 * `sending` still counts for ten minutes, for another process on the same
 * database (`npm run dev` beside the service); older than that it is a
 * stranded crash, and passes so the leg can be retried.
 */
function guardInFlight(doc: IssueDoc, destination: Destination): void {
  if (legsInFlight.has(`${doc.issue.id}:${destination}`)) {
    throw new HttpError(409, `${destination} send already in flight`);
  }
  const current = doc.sends?.[destination];
  if (isOut(current)) {
    throw new HttpError(409, `${destination} send already in flight since ${current!.at}`);
  }
}

/**
 * Take a leg that has passed its guards: in flight in this process, and
 * `sending` on the issue — both synchronously, straight after the guard and
 * before any await, so a second click finds it taken. The in-flight guard
 * once ran seconds before `sending` was recorded, across the rehost, and two
 * clicks made two Buttondown drafts (review 2026-09-27 §2.1). Returns the
 * release, for a `finally`; the leg records its own outcome.
 *
 * `sending` is written before the key is taken: if the write throws (a busy
 * database), nothing holds the key, and the leg is not "in flight" until a
 * restart. Both are synchronous, so no request can come between them.
 */
function claimLeg(id: string, destination: Destination, state: Partial<SendState> = {}): () => void {
  const key = `${id}:${destination}`;
  store.recordSend(id, destination, { ...state, status: 'sending', at: new Date().toISOString() });
  legsInFlight.add(key);
  return () => legsInFlight.delete(key);
}

/**
 * Sends run in-process, so a `sending` found at boot is nobody's: the
 * restart cut it off. Each becomes `failed`, keeping its last good send
 * (recordSend carries it) and whatever it was working on, so the card says
 * what happened and a retry is not refused for ten minutes. Runs as the
 * server starts listening — only a process that won the port owns the
 * sends — and before it handles a request.
 */
export function failInterruptedSends(): void {
  for (const row of store.listIssues()) {
    for (const [dest, state] of Object.entries(row.doc.sends ?? {})) {
      if (state?.status !== 'sending') continue;
      store.recordSend(row.id, dest as Destination, {
        status: 'failed',
        at: new Date().toISOString(),
        error: 'interrupted by a restart',
        ...(state.external_id ? { external_id: state.external_id } : {}),
      });
      store.logEvent(row.id, 'send', `Send failed — ${dest}: interrupted by a restart`);
    }
  }
}

/**
 * Push one item's working values to its source and record the outcome: the
 * sync event, the item's sync state, and — on success — the moved merge
 * base. Shared by the explicit write-back route and edits that imply one
 * (a section move changes the bookmark's tags).
 */
async function writeItemToSource(
  id: string,
  doc: IssueDoc,
  itemId: string,
): Promise<{ patch: Partial<Item>; result: { sync_state: Item['sync_state']; error?: string } }> {
  const item = doc.items[itemId];
  if (!item) throw new HttpError(404, `no item ${itemId}`);

  // Writing back a `gone` item would recreate the record its owner deleted
  // at the source. Deleting was an act there; restoring must be one too.
  const result =
    item.sync_state === 'gone'
      ? { sync_state: 'gone' as const, error: `deleted at ${item.source} — not recreating it` }
      : item.source === 'Micro.blog'
        ? await microblog.updatePost(item)
        : item.source === 'Pinboard'
          ? await pinboard.writeBack(item)
          : { sync_state: 'local' as const, error: `${item.source} has no write-back` };

  store.logEvent(id, 'sync',
    `Write to ${item.source} — ${result.sync_state}${result.error ? `: ${result.error}` : ''} — ${issues.itemName(item)}`, itemId);
  // A successful write moves the merge base: the snapshot now records what
  // was written, so the next scan's reconcile starts from this write rather
  // than re-adopting it as a source-side change.
  const snapshot =
    result.sync_state === 'synced'
      ? {
          source_snapshot:
            item.source === 'Pinboard'
              ? { title: item.title ?? '', commentary: item.commentary ?? '', tags: item.tags ?? [] }
              : { title: item.title ?? '', body: item.body ?? '' },
        }
      : {};
  const patch: Partial<Item> = { sync_state: result.sync_state, sync_error: result.error, ...snapshot };
  const flags = (result as { flags?: Record<string, string> }).flags;
  if (flags) patch.source_flags = flags;
  return { patch, result };
}

/**
 * One write-back per item at a time. Two quick edits each wrote on their
 * own, and the older could land last: the source kept the older words while
 * the item said synced with the newer (review 2026-09-27, §4). `waiting`
 * counts this item's writes queued or running.
 */
const writeQueues = new Map<string, { tail: Promise<unknown>; waiting: number }>();

/** `result` is the item's sync state as saved once the write's outcome was applied. */
type WriteOutcome = { response: ReturnType<typeof saved>; result: { sync_state: Item['sync_state']; error?: string } };

/**
 * Write an item to its source and apply the outcome to a fresh read, after
 * any write to the same item already queued. Each write reads the item when
 * its turn comes, so it carries the newest words, not the ones its edit saw.
 */
function writeBack(id: string, itemId: string): Promise<WriteOutcome> {
  const key = `${id}\n${itemId}`;
  const queue = writeQueues.get(key) ?? { tail: Promise.resolve(), waiting: 0 };
  writeQueues.set(key, queue);
  queue.waiting++;
  const run = queue.tail.catch(() => {}).then(() => writeLatest(id, itemId, queue));
  queue.tail = run.catch(() => {}).finally(() => {
    queue.waiting--;
    if (!queue.waiting && writeQueues.get(key) === queue) writeQueues.delete(key);
  });
  return run;
}

async function writeLatest(id: string, itemId: string, queue: { waiting: number }): Promise<WriteOutcome> {
  for (let attempt = 1; ; attempt++) {
    // A write whose turn comes after the issue was put to bed writes
    // nothing: the issue is frozen, and the door refused it too.
    const doc = awake(requireIssue(id));
    const { patch, result } = await writeItemToSource(id, doc, itemId);
    let again = false;
    const response = savedFresh(id, (d) => {
      // Put to bed while the source was written: the write reached it, so
      // its outcome is still recorded — sync state and the snapshot of what
      // the source now holds. Bed freezes the words, not that record; left
      // at the old base, the next write after waking found a phantom
      // conflict (cross-batch fixes review, round 1). No word is changed,
      // and nothing is written again while it sleeps.
      const asleep = Boolean(d.issue.put_to_bed_at);
      const fresh = d.items[itemId];
      if (!fresh) return;
      const written = patch.source_snapshot;
      if (result.sync_state !== 'synced' || !written || holds(fresh, written)) {
        return issues.updateItem(d, itemId, patch);
      }
      // The words changed while they were being written. The source holds
      // what was written, so that is the base now; the newer words are not
      // synced until they are written too — by the write queued behind this
      // one, or by this one again.
      const next = issues.updateItem(d, itemId, { ...patch, sync_state: 'syncing', sync_error: undefined });
      if (queue.waiting > 1 || asleep) return next;
      if (attempt < 3) { again = true; return next; }
      next.items[itemId]!.sync_state = 'failed';
      next.items[itemId]!.sync_error = 'it kept changing while it was written — your edit is kept; Retry';
      return next;
    });
    if (again) continue;
    // Answer with the state that was saved, not the source's raw reply: a
    // write that landed stale is `syncing` or `failed` on the item, and a
    // client told `synced` clears an error the card still shows (Batch 2
    // review round 1, follow-up 2).
    const applied = response.issue.items[itemId];
    return {
      response,
      result: applied ? { sync_state: applied.sync_state, error: applied.sync_error } : result,
    };
  }
}

/**
 * An item's source record as it stands now; null when the source says it
 * was deleted. A read that fails is a 502 and nothing has changed — it
 * never reads as a deletion.
 */
async function readSource(item: Item): Promise<import('./reconcile.ts').RemoteFields | null> {
  if (!item.source_url || (item.source !== 'Pinboard' && item.source !== 'Micro.blog')) {
    throw new HttpError(400, `${item.source} has no source record to read`);
  }
  try {
    return item.source === 'Pinboard'
      ? await pinboard.fetchBookmark(item.source_url)
      : await microblog.fetchPost(item.source_url);
  } catch (err) {
    throw new HttpError(502, `could not read ${item.source}: ${(err as Error).message} — nothing changed`);
  }
}

/**
 * The issue from about a year ago this week, for Echoes' seasonal lens.
 * Undefined when the archive holds nothing near that date — the draft then
 * runs on semantic retrieval alone.
 */
function seasonalFor(doc: IssueDoc): editorial.SeasonalIssue | undefined {
  const picked = editorial.pickSeasonalIssue(
    store.listIssueDates(),
    doc.issue.publication_date,
    doc.issue.number,
  );
  if (!picked) return undefined;
  const row = store.getIssueByNumber(picked.number);
  if (!row) return undefined;
  return {
    number: picked.number,
    title: row.doc.issue.title,
    publication_date: picked.publication_date,
    excerpt: editorial.issueExcerpt(row.doc),
  };
}

/**
 * Thingy's sentences from every Builder issue, for the drafting routes that
 * retrieve from the archive: the Librarian's passages carry no author, so
 * Echoes and the link wand filter Thingy's words out by text.
 */
function thingySentences(): string[] {
  return editorial.thingySentences(store.listIssues().map((r) => r.doc));
}

/** Bracket a send leg with log entries; the leg's own behavior is untouched. */
async function loggedSend(id: string, dest: string, run: () => Promise<unknown>): Promise<unknown> {
  store.logEvent(id, 'send', `Send started — ${dest}`);
  try {
    const out = await run();
    store.logEvent(id, 'send', `Send finished — ${dest}`);
    return out;
  } catch (err) {
    store.logEvent(id, 'send', `Send failed — ${dest}: ${(err as Error).message}`);
    throw err;
  }
}

/**
 * An issue put to bed refuses every change. One guard at the door rather
 * than one per route, so a route added later cannot forget it. Reads pass,
 * and so do waking it and re-running verification, which only reads the
 * destinations back.
 */
function guardBed(method: string, pathname: string): void {
  if (method === 'GET') return;
  const m = /^\/api\/issues\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return;
  const rest = m[2] ?? '';
  if (rest === '/bed' || rest.startsWith('/verify/')) return;
  const doc = store.getIssue(decodeURIComponent(m[1]!))?.doc;
  if (doc) awake(doc);
}

/**
 * The door's 423, for the doc in hand. A handler that awaited the network
 * passed the door before the issue was put to bed, so its fresh read asks
 * again before applying a result; `meanwhile` says what it was waiting on.
 */
function awake(doc: IssueDoc, meanwhile?: string): IssueDoc {
  if (!doc.issue.put_to_bed_at) return doc;
  throw new HttpError(423, meanwhile
    ? `WT${doc.issue.number} was put to bed while ${meanwhile} — nothing changed here; wake it to change anything`
    : `WT${doc.issue.number} is put to bed — wake it to change anything`);
}

/** What the voice will say, hashed: the script review and approval are for this text. */
function scriptHash(blocks: { text: string }[]): string {
  return createHash('sha256').update(blocks.map((b) => b.text).join('\n')).digest('hex');
}

/**
 * What shipped in WT Builder between two moments — the features an issue
 * was the first to be made with. Read from this checkout's own history.
 */
async function shippedBetween(fromIso: string, toIso: string): Promise<{ sha: string; at: string; subject: string }[]> {
  try {
    const { stdout } = await promisify(execFile)('git', ['log', `--since=${fromIso}`, `--until=${toIso}`, '--format=%h%x09%cI%x09%s', '--', 'src'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)), timeout: 10_000,
    });
    return stdout.trim().split('\n').filter(Boolean).map((l) => {
      const [sha, at, ...rest] = l.split('\t');
      return { sha: sha!, at: at!, subject: rest.join('\t') };
    });
  } catch {
    return [];
  }
}

function timingOf(id: string): IssueTiming | null {
  const row = store.getIssue(id);
  return row ? issueTiming(store.allEvents(id), row.doc) : null;
}

/** A verification older than this that still says `running` was stranded by a restart. */
const VERIFY_STALE_MS = 25 * 60_000;

/**
 * Read one leg's destination back and record what was found. Runs in the
 * background — listening to the podcast takes a couple of minutes, and the
 * website's page appears only once the site has deployed — so the Send view
 * shows `running` and picks the result up when it lands.
 */
async function runVerify(id: string, dest: Destination, wait = false, resumed = false): Promise<void> {
  const verify = verifierFor(dest);
  const doc = store.getIssue(id)?.doc;
  if (!verify || !doc) return;
  const current = doc.verify?.[dest];
  // A `running` left by the previous process is nobody's; `resumed` takes it over.
  if (!resumed && current?.status === 'running' && Date.now() - Date.parse(current.at) < VERIFY_STALE_MS) return;
  clearRecheck(id, dest);
  // What the destination last said stays while it is asked again: the card
  // reads remote_status to offer "Update web copy…", and a check in flight
  // must not flip it back to "Update draft".
  store.recordVerify(id, dest, {
    status: 'running', at: new Date().toISOString(), checks: [],
    ...(current?.remote_status ? { remote_status: current.remote_status } : {}),
  });
  let result: Verification;
  try {
    const { checks, recheckMs, remote_status } = await verify(doc, wait);
    const status = checks.some((c) => c.ok === false) ? 'problems'
      : checks.some((c) => c.ok === null) ? (recheckMs ? 'waiting' : 'warnings')
      : 'passed';
    result = { status, at: new Date().toISOString(), checks, ...(remote_status ? { remote_status } : {}) };
    if (recheckMs) {
      result.recheck_at = new Date(Date.now() + recheckMs).toISOString();
      scheduleRecheck(id, dest, recheckMs);
    }
  } catch (err) {
    result = {
      status: 'error', at: new Date().toISOString(), checks: [], error: (err as Error).message.slice(0, 500),
      ...(current?.remote_status ? { remote_status: current.remote_status } : {}),
    };
  }
  store.recordVerify(id, dest, result);
  store.logEvent(id, 'verify', `Verified — ${dest}: ${result.status}${result.error ? ` (${result.error.slice(0, 120)})` : ''}`);
}

/**
 * A leg still landing is looked at again on its own: a scheduled email once
 * its minute has passed, an archive until the Librarian has it. Timers are
 * in memory; `recheck_at` on the issue lets a restart pick them back up.
 */
const rechecks = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleRecheck(id: string, dest: Destination, ms: number, resumed = false): void {
  clearRecheck(id, dest);
  // setTimeout's ceiling is ~24.8 days; nothing here waits anywhere near it.
  rechecks.set(`${id}:${dest}`, setTimeout(() => {
    rechecks.delete(`${id}:${dest}`);
    void runVerify(id, dest, false, resumed).catch(() => { /* recorded inside */ });
  }, Math.max(ms, 30_000)));
}
function clearRecheck(id: string, dest: Destination): void {
  const t = rechecks.get(`${id}:${dest}`);
  if (t) clearTimeout(t);
  rechecks.delete(`${id}:${dest}`);
}
/** After a restart, re-arm every recheck the last process had promised. */
function resumeRechecks(): void {
  for (const row of store.listIssues()) {
    for (const [dest, v] of Object.entries(row.doc.verify ?? {})) {
      if (!v) continue;
      if (v.status === 'running' || (v.recheck_at && v.status === 'waiting')) {
        const due = v.recheck_at ? Date.parse(v.recheck_at) - Date.now() : 0;
        scheduleRecheck(row.id, dest as Destination, Math.max(due, 60_000), true);
      }
    }
  }
}

/** After a leg goes out, check it landed — without holding up the response. */
function verifyAfterSend(id: string, dest: Destination): void {
  void runVerify(id, dest, dest === 'website').catch(() => { /* recorded inside */ });
}

// ── routes ────────────────────────────────────────────────────────────────

const routes: [RegExp, string, (ctx: Ctx, params: string[]) => Promise<unknown>][] = [
  [/^\/api\/health$/, 'GET', async () => ({
    ok: true,
    ...describeConfig(),
    editorial: editorial.isConfigured() ? 'configured' : 'MISSING',
  })],

  [/^\/api\/issues$/, 'GET', async () => ({
    issues: store.listIssues().map((r) => {
      const ready = issues.readiness(r.doc);
      const items = Object.values(r.doc.items);
      return {
        id: r.id,
        number: r.number,
        title: r.doc.issue.title,
        publication_date: r.publication_date,
        status: r.status,
        updated_at: r.updated_at,
        imported: Boolean(r.doc.issue.imported),
        put_to_bed_at: r.doc.issue.put_to_bed_at,
        // Builder issues only: how long it took, for the index row.
        built_ms: r.doc.issue.imported ? undefined : (() => { const t = timingOf(r.id); return t && t.actions ? t.activeMs + t.after.ms : undefined; })(),
        sends: r.doc.sends ?? {},
        readiness: ready.pct,
        // The dashboard draws one tick per unit, so it needs the units
        // themselves — a percentage cannot be rendered as a strip.
        ticks: ready.units.map((u) => u.done),
        outstanding: ready.total - ready.done,
        counts: {
          items: items.length,
          links: items.filter((i) => i.type === 'pinboard_link').length,
          journal: items.filter((i) => i.type === 'journal_post').length,
        },
      };
    }),
    next_number: store.lastPublishedNumber() + 1,
  })],

  [/^\/api\/issues$/, 'POST', async ({ body }) => {
    const b = await body();
    const number = Number(b.number ?? store.lastPublishedNumber() + 1);
    if (!Number.isFinite(number) || number <= 0) throw new HttpError(400, 'invalid issue number');
    if (store.getIssueByNumber(number)) throw new HttpError(409, `issue ${number} already exists`);
    // One issue per Saturday. A second one dated the Saturday just sent
    // swept last week's links, and holding them out wrote `_exclude` onto
    // bookmarks that issue published (review 2026-09-27, §3).
    const dates = store.listIssueDates();
    const publication_date = String(b.publication_date ?? nextIssueDate(dates.map((d) => d.publication_date), todayCentral()));
    if (dateTaken(dates.map((d) => d.publication_date), publication_date)) {
      const holder = dates.find((d) => issueSaturday(d.publication_date) === issueSaturday(publication_date))!;
      throw new HttpError(409, `WT${holder.number} is already dated ${issueSaturday(publication_date)} — pick another Saturday`);
    }
    const doc = issues.createIssue({
      number,
      publication_date,
      window_days: b.window_days ? Number(b.window_days) : 7,
      title: b.title,
      dek: b.dek,
    });
    // Insert-only: the id is wt<N> for life and a renumbered issue still
    // holds its old one, so a number check alone let an upsert replace it.
    let row: store.IssueRow;
    try {
      row = store.createIssueRow(doc);
    } catch (err) {
      if (err instanceof store.IssueExists) throw new HttpError(409, err.message);
      throw err;
    }
    store.logEvent(doc.issue.id, 'issue', `Issue started — WT${doc.issue.number}, publishes ${doc.issue.publication_date}`);
    return { issue: row.doc, readiness: issues.readiness(row.doc) };
  }],

  [/^\/api\/issues\/([^/]+)$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    // Repair an older skeleton on the way out, once, and persist it so the
    // repair is visible in the document rather than re-applied on every read.
    const repaired = issues.normalizeSkeleton(doc);
    if (repaired) return saved(repaired);
    return { issue: doc, readiness: issues.readiness(doc) };
  }],

  // The client never calls this; it exists for a draft started by mistake
  // (and the route tests' cleanup). Anything that has gone anywhere is part
  // of the record: a published issue belongs to the archive, and a leg sent,
  // in flight, or failed, or a live share page, may have left something at
  // its destination that the document is the only map to. Only an unsent,
  // unshared draft goes, and its last
  // version stays in revisions (store.deleteIssue). Review 2026-09-27, §1.6.
  [/^\/api\/issues\/([^/]+)$/, 'DELETE', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    if (doc.issue.status !== 'draft') {
      throw new HttpError(409, `WT${doc.issue.number} is published — it cannot be deleted`);
    }
    const legs = Object.entries(doc.sends ?? {})
      .filter(([, s]) => s && s.status !== 'none')
      .map(([d, s]) => `${d} ${s!.status}`);
    if (legs.length) {
      throw new HttpError(409, `WT${doc.issue.number} has been sent (${legs.join(', ')}) — only an unsent draft can be deleted`);
    }
    // A shared draft has a page on the CDN, and only this document can take
    // it down (DELETE …/share). Deleted, the page would stay up with no
    // Unshare left to press.
    if (doc.draft_share) {
      throw new HttpError(409, `WT${doc.issue.number} is shared at ${doc.draft_share.url} — unshare it first`);
    }
    store.deleteIssue(id!);
    return { ok: true };
  }],

  // There is deliberately no whole-document PUT. Every mutation is a named
  // operation, so the server never accepts an unvalidated tree — and a stale
  // client copy can never clobber send states recorded since it was loaded.

  [/^\/api\/issues\/([^/]+)\/sweep$/, 'POST', async (_ctx, [id]) => {
    // A published issue's material is what was sent; a scan would change it
    // under the next re-send. The client offers Re-scan on drafts only.
    const current = requireIssue(id!);
    if (current.issue.status !== 'draft') {
      throw new HttpError(409, `WT${current.issue.number} is published — a re-scan would change what was sent`);
    }
    // Fetch against the issue as it is now; apply to the issue as it is when
    // the fetch is done. Seconds pass in between and Jamie is typing.
    const fetched = await issues.fetchForSweep(current);
    // A leg can land while the sources are read, publishing the issue.
    const fresh = requireIssue(id!);
    if (fresh.issue.status !== 'draft') {
      throw new HttpError(409, `WT${fresh.issue.number} was published while it was scanned — the scan is dropped`);
    }
    const { doc, report } = issues.applySweep(fresh, fetched);
    // A quiet re-scan logs nothing; an open re-scans every time and a page of
    // "0 in" lines would bury the log's signal. Quiet means nothing happened
    // — a drop, a move, or a hold-out is something happening, and a scan that
    // did one of those must say so (the first drops went unlogged, 2026-09-20).
    if (report.log.length) {
      store.logEvent(id!, 'sweep',
        `Re-scan: ${report.added} in, ${report.refreshed} refreshed, ${report.gone} gone, ${report.conflicts} conflicted`);
      for (const entry of report.log) store.logEvent(id!, entry.kind, entry.summary);
    }
    return { ...saved(doc), report };
  }],

  /** The issue's event log, newest first. */
  [/^\/api\/issues\/([^/]+)\/events$/, 'GET', async (_ctx, [id]) => {
    requireIssue(id!); // 404 for a missing issue, not an empty log
    return { events: store.listEvents(id!) };
  }],

  [/^\/api\/issues\/([^/]+)\/render\/([a-z]+)$/, 'GET', async (_ctx, [id, lens]) => {
    const doc = requireIssue(id!);
    const l = lens as 'website' | 'email' | 'audio' | 'source';
    if (!['website', 'email', 'audio', 'source'].includes(l)) {
      throw new HttpError(400, `unknown lens ${lens}`);
    }
    return { lens: l, rendered: render(doc, l) };
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)$/, 'PATCH', async ({ body }, [id, itemId]) => {
    const raw = await body();
    const doc = requireIssue(id!);
    // A silent no-op reads to the client as a saved edit.
    if (!doc.items[itemId!]) throw new HttpError(404, `no item ${itemId}`);
    // A promoted post is a section, and its title is the section's heading.
    // A cleared Title was saved as '' and written to Micro.blog (Batch 5
    // review round 2, B2). A post in the Journal may have no title.
    const promoted = doc.nodes.some((n) => n.kind === 'promoted_item' && n.items.includes(itemId!));
    if (promoted && 'title' in raw && !String(raw.title ?? '').trim()) {
      throw new HttpError(400, 'a promoted post needs a title');
    }
    // An edit that only removes every line break is a lossy view read back
    // as source, not an intention; it is refused here, before it can reach
    // the document or the source it mirrors, and the log says so.
    const { patch, dropped } = issues.withoutFlattening(doc.items[itemId!]!, raw);
    if (dropped.length) {
      store.logEvent(id!, 'edit',
        `Refused an edit to ${dropped.join(', ')} that only removed its line breaks — ${issues.itemName(doc.items[itemId!]!)}`, itemId);
    }
    if (!Object.keys(patch).length) return { issue: doc, readiness: issues.readiness(doc) };
    store.logEvent(id!, 'edit',
      `Edited ${Object.keys(patch).join(', ')} — ${issues.itemName(doc.items[itemId!]!)}`, itemId);
    const result = saved(issues.updateItem(doc, itemId!, patch));

    // The write-back belongs to the edit, not to the surface it was made on.
    // updateItem marks a source-field change `syncing`; only the inspector
    // ever followed that with a write, so an edit made on the canvas sat in
    // "Writing to Pinboard…" forever (2026-09-20). Written here, every path
    // that edits a mirrored field carries it to the source.
    const after = result.issue.items[itemId!];
    if (after?.sync_state !== 'syncing') return result;
    const { response, result: write } = await writeBack(id!, itemId!);
    return { ...response, result: write };
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/channel$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const channel = b.channel as Channel;
    if (!['website', 'email', 'audio'].includes(channel)) {
      throw new HttpError(400, 'channel must be website, email, or audio');
    }
    const doc = requireIssue(id!);
    const item = doc.items[itemId!];
    if (item) {
      store.logEvent(id!, 'channels',
        `${channel} ${b.on ? 'on' : 'off'} — ${issues.itemName(item)}`, itemId);
    }
    return saved(issues.setChannel(doc, itemId!, channel, Boolean(b.on)));
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/visibility$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const doc = requireIssue(id!);
    const item = doc.items[itemId!];
    if (item) {
      store.logEvent(id!, 'channels',
        `${b.visible ? 'Shown' : 'Hidden'} — ${issues.itemName(item)}`, itemId);
    }
    return saved(b.visible ? issues.showItem(doc, itemId!) : issues.hideItem(doc, itemId!));
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/promote$/, 'POST', async (_ctx, [id, itemId]) => {
    const doc = requireIssue(id!);
    const item = doc.items[itemId!];
    // Promoting an already-promoted post is a no-op (issues.promote); only a real one is logged.
    const already = doc.nodes.some((n) => n.kind === 'promoted_item' && n.items.includes(itemId!));
    if (item && !already) store.logEvent(id!, 'structure', `Promoted — ${issues.itemName(item)}`, itemId);
    return saved(issues.promote(doc, itemId!));
  }],

  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/demote$/, 'POST', async (_ctx, [id, nodeId]) =>
    saved(issues.demote(requireIssue(id!), nodeId!))],

  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/move$/, 'POST', async ({ body }, [id, nodeId]) => {
    const b = await body();
    return saved(issues.moveNode(requireIssue(id!), nodeId!, Number(b.delta ?? 0)));
  }],

  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/items\/([^/]+)\/move$/, 'POST',
    async ({ body }, [id, nodeId, itemId]) => {
      const b = await body();
      return saved(issues.moveItem(requireIssue(id!), nodeId!, itemId!, Number(b.delta ?? 0)));
    }],

  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)$/, 'DELETE', async (_ctx, [id, nodeId]) => {
    const doc = requireIssue(id!);
    const label = doc.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
    store.logEvent(id!, 'structure', `Removed section — ${label}`);
    return saved(issues.removeSection(doc, nodeId!));
  }],

  /** One item out: syndicated is held out, locally-authored is deleted. */
  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/items\/([^/]+)$/, 'DELETE',
    async (_ctx, [id, nodeId, itemId]) => {
      const doc = requireIssue(id!);
      const item = doc.items[itemId!];
      if (item) {
        store.logEvent(id!, 'structure', item.authorship === 'syndicated'
          ? `Held out — ${issues.itemName(item)}`
          : `Deleted — ${issues.itemName(item)}`, itemId);
      }
      const result = saved(issues.removeItem(doc, nodeId!, itemId!));
      // A held-out Pinboard link carries _exclude on the bookmark; write it.
      const after = result.issue.items[itemId!];
      if (after?.source !== 'Pinboard' || after.sync_state !== 'syncing') return result;
      return (await writeBack(id!, itemId!)).response;
    }],

  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/rename$/, 'POST', async ({ body }, [id, nodeId]) => {
    const b = await body();
    // Saved as checked, trimmed: it was checked trimmed and saved as sent
    // (Batch 5 review round 2).
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    // An empty heading published as "## " (Batch 5 review, B2).
    if (!label) throw new HttpError(400, 'a section needs a label');
    const doc = requireIssue(id!);
    const old = doc.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
    store.logEvent(id!, 'structure', `Renamed section — ${old} → ${label}`);
    return saved(issues.renameSection(doc, nodeId!, label));
  }],

  [/^\/api\/issues\/([^/]+)\/nodes$/, 'POST', async ({ body }, [id]) => {
    const b = await body();
    const doc = requireIssue(id!);
    if (b.kind === 'markdown') {
      store.logEvent(id!, 'structure', 'Added a Markdown block');
      return saved(issues.addMarkdownBlock(doc, b.before));
    }
    store.logEvent(id!, 'structure', `Added section — ${String(b.label ?? b.type ?? 'Section')}`);
    return saved(issues.addSection(doc, {
      type: String(b.type ?? 'ad_hoc'),
      label: String(b.label ?? 'Section'),
      id: b.id,
      before: b.before,
    }));
  }],

  /** One item into an existing node — a Currently entry, a written link. */
  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/items$/, 'POST', async ({ body }, [id, nodeId]) => {
    const b = await body();
    const type = String(b.type ?? '');
    if (!['currently', 'pinboard_link', 'quote', 'markdown'].includes(type)) {
      throw new HttpError(400, `cannot add a ${type || '(missing type)'} item`);
    }
    store.logEvent(id!, 'structure', `Added a ${type.replace('_', ' ')} — ${nodeId}`);
    return saved(issues.addItem(requireIssue(id!), nodeId!, type as import('../shared/types.ts').ItemType));
  }],

  /**
   * The echoes Jamie ticked, appended to the Echoes section as items — the
   * answer to the section wand. Appends, never replaces: a second run adds
   * to what is there, and each echo is its own item from here on.
   */
  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/echoes$/, 'POST', async ({ body }, [id, nodeId]) => {
    const b = await body();
    const offered = Array.isArray(b.echoes) ? (b.echoes as unknown[]) : [];
    const echoes = offered
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
      .map((e) => ({
        text: String(e.text ?? ''),
        ask: typeof e.ask === 'string' ? e.ask : undefined,
        archive_references: Array.isArray(e.archive_references)
          ? (e.archive_references as unknown[])
              .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && typeof (r as Record<string, unknown>).url === 'string')
              .map((r): ArchiveReference => ({
                kind: r.kind === 'blog' || r.kind === 'podcast' || r.kind === 'issue' ? r.kind : undefined,
                issue: typeof r.issue === 'number' ? r.issue : undefined,
                url: String(r.url),
                title: typeof r.title === 'string' ? r.title : undefined,
                note: typeof r.note === 'string' ? r.note : undefined,
              }))
          : [],
      }))
      .filter((e) => e.text.trim());
    if (!echoes.length) throw new HttpError(400, 'echoes must carry at least one echo with text');
    const doc = requireIssue(id!);
    const node = doc.nodes.find((n) => n.id === nodeId);
    if (!node) throw new HttpError(404, `no section ${nodeId}`);
    if (node.type !== 'echoes') throw new HttpError(400, `${node.label} does not hold echoes`);
    const { doc: next, ids } = issues.addEchoes(doc, nodeId!, echoes);
    store.logEvent(id!, 'edit', `Added ${ids.length} ${ids.length === 1 ? 'echo' : 'echoes'} — Echoes`);
    return { ...saved(next), ids };
  }],

  /** Standard sections not currently in the issue, offered back. */
  [/^\/api\/issues\/([^/]+)\/available-sections$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    const present = new Set<string>(doc.nodes.map((n) => String(n.type)));
    return { sections: issues.standardSections().filter((s) => !present.has(s.type)) };
  }],

  [/^\/api\/issues\/([^/]+)\/settings$/, 'POST', async ({ body }, [id]) => {
    const b = await body();
    let doc = requireIssue(id!);
    // Number, date and window are the edition's identity. On a published
    // issue each saved at once, and the next re-send published a different
    // edition: a renumber forked the site page, emails.json, the feed (a
    // second guid for the same mp3) and the archive (review 2026-09-27,
    // §2.5). Title and dek stay editable: they are fixes a re-send carries.
    const fixed = (['number', 'publication_date', 'window_days'] as const).filter((k) => b[k] !== undefined);
    if (fixed.length && doc.issue.status !== 'draft') {
      throw new HttpError(409,
        `WT${doc.issue.number} is published — its number, date and window are fixed, because a re-send would publish a different edition`);
    }
    if (b.number !== undefined) {
      const number = Number(b.number);
      if (!Number.isFinite(number) || number <= 0) throw new HttpError(400, 'invalid issue number');
      const existing = store.getIssueByNumber(Math.round(number));
      if (existing && existing.id !== id) throw new HttpError(409, `issue ${Math.round(number)} already exists`);
      doc = issues.setIssueNumber(doc, number);
    }
    if (b.publication_date) doc = issues.setPublicationDate(doc, String(b.publication_date));
    if (b.window_days !== undefined) doc = issues.setWindowDays(doc, Number(b.window_days));
    if (b.title !== undefined) doc.issue.title = String(b.title);
    if (b.dek !== undefined) doc.issue.dek = String(b.dek);
    const parts = [
      b.number !== undefined ? `number → ${doc.issue.number}` : '',
      b.publication_date ? `publishes → ${doc.issue.publication_date}` : '',
      b.window_days !== undefined ? `window → ${doc.issue.window_days} days` : '',
      b.title !== undefined ? 'title' : '',
      b.dek !== undefined ? 'dek' : '',
    ].filter(Boolean);
    if (parts.length) store.logEvent(id!, 'settings', `Settings — ${parts.join(', ')}`);
    return saved(doc);
  }],

  /**
   * Push an item's working values back to where it came from, compare-and-set:
   * a source record that moved since the base is `conflict`, not overwritten.
   * Pinboard and Micro.blog both write; the local edit always stands and only
   * `sync_state` records the outcome.
   */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/writeback$/, 'POST', async (_ctx, [id, itemId]) => {
    const { response, result } = await writeBack(id!, itemId!);
    return { ...response, result };
  }],

  /**
   * The way out of `conflict`: Keep mine writes the local copy over the
   * source as it stands now; Take theirs adopts the source's fields. Both
   * read the source first, and a read that fails changes nothing.
   */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/(keep-mine|take-theirs)$/, 'POST', async (_ctx, [id, itemId, choice]) => {
    const item = requireIssue(id!).items[itemId!];
    if (!item) throw new HttpError(404, `no item ${itemId}`);
    if (item.sync_state !== 'conflict') {
      throw new HttpError(409, `${issues.itemName(item)} is not in conflict (${item.sync_state ?? 'no sync state'})`);
    }
    const remote = await readSource(item);
    // An issue put to bed while the source was read is frozen: the choice
    // is refused as the door would refuse it, and nothing changes
    // (cross-batch review of review-fixes, Batch 2 x Batch 7).
    const meanwhile = `${item.source} was read`;
    if (remote === null) {
      const response = savedFresh(id!, (d) => issues.updateItem(awake(d, meanwhile), itemId!, {
        sync_state: 'gone', sync_error: `deleted at ${item.source} — not recreating it`,
      }));
      store.logEvent(id!, 'sync', `Deleted at ${item.source} — ${issues.itemName(item)}`, itemId);
      return response;
    }
    // The choice was made about the copy read above. One that moved while
    // the source was read — edited, or no longer in conflict — is not the
    // one Jamie chose about, and Take theirs would overwrite the new edit
    // (Batch 2 review round 1, follow-up 3).
    const unmoved = (d: IssueDoc): IssueDoc => {
      awake(d, meanwhile);
      const fresh = d.items[itemId!];
      if (!fresh || fresh.sync_state !== 'conflict' || !holds(fresh, item)) {
        throw new HttpError(409,
          `${issues.itemName(item)} changed while ${item.source} was read — nothing changed; look again and choose`);
      }
      return d;
    };
    if (choice === 'take-theirs') {
      const response = savedFresh(id!, (d) => issues.takeTheirs(unmoved(d), itemId!, remote));
      store.logEvent(id!, 'sync', `Took ${item.source}'s copy — ${issues.itemName(item)}`, itemId);
      return response;
    }
    savedFresh(id!, (d) => issues.keepMine(unmoved(d), itemId!, remote));
    store.logEvent(id!, 'sync', `Kept this copy over ${item.source}'s — ${issues.itemName(item)}`, itemId);
    const { response, result } = await writeBack(id!, itemId!);
    return { ...response, result };
  }],

  /**
   * Move a link between Notable and Briefly. One editorial gesture with a
   * source-side half: Briefly is the `_brief` tag on the bookmark, so the
   * move adjusts the tags and immediately writes them back to Pinboard —
   * the builder and the bookmark must agree on what the link is.
   */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/section$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const target = b.target as 'Notable' | 'Briefly';
    if (target !== 'Notable' && target !== 'Briefly') {
      throw new HttpError(400, 'target must be Notable or Briefly');
    }
    const doc = requireIssue(id!);
    const item = doc.items[itemId!];
    if (!item) throw new HttpError(404, `no item ${itemId}`);
    if (item.type !== 'pinboard_link') {
      throw new HttpError(400, 'only links move between Notable and Briefly');
    }
    const dest = doc.nodes.find(
      (n) => n.kind === 'section' && n.label.toLowerCase() === target.toLowerCase(),
    );
    if (!dest) throw new HttpError(400, `this issue has no ${target} section`);
    // Already there: nothing to do.
    if (dest.items.includes(itemId!)) return saved(doc);

    const moved = issues.moveLinkToSection(doc, itemId!, target);
    store.logEvent(id!, 'structure', `Moved to ${target} — ${issues.itemName(item)}`, itemId);

    // The move marks the item `syncing` only when the tags actually changed;
    // a `gone` bookmark moves locally and is never re-created at the source.
    if (moved.items[itemId!]?.sync_state === 'syncing') {
      // The move is saved now; the write-back's outcome lands on a fresh read.
      saved(moved);
      const { response, result } = await writeBack(id!, itemId!);
      return { ...response, result };
    }
    return saved(moved);
  }],

  /**
   * Editorial review. Two passes — proofing first, then judgement against the
   * last 8 issues. Each review replaces the last; a failure leaves the previous
   * notes in place and says so.
   */
  [/^\/api\/issues\/([^/]+)\/review$/, 'POST', async ({ body }, [id]) => {
    const b = await body();
    const doc = requireIssue(id!);

    // The judgement pass compares against what actually shipped.
    const recentIssues = store
      .listIssues()
      .filter((r) => r.doc.issue.status === 'published' && r.number < doc.issue.number)
      .slice(0, editorial.ARCHIVE_ISSUES)
      .map((r) => ({ number: r.number, rendered: render(r.doc, 'website') }));

    const result = await editorial.review({
      doc,
      recentIssues,
      only: b.only,
      // The review being replaced: a pass that does not run this time keeps
      // its notes from here instead of losing them.
      previous: doc.review as editorial.Review | undefined,
    });
    store.logEvent(id!, 'review', 'Editorial review ran');
    return { ...savedFresh(id!, (d) => { d.review = result; }), review: result };
  }],

  /**
   * A photo dropped on the canvas. Resized, stored on the CDN, and the fields
   * the camera recorded are seeded — all of them stay editable.
   */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/photo$/, 'POST', async ({ req, raw }, [id, itemId]) => {
    const doc = requireIssue(id!);
    const item = doc.items[itemId!];
    if (!item) throw new HttpError(404, `no item ${itemId}`);

    const bytes = await raw();
    if (!bytes.length) throw new HttpError(400, 'no image in the request');

    const filename = String(req.headers['x-filename'] ?? 'photo.jpg');
    const stored = await storeUpload(bytes, doc.issue.number, filename);

    // A place name reads better than coordinates in print (Jamie, 2026-09-03).
    // Best-effort: a failed geocode keeps the coordinates — true either way,
    // and the field stays editable, so a wrong name never survives review.
    const place = stored.coordinates
      ? (await geocode.placeName(stored.coordinates)) ?? stored.coordinates
      : undefined;

    store.logEvent(id!, 'edit', `Photo uploaded — ${filename}`, itemId);
    // Seconds of upload and geocoding have passed: the item is re-read.
    const result = savedFresh(id!, (d) => {
      const fresh = d.items[itemId!];
      if (!fresh) throw new HttpError(404, `no item ${itemId}`);
      // The time and place are facts about the file, so a replacement photo
      // brings its own and the old photo's stop applying — a new picture under
      // last week's timestamp is wrong twice (Jamie, 2026-09-20). Jamie's words
      // — alt and caption — describe what he sees and are kept across a swap.
      const carried = fresh.media?.url ? undefined : fresh.media;
      fresh.media = {
        ...(fresh.media ?? {}),
        url: stored.url,
        // Seeded, not imposed: an empty alt is a real accessibility problem, and
        // a filename is a better starting point than nothing.
        alt: fresh.media?.alt || filename.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '),
        timestamp: carried?.timestamp || stored.takenAt || undefined,
        location: carried?.location || place,
        // Kept beside the name: the published metadata line links the place
        // to the exact spot on the map.
        coordinates: carried?.coordinates || stored.coordinates || undefined,
      };
    });
    return { ...result, image: stored };
  }],

  /**
   * A proposed order for a link section. Never applied here — Jamie sees the
   * sequence beside the current one and applies it, or not.
   */
  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/order$/, 'POST', async (_ctx, [id, nodeId]) => {
    const doc = requireIssue(id!);
    const node = doc.nodes.find((n) => n.id === nodeId);
    if (!node) throw new HttpError(404, `no section ${nodeId}`);
    const w = windowOf(doc);
    const ids = node.items.filter((itemId) => {
      const item = doc.items[itemId];
      return item && item.type === 'pinboard_link' && !outOfWindow(item, w) && !heldOut(item);
    });
    const suggestion = await editorial.suggestOrder(doc, nodeId!, ids);
    return { ...suggestion, current: ids };
  }],

  /** Apply an order to a section — the answer to the suggestion above, or a drag. */
  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/reorder$/, 'POST', async ({ body }, [id, nodeId]) => {
    const b = await body();
    const order = Array.isArray(b.order) ? (b.order as unknown[]).map(String) : [];
    if (!order.length) throw new HttpError(400, 'order must name the items');
    const doc = requireIssue(id!);
    const node = doc.nodes.find((n) => n.id === nodeId);
    if (!node) throw new HttpError(404, `no section ${nodeId}`);
    store.logEvent(id!, 'structure', `Reordered ${node.label}${typeof b.why === 'string' && b.why ? ` — ${b.why}` : ''}`);
    return saved(issues.setItemOrder(doc, nodeId!, order));
  }],

  /** Candidate text for one item. Never written — Jamie picks or ignores. */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/draft$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const doc = requireIssue(id!);
    const type = doc.items[itemId!]?.type;
    const result = await editorial.draft({
      doc,
      itemId: itemId!,
      context: b.context,
      seasonal: type === 'echoes' || type === 'echo' ? seasonalFor(doc) : undefined,
      thingy: type === 'echoes' || type === 'echo' || type === 'pinboard_link' ? thingySentences() : undefined,
    });
    return result;
  }],

  /**
   * The Echoes section wand: echoes to append, offered for the node rather
   * than for an item. Nothing is written — the ticked ones come back through
   * POST /nodes/:id/echoes.
   */
  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/echoes\/draft$/, 'POST', async (_ctx, [id, nodeId]) => {
    const doc = requireIssue(id!);
    const node = doc.nodes.find((n) => n.id === nodeId);
    if (!node) throw new HttpError(404, `no section ${nodeId}`);
    if (node.type !== 'echoes') throw new HttpError(400, `${node.label} does not hold echoes`);
    return editorial.draft({ doc, nodeId: nodeId!, seasonal: seasonalFor(doc), thingy: thingySentences() });
  }],

  /**
   * Share the draft: render the website edition to one static page and put
   * it on the CDN at an unguessable URL, loudly labeled DRAFT, with Jamie's
   * note to the reader. Re-sharing refreshes the same URL.
   */
  [/^\/api\/issues\/([^/]+)\/share$/, 'POST', async ({ body }, [id]) => {
    const b = await body();
    const doc = requireIssue(id!);
    const share = await draftShare.share(doc, typeof b.note === 'string' ? b.note : undefined);
    store.logEvent(id!, 'send', `Draft shared — ${share.url}`);
    return { ...savedFresh(id!, (d) => { d.draft_share = share; }), share };
  }],

  /** Stop sharing: delete the page. `no-store` makes revocation prompt. */
  [/^\/api\/issues\/([^/]+)\/share$/, 'DELETE', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    if (doc.draft_share) {
      await draftShare.unshare(doc);
      store.logEvent(id!, 'send', 'Draft share stopped');
      return savedFresh(id!, (d) => { delete d.draft_share; });
    }
    return saved(doc);
  }],

  /** What the website handoff would change, changing nothing. */
  [/^\/api\/issues\/([^/]+)\/send\/website\/preview$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    const files = siteInputs(doc, websiteOptions(doc, await currentSiteEmails()));
    const result = await githubRepo.diff(files, { branch: config.websiteBranch });
    return { repo: config.websiteRepo, ...result, files: files.map((f) => f.path) };
  }],

  /**
   * What the archive feed would commit, committing nothing. The website leg
   * has this because a real commit publishes; the archive leg has it because
   * a real commit puts draft text in the corpus Thingy answers from.
   */
  [/^\/api\/issues\/([^/]+)\/send\/archive\/preview$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    const files = archiveInputs(doc, emailRecord(doc));
    const result = await githubRepo.diff(files, {
      repo: config.archiveRepo,
      branch: config.archiveBranch,
    });
    return { repo: config.archiveRepo, ...result, files: files.map((f) => f.path) };
  }],

  /** Copy every remote image onto the CDN, resized. Safe to run repeatedly. */
  [/^\/api\/issues\/([^/]+)\/images\/rehost$/, 'POST', async (_ctx, [id]) => {
    const { report, mapping } = await rehostIssueImages(requireIssue(id!));
    store.logEvent(id!, 'send', 'Images rehosted to the CDN');
    return { ...savedFresh(id!, (d) => applyRehost(d, mapping)), report };
  }],

  /**
   * Send, per destination. A failed send stops at its own leg and can be
   * resumed; the other legs are untouched (docs/publishing-lifecycle.md).
   *
   * This dispatch has been severed once before — a QA-fix commit reverted it
   * to a Buttondown-only guard while the client still offered every leg.
   * tests/routes.test.ts exercises it over HTTP so that cannot happen quietly.
   */
  /**
   * How long the issue took, from its event log, beside the issue before it
   * that was made in WT Builder, and what shipped in WT Builder between the
   * two — so a feature's effect on the time can be seen (Jamie, WT351).
   */
  [/^\/api\/issues\/([^/]+)\/timing$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    const timing = timingOf(id!)!;
    const prevRow = store.listIssues()
      .filter((r) => r.number < doc.issue.number && !r.doc.issue.imported)
      .sort((a, b) => b.number - a.number)[0];
    const previous = prevRow ? { number: prevRow.number, timing: timingOf(prevRow.id)! } : null;
    const since = previous?.timing.publishedAt;
    // Up to when this issue went out: what it was made with, fixes made
    // during the build included.
    const until = timing.publishedAt ?? new Date().toISOString();
    const shipped = since ? await shippedBetween(since, until) : [];
    return { timing, previous, shipped };
  }],

  /**
   * Put to bed, or wake. Putting to bed is for a published issue — both
   * reader-facing legs out — and is Jamie's click, never automatic: WT350
   * needed fixes and re-sends after publishing.
   */
  [/^\/api\/issues\/([^/]+)\/bed$/, 'POST', async ({ body }, [id]) => {
    const b = await body();
    const doc = requireIssue(id!);
    const asleep = b.asleep !== false;
    if (asleep && doc.issue.status !== 'published') {
      throw new HttpError(400, 'only a published issue can be put to bed — send the website and Buttondown first');
    }
    store.logEvent(id!, 'issue', asleep ? `Put to bed — WT${doc.issue.number}` : `Woken — WT${doc.issue.number}`);
    return savedFresh(id!, (d) => {
      if (asleep) d.issue.put_to_bed_at = new Date().toISOString();
      else delete d.issue.put_to_bed_at;
    });
  }],

  /**
   * The podcast gate. `review` has a model read the spoken script and report
   * what will sound wrong; `approve` records Jamie's go-ahead for the script
   * that was read. Both are tied to the script's hash, so an edit after the
   * review shows as a changed script, not a stale approval.
   */
  [/^\/api\/issues\/([^/]+)\/script\/(review|approve)$/, 'POST', async (_ctx, [id, action]) => {
    const doc = requireIssue(id!);
    const blocks = audioScript(doc);
    const hash = scriptHash(blocks);
    if (action === 'approve') {
      const current = doc.script_review;
      if (!current || current.script_hash !== hash) throw new HttpError(409, 'the script has changed since it was read — read it again first');
      return savedFresh(id!, (d) => { d.script_review = { ...current, approved_at: new Date().toISOString() }; });
    }
    const r = await editorial.reviewScript(blocks);
    store.logEvent(id!, 'review', `Script read — ${r.verdict === 'ready' ? 'ready' : `${r.findings.length} to look at`}`);
    return savedFresh(id!, (d) => {
      d.script_review = { at: new Date().toISOString(), script_hash: hash, verdict: r.verdict, summary: r.summary, findings: r.findings };
    });
  }],

  /**
   * Verify a leg again, on demand. Returns at once with the leg marked
   * `running`; the result lands on the issue when the checks finish.
   */
  [/^\/api\/issues\/([^/]+)\/verify\/([a-z]+)$/, 'POST', async (_ctx, [id, dest]) => {
    const destination = dest as Destination;
    if (!verifierFor(destination)) throw new HttpError(400, `${destination} has no verification`);
    const doc = requireIssue(id!);
    if (doc.sends?.[destination]?.status !== 'sent') throw new HttpError(400, `${destination} has not been sent`);
    void runVerify(id!, destination).catch(() => { /* recorded inside */ });
    return { issue: store.getIssue(id!)?.doc };
  }],

  [/^\/api\/issues\/([^/]+)\/send\/([a-z]+)$/, 'POST', async ({ url }, [id, dest]) => {
    const destination = dest as Destination;
    const force = url.searchParams.get('force') === '1';
    if (destination === 'website') {
      const out = await loggedSend(id!, 'website', () => sendWebsite(id!, force));
      verifyAfterSend(id!, 'website');
      return out;
    }
    if (destination === 'podcast') {
      const out = await loggedSend(id!, 'podcast', () => sendPodcast(id!));
      verifyAfterSend(id!, 'podcast');
      return out;
    }
    if (destination === 'archive') {
      const out = await loggedSend(id!, 'archive', () => sendArchive(id!));
      verifyAfterSend(id!, 'archive');
      return out;
    }
    if (destination !== 'buttondown') {
      throw new HttpError(400, `unknown destination ${destination}`);
    }
    const before = requireIssue(id!);
    guardInFlight(before, 'buttondown');
    // The draft this leg made last, read through any failed or cut-off
    // attempt since: a retry updates it and never creates a second draft
    // (review 2026-09-27 §2.1).
    const previous = before.sends?.buttondown;
    const draftId = emailOf(previous).id;
    const release = claimLeg(id!, destination, { external_id: draftId });
    // Set back exactly as it was when Buttondown's answer refuses the send.
    // Only this leg's record is written, and the claim keeps every other
    // writer of it out while the status is read.
    // The leg is untouched, but the refusal is logged, so `npm run watch`
    // shows why nothing happened.
    const refuse = (message: string, code?: string): never => {
      store.recordSend(id!, destination, previous ?? { status: 'none' });
      store.logEvent(id!, 'send', `Send refused — buttondown: ${message}`);
      throw new Refusal(409, message, code);
    };
    const webCopy = url.searchParams.get('web_copy') === '1';
    try {
      // What the email is now, before anything is changed: a PATCH while
      // Buttondown is delivering it races the delivery, and one after it
      // has gone rewrites a sent email (review 2026-09-27 §8 #7).
      if (draftId) {
        const email = await buttondown.getEmail(draftId);
        if (email.status === 'about_to_send' || email.status === 'in_flight') {
          refuse(`Buttondown is delivering it now (${email.status}) — nothing was changed. Try again once it has gone.`);
        }
        if (email.status === 'sent' && !webCopy) {
          // What Buttondown just said is recorded where the card reads it, so
          // the card offers "Update web copy…" now, even when the last check
          // predates remote_status (WT350, WT351) or never ran. recordVerify,
          // not a document save: a fresh read with no await and no revision,
          // so a refused click never pushes a real edit out of the history.
          // With no check behind it, only that fact is recorded — never a
          // pass — and the real check is started once the leg is set back.
          const checked = store.getIssue(id!)?.doc.verify?.buttondown;
          store.recordVerify(id!, 'buttondown', checked
            ? { ...checked, remote_status: 'sent' }
            : refusedAsSent(new Date().toISOString()));
          if (!checked) setImmediate(() => verifyAfterSend(id!, 'buttondown'));
          refuse(`WT${before.issue.number}'s email has already gone to readers — nothing was changed. "Update web copy…" (POST ?web_copy=1) changes only the copy on Buttondown's archive.`, 'email_sent');
        }
        if (email.status !== 'draft' && email.status !== 'scheduled' && email.status !== 'sent') {
          refuse(`Buttondown says the email is "${email.status}" — nothing was changed.`);
        }
        if (email.status === 'sent') {
          console.log(`[send] WT${before.issue.number}: updating the web copy of email ${draftId}, which has already been sent`);
          store.logEvent(id!, 'send', 'Web copy update started — buttondown (the email had already gone)');
        }
      }
      store.logEvent(id!, 'send', 'Send started — buttondown');
      // Rehost first: the email is where image weight actually hurts, and the
      // rewritten URLs must be in the document before the body is rendered.
      const { report: images, mapping } = await rehostIssueImages(requireIssue(id!));
      const doc = savedFresh(id!, (d) => applyRehost(d, mapping)).issue;
      // The email's subject is the issue's, "WT350 — Title", not the bare title,
      // with any template tag in it broken the way the body's are.
      const subject = emailSubject(doc);
      const body = renderEmail(doc);
      const draft = draftId
        ? await buttondown.updateDraft(draftId, subject, body)
        : await buttondown.createDraft(subject, body);
      const state: SendState = {
        status: 'sent',
        at: new Date().toISOString(),
        external_id: draft.id,
        url: draft.url,
        edit_url: draft.edit_url,
      };
      const row = store.recordSend(id!, destination, state);
      store.logEvent(id!, 'send', 'Send finished — buttondown (draft, never scheduled)');
      verifyAfterSend(id!, 'buttondown');
      return { issue: row?.doc, send: state, images };
    } catch (err) {
      if (err instanceof Refusal) throw err;
      const state: SendState = {
        status: 'failed',
        at: new Date().toISOString(),
        error: (err as Error).message,
        external_id: draftId,
      };
      store.recordSend(id!, destination, state);
      store.logEvent(id!, 'send', `Send failed — buttondown: ${state.error}`);
      throw new HttpError(502, state.error!);
    } finally {
      release();
    }
  }],
];


// ── send legs ─────────────────────────────────────────────────────────────

/**
 * The site's own archive can only grow. A parsed emails.json below this floor
 * means a truncated or wrong file, and merging into one would re-lose the
 * archive the 2026-08-30 revert restored — refuse instead. The floor is the
 * last published issue, since every issue before it has an entry (numbered
 * 1 on, no gaps), and never below the 349 the pre-Builder archive holds: a
 * fixed 349 weakened by one issue every week (review 2026-09-27 §7).
 */
const PREBUILDER_ARCHIVE_ENTRIES = 349;
function archiveFloor(): number {
  return Math.max(PREBUILDER_ARCHIVE_ENTRIES, store.lastPublishedNumber());
}

const SITE_EMAILS = 'apps/site/_data/emails.json';

/**
 * The site's emails.json, parsed — the merge base the handoff must preserve.
 * Rebuilding the index from the Builder's own records gutted it once (104k
 * lines to 10k, commit 91688fc7, reverted): the Shortcuts-era entries carry
 * links, audio, slugs, and ids the imported records cannot reproduce. Any
 * doubt about the file refuses the send rather than rewriting blind.
 */
function parseSiteEmails(raw: string | null): IssueEntry[] {
  if (raw === null) {
    throw new HttpError(502, "the site's emails.json is missing from the repo — refusing to rewrite the index blind");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(502, "the site's emails.json did not parse — refusing to rewrite the index blind");
  }
  const floor = archiveFloor();
  if (!Array.isArray(parsed) || parsed.length < floor) {
    throw new HttpError(502, `the site's emails.json has ${Array.isArray(parsed) ? parsed.length : 'no'} entries, below the ${floor} the archive is known to hold — refusing to merge into a truncated index`);
  }
  return parsed as IssueEntry[];
}

/** The site's live emails.json, for the preview. The send merges inside its commit instead. */
async function currentSiteEmails(): Promise<IssueEntry[]> {
  return parseSiteEmails(await githubRepo.readFile(SITE_EMAILS, { branch: config.websiteBranch }));
}

/**
 * The email's id and archive URL as the page and the archive record them:
 * from Buttondown's last good send, so a failing update does not drop them,
 * and read as the Buttondown retry reads them (`emailOf`).
 */
function emailRecord(doc: IssueDoc): { buttondownId?: string; absoluteUrl?: string } {
  const email = emailOf(doc.sends?.buttondown);
  return { buttondownId: email.id, absoluteUrl: email.url };
}

/**
 * What the page embeds besides the issue. The audio is the podcast's last
 * good send: a failed re-render must not take the episode off the page and
 * out of the feed (review 2026-09-27 §2.1).
 */
function websiteOptions(doc: IssueDoc, currentEmails: IssueEntry[]) {
  return {
    ...emailRecord(doc),
    audio: lastSent(doc.sends?.podcast)?.audio as never,
    currentEmails,
  };
}

/** Why the website cannot embed an episode yet, saying what the podcast leg actually did. */
function noAudioYet(podcast: SendState | undefined): string {
  const escape = 'Send the podcast first, or POST ?force=1 to ship without audio.';
  if (lastSent(podcast)) {
    return `the podcast leg's last send recorded no audio reference for the page. ${escape}`;
  }
  if (podcast?.status === 'failed') {
    return `the podcast leg ran and failed, so there is no audio to embed yet (${podcast.error ?? 'no error recorded'}). ${escape}`;
  }
  if (podcast?.status === 'sending') {
    return 'the podcast leg is still sending — the page embeds its audio, so wait for it to finish.';
  }
  return `the podcast leg has not run — its audio reference belongs in the page. ${escape}`;
}

/**
 * Commit the generated 11ty inputs to the render surface as one commit. The
 * site builds and deploys from there; nothing here touches the live site.
 */
async function sendWebsite(id: string, force = false) {
  const doc = requireIssue(id);
  guardInFlight(doc, 'website');
  // The website page embeds the podcast's audio reference; committed without
  // it, the issue ships to readers with no episode and a green SENT. The
  // client says the podcast should run first — this makes it true. The gate
  // is "an audio reference is recorded", not the podcast's status: a failed
  // re-render leaves the last episode on the CDN and in last_sent, and the
  // page keeps embedding it (review 2026-09-27 §2.1). `?force=1` is the
  // deliberate escape for an issue that really has no audio, and is offered
  // only then.
  if (!force && !recordedAudioUrl(doc.sends)) {
    throw new HttpError(409, noAudioYet(doc.sends?.podcast));
  }
  const release = claimLeg(id, 'website');
  try {
    // The page must not hotlink: every image the issue references is on the CDN
    // before the page is rendered (content-addressed; a second run is free).
    // The page renders from the copy the rehost map was saved to, as the
    // Buttondown leg does: rendering the copy read before the rehost shipped
    // every new Journal photo as the original (review 2026-09-27 §2.2).
    const { mapping } = await rehostIssueImages(requireIssue(id));
    const fresh = savedFresh(id, (d) => applyRehost(d, mapping)).issue;
    // emails.json is merged into the file as it stands when the commit is
    // made, not as it was read before the rehost: another issue's website
    // leg (the in-flight guard is per issue) or any other commit to the site
    // can change it meanwhile, and a merge against an earlier read — or a
    // ref-race retry that reused it — would put its stale copy over theirs
    // (review 2026-09-27, appendix: Sending & verify). The page does not
    // depend on the index.
    const inputsWith = (emails: IssueEntry[]) => siteInputs(fresh, websiteOptions(fresh, emails));
    const result = await githubRepo.editTree(
      inputsWith([]).map((f) => f.path),
      (path, current) =>
        inputsWith(path === SITE_EMAILS ? parseSiteEmails(current) : []).find((f) => f.path === path)!.content,
      `Add issue ${fresh.issue.number} from WT Builder`,
      { branch: config.websiteBranch },
    );
    const state: SendState = {
      status: 'sent',
      at: new Date().toISOString(),
      external_id: result.sha,
      url: `https://github.com/${config.websiteRepo}/commit/${result.sha}`,
    };
    const row = store.recordSend(id, 'website', state);

    // A published issue must not keep serving a page that shouts DRAFT. Best
    // effort: the URL is unguessable either way, and Unshare remains.
    if (row?.doc.draft_share) {
      try {
        await draftShare.unshare(row.doc);
        savedFresh(id, (d) => { delete d.draft_share; });
        store.logEvent(id, 'send', 'Draft share retired — the issue published');
      } catch (e) {
        console.warn(`[share] retiring the draft share failed: ${(e as Error).message}`);
      }
    }

    return { issue: row?.doc, send: state, changed: result.changed, committed: result.committed };
  } catch (err) {
    const state: SendState = {
      status: 'failed',
      at: new Date().toISOString(),
      error: (err as Error).message,
    };
    store.recordSend(id, 'website', state);
    throw new HttpError(502, state.error!);
  } finally {
    release();
  }
}

/**
 * The podcast speaks only the script Jamie approved: the review and the
 * approval are tied to the script's hash, and the server holds the leg to
 * them as the Send view does, so a request that skips the view cannot
 * synthesize an unread script (review 2026-09-27, appendix: Audio). A
 * podcast already sent re-synthesizes without asking again, as the view
 * allows.
 */
function guardScriptApproved(doc: IssueDoc): void {
  if (doc.sends?.podcast?.status === 'sent') return;
  const review = doc.script_review;
  if (!review?.approved_at) throw new HttpError(409, 'the podcast script has not been approved — read it and approve it first');
  if (review.script_hash !== scriptHash(audioScript(doc))) {
    throw new HttpError(409, 'the script has changed since it was approved — read it again and approve it first');
  }
}

/**
 * Render the script, synthesize it, and upload the mp3 to the CDN. The website
 * publishes the reference; the file lives only on the CDN.
 */
async function sendPodcast(id: string) {
  const doc = requireIssue(id);
  guardInFlight(doc, 'podcast');
  guardScriptApproved(doc);
  const release = claimLeg(id, 'podcast');
  try {
    // Blocks, not a flat script: each is synthesized in its speaker's voice
    // and placed with the pause its boundary calls for.
    const result = await audio.renderAudio(audio.episodeOf(doc), audioScript(doc));
    const state: SendState = {
      status: 'sent',
      at: new Date().toISOString(),
      external_id: result.url,
      url: result.url,
      audio: {
        audio_url: result.url,
        audio_duration_seconds: result.durationSeconds,
        audio_byte_size: result.bytes,
        audio_voice: result.voice,
        audio_chapters_url: result.chaptersUrl,
        audio_transcript_url: result.transcriptUrl,
        audio_chapters: result.chapters,
      },
    };
    const row = store.recordSend(id, 'podcast', state);
    return { issue: row?.doc, send: state, pieces: result.pieces, synthesized: result.synthesized, cover: result.coverSource };
  } catch (err) {
    const state: SendState = {
      status: 'failed',
      at: new Date().toISOString(),
      error: (err as Error).message,
    };
    store.recordSend(id, 'podcast', state);
    throw new HttpError(502, state.error!);
  } finally {
    release();
  }
}

/**
 * Feed the issue's text to the archive — the corpus the Librarian API answers
 * from. Not publishing (docs/decisions.md): it runs after the issue is out,
 * never gates it, and a failure leaves the issue published and Thingy stale.
 * The archive repository's CI rebuilds and uploads the corpus on this commit.
 */
async function sendArchive(id: string) {
  const doc = requireIssue(id);
  guardInFlight(doc, 'archive');
  const release = claimLeg(id, 'archive');
  try {
    const files = archiveInputs(doc, emailRecord(doc));
    const result = await githubRepo.putTree(
      files,
      `Archive issue ${doc.issue.number} from WT Builder`,
      { repo: config.archiveRepo, branch: config.archiveBranch },
    );
    const state: SendState = {
      status: 'sent',
      at: new Date().toISOString(),
      external_id: result.sha,
      url: `https://github.com/${config.archiveRepo}/commit/${result.sha}`,
    };
    const row = store.recordSend(id, 'archive', state);
    return { issue: row?.doc, send: state, changed: result.changed, committed: result.committed };
  } catch (err) {
    const state: SendState = {
      status: 'failed',
      at: new Date().toISOString(),
      error: (err as Error).message,
    };
    store.recordSend(id, 'archive', state);
    throw new HttpError(502, state.error!);
  } finally {
    release();
  }
}

// ── static client ─────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

async function serveStatic(url: URL, res: ServerResponse): Promise<boolean> {
  if (!existsSync(DIST)) return false;
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) return false;
  // A built asset that is not here is from another build: an open tab after
  // a deploy asks for its old chunks. It is a 404, not the shell, which a
  // lazy import used to parse as JavaScript (review 2026-09-27 §2.4).
  if (rel.startsWith('/assets/') && !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found: this asset belongs to another build of WT Builder. Reload the page.');
    return true;
  }
  if (!existsSync(file) || rel === '/' || rel === '\\') file = join(DIST, 'index.html');
  if (!existsSync(file)) return false;
  const data = await readFile(file);
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(data);
  return true;
}

// ── server ────────────────────────────────────────────────────────────────

/** The port this server is listening on: config.port as the service, 0→any in tests. */
function listeningPort(): number {
  const addr = server.address();
  return addr && typeof addr === 'object' ? addr.port : config.port;
}

/**
 * The edge, beside guardBed and before routing (edge.ts): a request
 * addressed to a name that is not this service is a 421, whatever its
 * method, and a write from another site is a 403. Every 403 and 421 is
 * logged with the value refused, so a proxy the lists do not know shows up
 * in the service log.
 */
function guardEdge(req: IncomingMessage, method: string, pathname: string): void {
  const port = listeningPort();
  const misdirected = edge.hostRefusal(req.headers, edge.allowedHosts(port, config.allowedHosts));
  if (misdirected) {
    console.warn(`[edge] 421 ${method} ${pathname}: ${misdirected}`);
    throw new HttpError(421, misdirected);
  }
  const refusal = edge.crossSiteRefusal(method, req.headers, edge.allowedOrigins(port), config.allowedOrigins);
  if (refusal) {
    console.warn(`[edge] 403 ${method} ${pathname}: ${refusal}`);
    throw new HttpError(403, refusal);
  }
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  // Parsed inside the try, against a fixed base: the Host header is not a URL
  // and the request target need not be one either. `Host: a b` once threw
  // here, outside the try, and killed the process (review 2026-09-27, §1.6).
  let url: URL | undefined;

  try {
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      throw new HttpError(400, 'the request target is not a URL');
    }
    guardEdge(req, method, url.pathname);
    guardBed(method, url.pathname);
    for (const [pattern, verb, handler] of routes) {
      const match = pattern.exec(url.pathname);
      if (!match || verb !== method) continue;
      const params = match.slice(1).map((p) => decodeURIComponent(p));
      const result = await handler(
        { req, res, url, body: () => readBody(req), raw: () => readRaw(req) },
        params,
      );
      return json(res, 200, result);
    }

    // The API answers for itself. Without this guard the SPA fallback below
    // serves index.html for an unmatched /api/ path, and the client parses
    // HTML as JSON instead of seeing a 404.
    if (url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: `no route for ${method} ${url.pathname}` });
    }

    if (method === 'GET' && (await serveStatic(url, res))) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Run `npm run build`, or use the Vite dev server.');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = (err as Error).message ?? 'unknown error';
    if (status >= 500) console.error(`[${method} ${url?.pathname ?? req.url}] ${message}`);
    const code = err instanceof HttpError ? err.code : undefined;
    json(res, status, code ? { error: message, code } : { error: message });
  }
});

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (isMain !== false) {
  store.openDb();
  server.listen(config.port, config.host, () => {
    // First, and only in the process that holds the port: a second process
    // on the same database (npm run dev, npm start beside the service) whose
    // listen fails must not fail the live service's legs in flight. The
    // listening callback runs on the tick the bind succeeds, before the loop
    // accepts a connection, so no request sees a stale `sending`.
    failInterruptedSends();
    // Only once it is serving: a failure to boot (the offline guard refusing
    // the live database, a port in use) must still exit.
    logStrayErrors();
    console.log(`WT Builder on http://${config.host}:${config.port}`);
    for (const [k, v] of Object.entries(describeConfig())) console.log(`  ${k}: ${v}`);
    void finishStrandedWrites();
    resumeRechecks();
  });
}

/**
 * An error nothing awaited is logged, and the service keeps running. Exiting
 * mid-send strands the leg in `sending` for ten minutes and takes the editor
 * away from Jamie until launchd restarts it; a logged error costs neither
 * (review 2026-09-27, §1.6). Installed only once this file is running as
 * the service and listening, never when a test imports it, and never before
 * boot has finished: a service that cannot start must still exit.
 */
export function logStrayErrors(proc: Pick<NodeJS.Process, 'on'> = process): void {
  proc.on('uncaughtException', (err: Error) => {
    console.error(`[process] uncaught exception, still running: ${err?.stack ?? err}`);
  });
  proc.on('unhandledRejection', (reason: unknown) => {
    console.error(`[process] unhandled rejection, still running: ${(reason as Error)?.stack ?? reason}`);
  });
}

/**
 * A restart between "saved" and "written to the source" leaves an item in
 * `syncing` with nothing writing (a deploy landed in the same second as an
 * edit, 2026-09-20). On boot, every such item gets its write unless its
 * issue is frozen — put to bed, or an imported record (Page.tsx isFrozen).
 * A published issue that is awake edits as a draft does, so its writes are
 * finished too: skipped, the item stayed `syncing` for good, since a
 * published issue refuses a re-scan and Retry waits out `syncing`.
 */
export async function finishStrandedWrites(): Promise<void> {
  for (const row of store.listIssues()) {
    if (row.doc.issue.put_to_bed_at || row.doc.issue.imported) continue;
    for (const [itemId, item] of Object.entries(row.doc.items)) {
      if (item.sync_state !== 'syncing') continue;
      try {
        const { result } = await writeBack(row.id, itemId);
        store.logEvent(row.id, 'sync', `Finished after restart — ${result.sync_state} — ${issues.itemName(item)}`);
      } catch (e) {
        console.warn(`[boot] stranded write for ${row.id}/${itemId} failed: ${(e as Error).message}`);
      }
    }
  }
}

export { server };
