/**
 * The MCP interface, v1: read-only (docs/mcp-plan.md, Part B).
 *
 * An agent — Claude Code or Codex on otto, or any MCP client on the tailnet —
 * sees what the editor shows and changes nothing. Jamie, 2026-10-04: "Perhaps
 * we should make v1 read only?" Suggestions come back in the agent's chat, and
 * Jamie applies the ones worth keeping.
 *
 * Every tool reads through the service's own GET routes, in process
 * (`Reader`, built in index.ts over the route table): the agent sees exactly
 * what the page sees, and the reader refuses any route that is not a GET, so
 * no tool can write. The one write a GET already makes is the editor's own
 * skeleton repair on opening an older issue, which opening it in Safari does
 * too. No tool calls a model, checks a link, or reaches GitHub.
 *
 * Stateless Streamable HTTP with JSON responses: every tool answers in one
 * response, so there are no sessions and no streams. The edge in front of it
 * (edge.ts) refuses a foreign Host and any write with a browser Origin that
 * is not the app's, which keeps web pages in Jamie's browser away from it.
 *
 * Never silent (the Librarian MCP rule): a list says when it is cut and how
 * to get the rest; a refusal says why.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import type { IssueDoc, Item } from '../shared/types.ts';
import type { Readiness } from './issue.ts';
import { outOfWindow, windowOf } from '../shared/render/plan.ts';
import { waitingSummary } from '../shared/dependencies.ts';
import { lastSent } from '../shared/sends.ts';

/** A GET route, run in process. Refuses anything else. */
export type Reader = (path: string) => Promise<any>;

export interface McpDeps {
  read: Reader;
  /** sha256 of the issue's spoken text: whether the script review is for this script. */
  scriptHash: (doc: IssueDoc) => string;
}

const VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export const INSTRUCTIONS = `WT Builder is Jamie Thingelstad's authoring app for The Weekly Thing newsletter. This server is READ-ONLY: it shows an issue exactly as the editor does and changes nothing.

Start with get_status: it lists every readiness pill in the order the issue reads, with its state. "waiting" means the section is made from others that are not finished yet (Title and dek from Notable; Echoes from Notable and Journal; Haiku from Notable, Journal and Briefly; Outro from Intro), so work on its inputs first. Then get_issue for the text, get_item for one item in full, render_issue to see an edition as it will print.

Any suggestion (commentary, an order for Briefly, a title) goes to Jamie in the conversation. Never say you changed the issue: you cannot. Every word in the issue is Jamie's choice; offer, don't impose. Issues are named like wt353; leave issue out to mean the newest draft.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const issueArg = z.string().optional()
  .describe('The issue: "wt353", "353", or its id. Leave out for the newest draft.');

/** Text and structured content together, as every tool answers. */
function answer<T extends Record<string, unknown>>(data: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

function refusal(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

interface IssueRow {
  id: string;
  number: number;
  title?: string;
  publication_date: string;
  status: string;
  put_to_bed_at?: string;
  readiness: number;
  outstanding: number;
  sends: Record<string, { status?: string }>;
}

/** An issue named by id, "wt353" or "353"; the newest draft when not named. */
async function resolveIssue(read: Reader, named?: string): Promise<{ id: string; doc: IssueDoc; readiness: Readiness }> {
  const { issues } = await read('/api/issues') as { issues: IssueRow[] };
  let row: IssueRow | undefined;
  if (!named?.trim()) {
    row = issues.filter((r) => r.status === 'draft').sort((a, b) => b.number - a.number)[0];
    if (!row) throw new Error('There is no draft issue. Name one: list_issues shows them all.');
  } else {
    const n = named.trim();
    const number = /^(?:wt)?(\d+)$/i.exec(n)?.[1];
    row = issues.find((r) => r.id === n) ?? (number ? issues.find((r) => r.number === Number(number)) : undefined);
    if (!row) throw new Error(`No issue "${n}". list_issues shows what there is.`);
  }
  const got = await read(`/api/issues/${encodeURIComponent(row.id)}`) as { issue: IssueDoc; readiness: Readiness };
  return { id: row.id, doc: got.issue, readiness: got.readiness };
}

/** In the issue as the editions print it: a channel on, inside the window. */
const inIssue = (doc: IssueDoc, item: Item) =>
  !outOfWindow(item, windowOf(doc)) && Object.values(item.channels ?? {}).some(Boolean);

function issueHead(doc: IssueDoc) {
  const w = windowOf(doc);
  return {
    id: doc.issue.id,
    number: doc.issue.number,
    title: doc.issue.title ?? '',
    dek: doc.issue.dek ?? '',
    publication_date: doc.issue.publication_date,
    status: doc.issue.status,
    put_to_bed: Boolean(doc.issue.put_to_bed_at),
    window: { from: w.from, to: w.to },
  };
}

function pillsOf(readiness: Readiness) {
  return readiness.units.map((u) => ({
    title: u.title,
    state: u.state,
    kind: u.kind,
    anchor: u.anchor,
    ...(u.section ? { section: u.section } : {}),
    ...(u.context ? { context: u.context } : {}),
    ...(u.waiting_on ? { waiting_on: u.waiting_on, waiting: `Waiting on ${waitingSummary(u.waiting_on)}` } : {}),
  }));
}

function summaryLine(r: Readiness): string {
  if (r.total && r.done === r.total) return `Ready to send: all ${r.total} done`;
  return `${r.done} of ${r.total} done${r.partial ? ` · ${r.partial} in progress` : ''}${r.waiting ? ` · ${r.waiting} waiting` : ''}`;
}

const DESTINATIONS = ['website', 'buttondown', 'podcast', 'archive'] as const;

function sendsOf(doc: IssueDoc) {
  return Object.fromEntries(DESTINATIONS.map((d) => {
    const s = doc.sends?.[d];
    const last = lastSent(s);
    const v = doc.verify?.[d];
    return [d, {
      status: s?.status ?? 'none',
      ...(s?.at ? { at: s.at } : {}),
      ...(s?.error ? { error: s.error } : {}),
      ...(s?.url ? { url: s.url } : {}),
      ...(last && s?.status !== 'sent' ? { last_sent_at: last.at } : {}),
      ...(v ? { verify: { status: v.status, at: v.at, problems: v.checks.filter((c) => c.ok === false).map((c) => `${c.label}: ${c.detail}`) } } : {}),
    }];
  }));
}

/** The item's fields an agent reads, without the sync bookkeeping. */
function itemView(doc: IssueDoc, id: string, item: Item, pill?: string) {
  const { source_snapshot: _s, source_flags: _f, ...rest } = item as Item & Record<string, unknown>;
  return { id, ...rest, in_issue: inIssue(doc, item), ...(pill ? { pill } : {}) };
}

const pillOutput = z.object({
  title: z.string(),
  state: z.enum(['done', 'partial', 'todo', 'waiting']),
  kind: z.string(),
  anchor: z.string(),
  section: z.string().optional(),
  context: z.string().optional(),
  waiting: z.string().optional(),
  waiting_on: z.array(z.object({ section: z.string(), name: z.string(), done: z.number(), total: z.number() })).optional(),
});

const headOutput = z.object({
  id: z.string(), number: z.number(), title: z.string(), dek: z.string(), publication_date: z.string(),
  status: z.string(), put_to_bed: z.boolean(), window: z.object({ from: z.string(), to: z.string() }),
});

/** One MCP server per request: stateless, and cheap to build. */
export function buildServer({ read, scriptHash }: McpDeps): McpServer {
  const server = new McpServer({ name: 'wt-builder', version: VERSION }, { instructions: INSTRUCTIONS });

  /** A tool body; any error becomes the tool's own refusal text. */
  const guarded = <A>(fn: (args: A) => Promise<ReturnType<typeof answer>>) => async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return refusal((e as Error).message);
    }
  };

  server.registerTool('get_status', {
    title: 'Where the issue stands',
    description: 'Everything the readiness strip and the Send view show, for one issue: lifecycle, every pill in the order the issue reads with its state (done, partial = started but under the bar, todo, waiting = made from sections not finished yet, with what it waits on), the counts, and each send leg (website, buttondown, podcast, archive) with its verification, plus the audio script review. Start here.',
    inputSchema: { issue: issueArg },
    outputSchema: {
      issue: headOutput,
      summary: z.string(),
      counts: z.object({ done: z.number(), partial: z.number(), waiting: z.number(), todo: z.number(), total: z.number(), pct: z.number() }),
      workable_now: z.array(z.string()),
      pills: z.array(pillOutput),
      sends: z.record(z.string(), z.unknown()),
      script_review: z.unknown(),
    },
    annotations: READ_ONLY,
  }, guarded(async ({ issue }: { issue?: string }) => {
    const { doc, readiness } = await resolveIssue(read, issue);
    const review = doc.script_review;
    return answer({
      issue: issueHead(doc),
      summary: summaryLine(readiness),
      counts: {
        done: readiness.done,
        partial: readiness.partial,
        waiting: readiness.waiting,
        todo: readiness.units.filter((u) => u.state === 'todo').length,
        total: readiness.total,
        pct: readiness.pct,
      },
      workable_now: readiness.units.filter((u) => u.state === 'todo' || u.state === 'partial').map((u) => u.title),
      pills: pillsOf(readiness),
      sends: sendsOf(doc),
      script_review: review
        ? {
          verdict: review.verdict,
          summary: review.summary,
          findings: review.findings.length,
          approved: Boolean(review.approved_at),
          current: review.script_hash === scriptHash(doc),
        }
        : null,
    });
  }));

  server.registerTool('list_issues', {
    title: 'Issues',
    description: 'Issues newest first, with status, readiness and send states. Drafts by default; include "all" for published ones too.',
    inputSchema: {
      include: z.enum(['drafts', 'all']).optional().describe('drafts (default) or all'),
      limit: z.number().int().min(1).max(500).optional().describe('How many to show (default 20).'),
    },
    outputSchema: {
      issues: z.array(z.object({
        id: z.string(), number: z.number(), title: z.string(), publication_date: z.string(), status: z.string(),
        put_to_bed: z.boolean(), readiness_pct: z.number(), outstanding: z.number(), sends: z.record(z.string(), z.string()),
      })),
      shown: z.number(),
      matching: z.number(),
      note: z.string().optional(),
      next_number: z.number(),
    },
    annotations: READ_ONLY,
  }, guarded(async ({ include, limit }: { include?: 'drafts' | 'all'; limit?: number }) => {
    const { issues, next_number } = await read('/api/issues') as { issues: IssueRow[]; next_number: number };
    const matching = issues
      .filter((r) => include === 'all' || r.status === 'draft')
      .sort((a, b) => b.number - a.number);
    const cap = limit ?? 20;
    const shown = matching.slice(0, cap);
    return answer({
      issues: shown.map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title ?? '',
        publication_date: r.publication_date,
        status: r.status,
        put_to_bed: Boolean(r.put_to_bed_at),
        readiness_pct: r.readiness,
        outstanding: r.outstanding,
        sends: Object.fromEntries(Object.entries(r.sends ?? {}).map(([d, s]) => [d, s?.status ?? 'none'])),
      })),
      shown: shown.length,
      matching: matching.length,
      ...(matching.length > shown.length ? { note: `Showing the newest ${shown.length} of ${matching.length}; pass a larger limit for the rest.` } : {}),
      next_number,
    });
  }));

  server.registerTool('get_issue', {
    title: 'The issue, section by section',
    description: 'The issue as an outline in reading order: each section with its items, every text field in full (title, commentary, body, label, ask, caption), whether the item is in the issue (inside the window, on a channel), its sync state, and its pill state. Items swept in but not placed are listed as orphans.',
    inputSchema: { issue: issueArg },
    outputSchema: {
      issue: headOutput,
      sections: z.array(z.object({
        id: z.string(), label: z.string(), type: z.string(), kind: z.string(),
        items: z.array(z.looseObject({ id: z.string(), type: z.string() })),
      })),
      orphans: z.array(z.looseObject({ id: z.string() })),
    },
    annotations: READ_ONLY,
  }, guarded(async ({ issue }: { issue?: string }) => {
    const { doc, readiness } = await resolveIssue(read, issue);
    const pill = new Map<string, string>();
    for (const u of readiness.units) if (u.kind !== 'sync' && !pill.has(u.anchor)) pill.set(u.anchor, u.state);
    return answer({
      issue: issueHead(doc),
      sections: doc.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        type: n.type,
        kind: n.kind,
        ...(pill.has(n.id) ? { pill: pill.get(n.id) } : {}),
        items: n.items.flatMap((id) => {
          const item = doc.items[id];
          return item ? [itemView(doc, id, item, pill.get(id))] : [];
        }),
      })),
      orphans: (doc.orphans ?? []).flatMap((id) => {
        const item = doc.items[id];
        return item ? [itemView(doc, id, item)] : [];
      }),
    });
  }));

  server.registerTool('get_item', {
    title: 'One item, in full',
    description: 'Every field of one item, the section it is in, and every pill it owns (including a failed or conflicted write-back).',
    inputSchema: { issue: issueArg, item_id: z.string().describe('The item id, from get_issue.') },
    outputSchema: {
      item: z.looseObject({ id: z.string(), type: z.string() }),
      section: z.string().nullable(),
      pills: z.array(pillOutput),
    },
    annotations: READ_ONLY,
  }, guarded(async ({ issue, item_id }: { issue?: string; item_id: string }) => {
    const { doc, readiness } = await resolveIssue(read, issue);
    const item = doc.items[item_id];
    if (!item) throw new Error(`No item "${item_id}" in WT${doc.issue.number}. get_issue lists them.`);
    const node = doc.nodes.find((n) => n.items.includes(item_id));
    return answer({
      item: { id: item_id, ...item, in_issue: inIssue(doc, item) },
      section: node?.label ?? null,
      pills: pillsOf({ ...readiness, units: readiness.units.filter((u) => u.anchor === item_id) }),
    });
  }));

  server.registerTool('render_issue', {
    title: 'An edition as it will print',
    description: 'One edition of the issue rendered as it will go out: website (the site page source), email, audio (the spoken script), or source (every item as stored).',
    inputSchema: { issue: issueArg, lens: z.enum(['website', 'email', 'audio', 'source']) },
    outputSchema: { lens: z.string(), rendered: z.string() },
    annotations: READ_ONLY,
  }, guarded(async ({ issue, lens }: { issue?: string; lens: string }) => {
    const { id } = await resolveIssue(read, issue);
    const out = await read(`/api/issues/${encodeURIComponent(id)}/render/${lens}`) as { lens: string; rendered: string };
    return answer({ lens: out.lens, rendered: out.rendered });
  }));

  server.registerTool('get_review', {
    title: 'The editorial review notes',
    description: 'The most recent editorial review, as the margin shows it: a summary and notes (PROOF with the exact words and a fix, BALANCE, REPETITION, LENGTH). This reads the last review; it does not run one.',
    inputSchema: { issue: issueArg },
    outputSchema: { reviewed: z.boolean(), review: z.unknown() },
    annotations: READ_ONLY,
  }, guarded(async ({ issue }: { issue?: string }) => {
    const { doc } = await resolveIssue(read, issue);
    return answer({ reviewed: Boolean(doc.review), review: doc.review ?? null });
  }));

  server.registerTool('list_events', {
    title: 'The event log',
    description: 'What happened to the issue, newest first: edits, syncs with Pinboard and Micro.blog, sends, overrides. The log keeps the last 300 per issue.',
    inputSchema: {
      issue: issueArg,
      since: z.number().int().optional().describe('Only events after this event id.'),
      limit: z.number().int().min(1).max(500).optional().describe('How many to show (default 50).'),
    },
    outputSchema: {
      events: z.array(z.looseObject({ id: z.number(), at: z.string(), kind: z.string(), summary: z.string() })),
      shown: z.number(),
      matching: z.number(),
      note: z.string().optional(),
    },
    annotations: READ_ONLY,
  }, guarded(async ({ issue, since, limit }: { issue?: string; since?: number; limit?: number }) => {
    const { id } = await resolveIssue(read, issue);
    const { events } = await read(`/api/issues/${encodeURIComponent(id)}/events`) as { events: { id: number; at: string; kind: string; summary: string }[] };
    const matching = since === undefined ? events : events.filter((e) => e.id > since);
    const shown = matching.slice(0, limit ?? 50);
    return answer({
      events: shown,
      shown: shown.length,
      matching: matching.length,
      ...(matching.length > shown.length ? { note: `Showing the newest ${shown.length} of ${matching.length}; pass a larger limit, or since, for the rest.` } : {}),
    });
  }));

  server.registerTool('get_timing', {
    title: 'How long the issue has taken',
    description: 'The issue\'s editing time from its event log, beside the issue before it, and what shipped in WT Builder between the two.',
    inputSchema: { issue: issueArg },
    annotations: READ_ONLY,
  }, guarded(async ({ issue }: { issue?: string }) => {
    const { id } = await resolveIssue(read, issue);
    return answer(await read(`/api/issues/${encodeURIComponent(id)}/timing`) as Record<string, unknown>);
  }));

  return server;
}

/**
 * One request to /mcp. Stateless: a fresh server and transport each time,
 * closed when the response is. JSON responses, so there is no stream to
 * hold open.
 */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, deps: McpDeps): Promise<void> {
  const server = buildServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
