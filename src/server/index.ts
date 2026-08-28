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

import type { Channel, Destination, IssueDoc, SendState } from '../shared/types.ts';
import { render } from '../shared/render/index.ts';
import { renderEmail } from '../shared/render/email.ts';
import { config, describeConfig } from './config.ts';
import * as store from './db.ts';
import * as issues from './issue.ts';
import * as buttondown from './integrations/buttondown.ts';
import * as pinboard from './integrations/pinboard.ts';
import * as microblog from './integrations/microblog.ts';
import { rehostIssueImages } from './integrations/images.ts';
import * as editorial from './editorial.ts';
import * as githubRepo from './integrations/github.ts';
import * as audio from './integrations/audio.ts';
import { renderAudio as renderAudioScript } from '../shared/render/audio.ts';
import { issueEntry, siteInputs, type IssueEntry } from './publish.ts';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: () => Promise<any>;
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

// ── routes ────────────────────────────────────────────────────────────────

const routes: [RegExp, string, (ctx: Ctx, params: string[]) => Promise<unknown>][] = [
  [/^\/api\/health$/, 'GET', async () => ({
    ok: true,
    ...describeConfig(),
    editorial: editorial.isConfigured() ? 'configured' : 'MISSING',
  })],

  [/^\/api\/issues$/, 'GET', async () => ({
    issues: store.listIssues().map((r) => ({
      id: r.id,
      number: r.number,
      title: r.doc.issue.title,
      publication_date: r.publication_date,
      status: r.status,
      updated_at: r.updated_at,
      sends: r.doc.sends ?? {},
      readiness: issues.readiness(r.doc).pct,
    })),
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
    return saved(doc);
  }],

  [/^\/api\/issues\/([^/]+)$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    return { issue: doc, readiness: issues.readiness(doc) };
  }],

  [/^\/api\/issues\/([^/]+)$/, 'DELETE', async (_ctx, [id]) => {
    store.deleteIssue(id!);
    return { ok: true };
  }],

  /** Whole-document save. Single editor, last write wins (0019). */
  [/^\/api\/issues\/([^/]+)$/, 'PUT', async ({ body }, [id]) => {
    const b = await body();
    if (!b?.issue?.id || b.issue.id !== id) throw new HttpError(400, 'document id mismatch');
    return saved(b as IssueDoc);
  }],

  [/^\/api\/issues\/([^/]+)\/sweep$/, 'POST', async (_ctx, [id]) => {
    const { doc, report } = await issues.sweep(requireIssue(id!));
    return { ...saved(doc), report };
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
    return saved(issues.updateItem(requireIssue(id!), itemId!, patch));
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/channel$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const channel = b.channel as Channel;
    if (!['website', 'email', 'audio'].includes(channel)) {
      throw new HttpError(400, 'channel must be website, email, or audio');
    }
    return saved(issues.setChannel(requireIssue(id!), itemId!, channel, Boolean(b.on)));
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/visibility$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const doc = requireIssue(id!);
    return saved(b.visible ? issues.showItem(doc, itemId!) : issues.hideItem(doc, itemId!));
  }],

  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/promote$/, 'POST', async (_ctx, [id, itemId]) =>
    saved(issues.promote(requireIssue(id!), itemId!))],

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

  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)$/, 'DELETE', async (_ctx, [id, nodeId]) =>
    saved(issues.removeSection(requireIssue(id!), nodeId!))],

  [/^\/api\/issues\/([^/]+)\/nodes\/([^/]+)\/rename$/, 'POST', async ({ body }, [id, nodeId]) => {
    const b = await body();
    return saved(issues.renameSection(requireIssue(id!), nodeId!, String(b.label ?? '')));
  }],

  [/^\/api\/issues\/([^/]+)\/nodes$/, 'POST', async ({ body }, [id]) => {
    const b = await body();
    const doc = requireIssue(id!);
    if (b.kind === 'markdown') return saved(issues.addMarkdownBlock(doc, b.before));
    return saved(issues.addSection(doc, {
      type: String(b.type ?? 'ad_hoc'),
      label: String(b.label ?? 'Section'),
      id: b.id,
    }));
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
    if (b.publication_date) doc = issues.setPublicationDate(doc, String(b.publication_date));
    if (b.window_days !== undefined) doc = issues.setWindowDays(doc, Number(b.window_days));
    if (b.title !== undefined) doc.issue.title = String(b.title);
    if (b.dek !== undefined) doc.issue.dek = String(b.dek);
    return saved(doc);
  }],

  /**
   * Push an item's working values back to where it came from, last-writer-wins.
   * Pinboard and Micro.blog both write; the local edit always stands and only
   * `sync_state` records the outcome.
   */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/writeback$/, 'POST', async (_ctx, [id, itemId]) => {
    const doc = requireIssue(id!);
    const item = doc.items[itemId!];
    if (!item) throw new HttpError(404, `no item ${itemId}`);

    const result =
      item.source === 'Micro.blog'
        ? await microblog.updatePost(item)
        : item.source === 'Pinboard'
          ? await pinboard.writeBack(item)
          : { sync_state: 'local' as const, error: `${item.source} has no write-back` };

    return { ...saved(issues.updateItem(doc, itemId!, { sync_state: result.sync_state })), result };
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

    const result = await editorial.review({ doc, recentIssues, only: b.only });
    doc.review = result;
    return { ...saved(doc), review: result };
  }],

  /** Candidate text for one item. Never written — Jamie picks or ignores. */
  [/^\/api\/issues\/([^/]+)\/items\/([^/]+)\/draft$/, 'POST', async ({ body }, [id, itemId]) => {
    const b = await body();
    const result = await editorial.draft({
      doc: requireIssue(id!),
      itemId: itemId!,
      context: b.context,
    });
    return result;
  }],

  /** What the website handoff would change, changing nothing. */
  [/^\/api\/issues\/([^/]+)\/send\/website\/preview$/, 'GET', async (_ctx, [id]) => {
    const doc = requireIssue(id!);
    const files = siteInputs(doc, websiteOptions(doc));
    const result = await githubRepo.diff(files, config.websiteBranch);
    return { repo: config.websiteRepo, ...result, files: files.map((f) => f.path) };
  }],

  /** Copy every remote image onto the CDN, resized. Safe to run repeatedly. */
  [/^\/api\/issues\/([^/]+)\/images\/rehost$/, 'POST', async (_ctx, [id]) => {
    const { doc, report } = await rehostIssueImages(requireIssue(id!));
    return { ...saved(doc), report };
  }],

  /**
   * Send. Buttondown only for now — the rest of the slice comes after
   * (AGENTS.md). A failed send stops at its own leg and can be resumed.
   */
  [/^\/api\/issues\/([^/]+)\/send\/([a-z]+)$/, 'POST', async (_ctx, [id, dest]) => {
    const destination = dest as Destination;
    if (destination === 'website') return sendWebsite(id!);
    if (destination === 'podcast') return sendPodcast(id!);
    if (destination !== 'buttondown') {
      throw new HttpError(400, `unknown destination ${destination}`);
    }
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
      return { issue: row?.doc, send: state, images };
    } catch (err) {
      const state: SendState = {
        status: 'failed',
        at: new Date().toISOString(),
        error: (err as Error).message,
        external_id: previous?.external_id,
      };
      store.recordSend(id!, destination, state);
      throw new HttpError(502, state.error!);
    }
  }],
];


// ── send legs ─────────────────────────────────────────────────────────────

interface PodcastSend extends SendState {
  audio?: Record<string, unknown>;
}

/** Prior issues' index entries, so emails.json is rewritten whole. */
function priorEntries(number: number): IssueEntry[] {
  return store
    .listIssues()
    .filter((r) => r.number !== number && r.doc.issue.status === 'published')
    .map((r) => {
      const sends = r.doc.sends ?? {};
      const entry = issueEntry(r.doc);
      return {
        ...entry,
        id: sends.buttondown?.external_id ?? entry.id,
        absolute_url: sends.buttondown?.url ?? entry.absolute_url,
      };
    });
}

function websiteOptions(doc: IssueDoc) {
  const sends = doc.sends ?? {};
  const podcast = sends.podcast as PodcastSend | undefined;
  return {
    buttondownId: sends.buttondown?.external_id,
    absoluteUrl: sends.buttondown?.url,
    audio: podcast?.audio as never,
    priorEntries: priorEntries(doc.issue.number),
  };
}

/**
 * Commit the generated 11ty inputs to the render surface as one commit. The
 * site builds and deploys from there; nothing here touches the live site.
 */
async function sendWebsite(id: string) {
  const doc = requireIssue(id);
  store.recordSend(id, 'website', { status: 'sending', at: new Date().toISOString() });
  try {
    const files = siteInputs(doc, websiteOptions(doc));
    const result = await githubRepo.putTree(
      files,
      `Add issue ${doc.issue.number} from WT Builder`,
      config.websiteBranch,
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
  store.recordSend(id, 'podcast', { status: 'sending', at: new Date().toISOString() });
  try {
    const script = renderAudioScript(doc);
    const result = await audio.renderAudio(script, doc.issue.number, {
      bumpersDir: process.env.WT_BUILDER_BUMPERS_DIR,
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
    return { issue: row?.doc, send: state, chunks: result.chunks };
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
      const result = await handler({ req, res, url, body: () => readBody(req) }, params);
      return json(res, 200, result);
    }

    if (method === 'GET' && (await serveStatic(url, res))) return;

    if (url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: `no route for ${method} ${url.pathname}` });
    }
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
