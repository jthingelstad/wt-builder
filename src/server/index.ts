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

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Channel, Destination, IssueDoc, Item, SendState } from '../shared/types.ts';
import { render } from '../shared/render/index.ts';
import { renderEmail } from '../shared/render/email.ts';
import { config, describeConfig } from './config.ts';
import * as store from './db.ts';
import * as issues from './issue.ts';
import * as buttondown from './integrations/buttondown.ts';
import * as pinboard from './integrations/pinboard.ts';
import * as microblog from './integrations/microblog.ts';
import { rehostIssueImages, storeUpload } from './integrations/images.ts';
import * as editorial from './editorial.ts';
import * as githubRepo from './integrations/github.ts';
import * as audio from './integrations/audio.ts';
import { renderAudio as renderAudioScript } from '../shared/render/audio.ts';
import { archiveInputs, issueEntry, siteInputs, type IssueEntry } from './publish.ts';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: () => Promise<any>;
  raw: () => Promise<Buffer>;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
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
 * Refuse a leg that is already in flight — the client disables its buttons,
 * but two tabs are a documented workflow, and a second POST re-runs paid TTS
 * and re-uploads. A `sending` older than ten minutes is a stranded crash, not
 * an active send, and passes so the leg can be retried.
 */
function guardInFlight(doc: IssueDoc, destination: Destination): void {
  const current = doc.sends?.[destination];
  if (current?.status !== 'sending') return;
  const age = Date.now() - Date.parse(current.at ?? '');
  if (Number.isFinite(age) && age < 10 * 60_000) {
    throw new HttpError(409, `${destination} send already in flight since ${current.at}`);
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
): Promise<{ doc: IssueDoc; result: { sync_state: Item['sync_state']; error?: string } }> {
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
    `Write to ${item.source} — ${result.sync_state}${result.error ? `: ${result.error}` : ''} — ${issues.itemName(item)}`);
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
  return {
    doc: issues.updateItem(doc, itemId, {
      sync_state: result.sync_state,
      sync_error: result.error,
      ...snapshot,
    }),
    result,
  };
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
    const doc = issues.createIssue({
      number,
      publication_date: String(b.publication_date ?? new Date().toISOString().slice(0, 10)),
      window_days: b.window_days ? Number(b.window_days) : 7,
      title: b.title,
      dek: b.dek,
    });
    store.logEvent(doc.issue.id, 'issue', `Issue started — WT${doc.issue.number}, publishes ${doc.issue.publication_date}`);
    return saved(doc);
  }],

  [/^\/api\/issues\/([^/]+)$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    // Repair an older skeleton on the way out, once, and persist it so the
    // repair is visible in the document rather than re-applied on every read.
    const repaired = issues.normalizeSkeleton(doc);
    if (repaired) return saved(repaired);
    return { issue: doc, readiness: issues.readiness(doc) };
  }],

  [/^\/api\/issues\/([^/]+)$/, 'DELETE', async (_ctx, [id]) => {
    store.deleteIssue(id!);
    return { ok: true };
  }],

  // There is deliberately no whole-document PUT. Every mutation is a named
  // operation, so the server never accepts an unvalidated tree — and a stale
  // client copy can never clobber send states recorded since it was loaded.

  [/^\/api\/issues\/([^/]+)\/sweep$/, 'POST', async (_ctx, [id]) => {
    const { doc, report } = await issues.sweep(requireIssue(id!));
    // A quiet re-scan logs nothing; an open re-scans every time and a page of
    // "0 in" lines would bury the log's signal.
    if (report.added || report.refreshed || report.gone || report.conflicts) {
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
    const patch = await body();
    const doc = requireIssue(id!);
    // A silent no-op reads to the client as a saved edit.
    if (!doc.items[itemId!]) throw new HttpError(404, `no item ${itemId}`);
    store.logEvent(id!, 'edit',
      `Edited ${Object.keys(patch).join(', ')} — ${issues.itemName(doc.items[itemId!]!)}`);
    return saved(issues.updateItem(doc, itemId!, patch));
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
        `${channel} ${b.on ? 'on' : 'off'} — ${issues.itemName(item)}`);
    }
    return saved(issues.setChannel(doc, itemId!, channel, Boolean(b.on)));
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/visibility$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const doc = requireIssue(id!);
    const item = doc.items[itemId!];
    if (item) {
      store.logEvent(id!, 'channels',
        `${b.visible ? 'Shown' : 'Hidden'} — ${issues.itemName(item)}`);
    }
    return saved(b.visible ? issues.showItem(doc, itemId!) : issues.hideItem(doc, itemId!));
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/promote$/, 'POST', async (_ctx, [id, itemId]) => {
    const doc = requireIssue(id!);
    const item = doc.items[itemId!];
    if (item) store.logEvent(id!, 'structure', `Promoted — ${issues.itemName(item)}`);
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
          : `Deleted — ${issues.itemName(item)}`);
      }
      return saved(issues.removeItem(doc, nodeId!, itemId!));
    }],

  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/rename$/, 'POST', async ({ body }, [id, nodeId]) => {
    const b = await body();
    const doc = requireIssue(id!);
    const old = doc.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;
    store.logEvent(id!, 'structure', `Renamed section — ${old} → ${String(b.label ?? '')}`);
    return saved(issues.renameSection(doc, nodeId!, String(b.label ?? '')));
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

  /** Standard sections not currently in the issue, offered back. */
  [/^\/api\/issues\/([^/]+)\/available-sections$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    const present = new Set<string>(doc.nodes.map((n) => String(n.type)));
    return { sections: issues.standardSections().filter((s) => !present.has(s.type)) };
  }],

  [/^\/api\/issues\/([^/]+)\/settings$/, 'POST', async ({ body }, [id]) => {
    const b = await body();
    let doc = requireIssue(id!);
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
   * Push an item's working values back to where it came from, last-writer-wins.
   * Pinboard and Micro.blog both write; the local edit always stands and only
   * `sync_state` records the outcome.
   */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/writeback$/, 'POST', async (_ctx, [id, itemId]) => {
    const { doc, result } = await writeItemToSource(id!, requireIssue(id!), itemId!);
    return { ...saved(doc), result };
  }],

  /**
   * Move a link between Notable and Briefly. One editorial gesture with a
   * source-side half: Briefly is the `__brief` tag on the bookmark, so the
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
    if (dest.items.includes(itemId!)) return saved(doc);

    const moved = issues.moveLinkToSection(doc, itemId!, target);
    store.logEvent(id!, 'structure', `Moved to ${target} — ${issues.itemName(item)}`);

    // The move marks the item `syncing` only when the tags actually changed;
    // a `gone` bookmark moves locally and is never re-created at the source.
    if (moved.items[itemId!]?.sync_state === 'syncing') {
      const { doc: synced, result } = await writeItemToSource(id!, moved, itemId!);
      return { ...saved(synced), result };
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
    doc.review = result;
    store.logEvent(id!, 'review', 'Editorial review ran');
    return { ...saved(doc), review: result };
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

    item.media = {
      ...(item.media ?? {}),
      url: stored.url,
      // Seeded, not imposed: an empty alt is a real accessibility problem, and
      // a filename is a better starting point than nothing.
      alt: item.media?.alt || filename.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '),
      timestamp: item.media?.timestamp || stored.takenAt || undefined,
      location: item.media?.location || stored.coordinates || undefined,
    };

    store.logEvent(id!, 'edit', `Photo uploaded — ${filename}`);
    return { ...saved(doc), image: stored };
  }],

  /** Candidate text for one item. Never written — Jamie picks or ignores. */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/draft$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const doc = requireIssue(id!);
    const result = await editorial.draft({
      doc,
      itemId: itemId!,
      context: b.context,
      seasonal: doc.items[itemId!]?.type === 'echoes' ? seasonalFor(doc) : undefined,
    });
    return result;
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
    const sends = doc.sends ?? {};
    const files = archiveInputs(doc, {
      buttondownId: sends.buttondown?.external_id,
      absoluteUrl: sends.buttondown?.url,
    });
    const result = await githubRepo.diff(files, {
      repo: config.archiveRepo,
      branch: config.archiveBranch,
    });
    return { repo: config.archiveRepo, ...result, files: files.map((f) => f.path) };
  }],

  /** Copy every remote image onto the CDN, resized. Safe to run repeatedly. */
  [/^\/api\/issues\/([^/]+)\/images\/rehost$/, 'POST', async (_ctx, [id]) => {
    const { doc, report } = await rehostIssueImages(requireIssue(id!));
    store.logEvent(id!, 'send', 'Images rehosted to the CDN');
    return { ...saved(doc), report };
  }],

  /**
   * Send, per destination. A failed send stops at its own leg and can be
   * resumed; the other legs are untouched (docs/publishing-lifecycle.md).
   *
   * This dispatch has been severed once before — a QA-fix commit reverted it
   * to a Buttondown-only guard while the client still offered every leg.
   * tests/routes.test.ts exercises it over HTTP so that cannot happen quietly.
   */
  [/^\/api\/issues\/([^/]+)\/send\/([a-z]+)$/, 'POST', async ({ url }, [id, dest]) => {
    const destination = dest as Destination;
    const force = url.searchParams.get('force') === '1';
    if (destination === 'website') return loggedSend(id!, 'website', () => sendWebsite(id!, force));
    if (destination === 'podcast') return loggedSend(id!, 'podcast', () => sendPodcast(id!));
    if (destination === 'archive') return loggedSend(id!, 'archive', () => sendArchive(id!));
    if (destination !== 'buttondown') {
      throw new HttpError(400, `unknown destination ${destination}`);
    }
    guardInFlight(requireIssue(id!), 'buttondown');
    store.logEvent(id!, 'send', 'Send started — buttondown');
    // Rehost first: the email is where image weight actually hurts, and the
    // rewritten URLs must be in the document before the body is rendered.
    const { doc: rehosted, report: images } = await rehostIssueImages(requireIssue(id!));
    const doc = store.saveIssue(rehosted).doc;
    const previous = doc.sends?.buttondown;
    const subject = doc.issue.title;
    const body = renderEmail(doc);

    store.recordSend(id!, destination, { status: 'sending', at: new Date().toISOString() });
    try {
      const draft = previous?.external_id
        ? await buttondown.updateDraft(previous.external_id, subject, body)
        : await buttondown.createDraft(subject, body);
      const state: SendState = {
        status: 'sent',
        at: new Date().toISOString(),
        external_id: draft.id,
        url: draft.url,
      };
      const row = store.recordSend(id!, destination, state);
      store.logEvent(id!, 'send', 'Send finished — buttondown (draft, never scheduled)');
      return { issue: row?.doc, send: state, images };
    } catch (err) {
      const state: SendState = {
        status: 'failed',
        at: new Date().toISOString(),
        error: (err as Error).message,
        external_id: previous?.external_id,
      };
      store.recordSend(id!, destination, state);
      store.logEvent(id!, 'send', `Send failed — buttondown: ${state.error}`);
      throw new HttpError(502, state.error!);
    }
  }],
];


// ── send legs ─────────────────────────────────────────────────────────────

interface PodcastSend extends SendState {
  audio?: Record<string, unknown>;
}

/**
 * The site's own archive can only grow. A parsed emails.json below this floor
 * means a truncated or wrong file, and merging into one would re-lose the
 * archive the 2026-08-30 revert restored — refuse instead.
 */
const MIN_ARCHIVE_ENTRIES = 349;

/**
 * The site's live emails.json — the merge base the handoff must preserve.
 * Rebuilding the index from the Builder's own records gutted it once (104k
 * lines to 10k, commit 91688fc7, reverted): the Shortcuts-era entries carry
 * links, audio, slugs, and ids the imported records cannot reproduce. Any
 * doubt about the file refuses the send rather than rewriting blind.
 */
async function currentSiteEmails(): Promise<IssueEntry[]> {
  const raw = await githubRepo.readFile('apps/site/_data/emails.json', {
    branch: config.websiteBranch,
  });
  if (raw === null) {
    throw new HttpError(502, "the site's emails.json is missing from the repo — refusing to rewrite the index blind");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(502, "the site's emails.json did not parse — refusing to rewrite the index blind");
  }
  if (!Array.isArray(parsed) || parsed.length < MIN_ARCHIVE_ENTRIES) {
    throw new HttpError(502, `the site's emails.json has ${Array.isArray(parsed) ? parsed.length : 'no'} entries, below the ${MIN_ARCHIVE_ENTRIES} the archive is known to hold — refusing to merge into a truncated index`);
  }
  return parsed as IssueEntry[];
}

function websiteOptions(doc: IssueDoc, currentEmails: IssueEntry[]) {
  const sends = doc.sends ?? {};
  const podcast = sends.podcast as PodcastSend | undefined;
  return {
    buttondownId: sends.buttondown?.external_id,
    absoluteUrl: sends.buttondown?.url,
    audio: podcast?.audio as never,
    currentEmails,
  };
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
  // client says the podcast should run first — this makes it true. `?force=1`
  // is the deliberate escape for an issue that really has no audio.
  if (!force && doc.sends?.podcast?.status !== 'sent') {
    throw new HttpError(409, 'the podcast leg has not run — its audio reference belongs in the page. Send the podcast first, or POST ?force=1 to ship without audio.');
  }
  // Read the merge base before recording anything: a failure here refuses
  // the send outright instead of stranding a 'sending' state.
  const currentEmails = await currentSiteEmails();
  store.recordSend(id, 'website', { status: 'sending', at: new Date().toISOString() });
  try {
    const files = siteInputs(doc, websiteOptions(doc, currentEmails));
    const result = await githubRepo.putTree(
      files,
      `Add issue ${doc.issue.number} from WT Builder`,
      { branch: config.websiteBranch },
    );
    const state: SendState = {
      status: 'sent',
      at: new Date().toISOString(),
      external_id: result.sha,
      url: `https://github.com/${config.websiteRepo}/commit/${result.sha}`,
    };
    const row = store.recordSend(id, 'website', state);
    return { issue: row?.doc, send: state, changed: result.changed, committed: result.committed };
  } catch (err) {
    const state: SendState = {
      status: 'failed',
      at: new Date().toISOString(),
      error: (err as Error).message,
    };
    store.recordSend(id, 'website', state);
    throw new HttpError(502, state.error!);
  }
}

/**
 * Render the script, synthesize it, and upload the mp3 to the CDN. The website
 * publishes the reference; the file lives only on the CDN.
 */
async function sendPodcast(id: string) {
  const doc = requireIssue(id);
  guardInFlight(doc, 'podcast');
  store.recordSend(id, 'podcast', { status: 'sending', at: new Date().toISOString() });
  try {
    const script = renderAudioScript(doc);
    const result = await audio.renderAudio(doc, script, {
      bumpersDir: config.bumpersDir,
    });
    const state: PodcastSend = {
      status: 'sent',
      at: new Date().toISOString(),
      external_id: result.url,
      url: result.url,
      audio: {
        audio_url: result.url,
        audio_duration_seconds: result.durationSeconds,
        audio_byte_size: result.bytes,
        audio_voice: result.voice,
      },
    };
    const row = store.recordSend(id, 'podcast', state);
    return { issue: row?.doc, send: state, chunks: result.chunks, cover: result.coverSource };
  } catch (err) {
    const state: SendState = {
      status: 'failed',
      at: new Date().toISOString(),
      error: (err as Error).message,
    };
    store.recordSend(id, 'podcast', state);
    throw new HttpError(502, state.error!);
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
  store.recordSend(id, 'archive', { status: 'sending', at: new Date().toISOString() });
  try {
    const sends = doc.sends ?? {};
    const files = archiveInputs(doc, {
      buttondownId: sends.buttondown?.external_id,
      absoluteUrl: sends.buttondown?.url,
    });
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
};

async function serveStatic(url: URL, res: ServerResponse): Promise<boolean> {
  if (!existsSync(DIST)) return false;
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) return false;
  if (!existsSync(file) || rel === '/' || rel === '\\') file = join(DIST, 'index.html');
  if (!existsSync(file)) return false;
  const data = await readFile(file);
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(data);
  return true;
}

// ── server ────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  try {
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
    if (status >= 500) console.error(`[${method} ${url.pathname}] ${message}`);
    json(res, status, { error: message });
  }
});

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''));
if (isMain !== false) {
  store.openDb();
  server.listen(config.port, config.host, () => {
    console.log(`WT Builder on http://${config.host}:${config.port}`);
    for (const [k, v] of Object.entries(describeConfig())) console.log(`  ${k}: ${v}`);
  });
}

export { server };
