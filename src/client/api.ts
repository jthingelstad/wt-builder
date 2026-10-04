/** Thin client for the service. Every credential stays on the far side of this. */

import type { Section, WaitingOn } from '../shared/dependencies.ts';
import type { ArchiveReference, Channel, EchoOption, IssueDoc, Item, LinkedBefore } from '../shared/types.ts';
import type { IssueTiming } from '../shared/timing.ts';
import type { ProofSpot } from '../shared/proof.ts';

/** True when a local edit touches a field owned by an imported source. */
export function shouldWriteBack(item: Item, patch: Record<string, unknown>): boolean {
  const fields = item.source === 'Pinboard'
    ? ['title', 'commentary', 'tags']
    : item.source === 'Micro.blog'
      ? ['title', 'body']
      : [];
  return fields.some((field) => field in patch);
}

/**
 * What the inspector's error bar should say after a write-back: `null`
 * clears it, `undefined` adds nothing, a string replaces it. The state is
 * the item's as saved. `syncing` means a newer write is queued behind this
 * one, and that write's answer is the one that counts. `undefined` does not
 * mean the bar is untouched: the response has already been through the
 * app's absorb(), which clears the bar when it shows the message of a
 * mutation that failed.
 */
export function writeBackMessage(
  source: string | undefined,
  result: { sync_state?: string; error?: string } | undefined,
): string | null | undefined {
  const state = result?.sync_state;
  if (!state || state === 'syncing') return undefined;
  if (state === 'synced' || state === 'needs_commentary') return null;
  const said = result.error ?? state;
  return /your edit is kept/i.test(said) ? `${source}: ${said}` : `${source}: ${said}. Your edit is kept.`;
}

export type ReadinessKind = 'required' | 'commentary' | 'sync' | 'thingy' | 'links' | 'mail';

export type ReadinessState = 'done' | 'partial' | 'todo' | 'waiting';

export interface Readiness {
  units: {
    done: boolean;
    state: ReadinessState;
    title: string;
    anchor: string;
    kind: ReadinessKind;
    context?: string;
    section?: Section;
    /** When `waiting`: each unfinished input (src/shared/dependencies.ts). */
    waiting_on?: WaitingOn[];
  }[];
  done: number;
  partial: number;
  waiting?: number;
  total: number;
  pct: number;
}

export interface IssueResponse {
  issue: IssueDoc;
  readiness: Readiness;
  /**
   * A link or blocklist check is waiting or running for this issue, in the
   * background (src/server/arrival-check.ts): the app looks again shortly.
   */
  checking?: boolean;
}

/** The podcast leg's audio record, as the issue keeps it on `sends.podcast.audio`. */
export interface PodcastAudio {
  audio_url?: string;
  audio_duration_seconds?: number;
  audio_byte_size?: number;
  audio_voice?: string;
  audio_chapters_url?: string;
  audio_transcript_url?: string;
}

/**
 * What a send hands back. The leg's record is `send`, the podcast's audio
 * on it; the Send view reads its evidence from the issue (Send.tsx).
 */
export interface SendResult {
  issue: IssueDoc;
  send: { status: string; url?: string; edit_url?: string; external_id?: string; error?: string; audio?: PodcastAudio };
  pieces?: number;
  synthesized?: number;
  cover?: string;
}

export interface IssueSummary {
  id: string;
  number: number;
  title: string;
  publication_date: string;
  status: string;
  updated_at: string;
  /** A pre-Builder record — published by the Shortcuts workflow. */
  imported?: boolean;
  /** Put to bed: finished, and the server refuses changes until it is woken. */
  put_to_bed_at?: string;
  /** Active time it took, before and after sending (Builder issues). */
  built_ms?: number;
  sends: Record<string, { status: string; url?: string; error?: string }>;
  readiness: number;
  /** One entry per readiness unit — the dashboard draws these as the strip. */
  ticks: boolean[];
  outstanding: number;
  counts: { items: number; links: number; journal: number };
}

/** This client's build, as vite.config.ts names it; undefined under the dev server and in tests. */
declare const __WT_BUILD_ID__: string | undefined;
const OWN_BUILD = typeof __WT_BUILD_ID__ === 'string' ? __WT_BUILD_ID__ : undefined;

let staleBuild = false;
const staleListeners = new Set<() => void>();

/**
 * Called once the server names a build other than this client's: a deploy
 * since the tab loaded, and a reload would load the new client (review
 * 2026-09-27 §2.4). Returns the unsubscribe.
 */
export function onStaleBuild(fn: () => void): () => void {
  if (staleBuild) fn();
  staleListeners.add(fn);
  return () => { staleListeners.delete(fn); };
}

function checkBuild(res: Response): void {
  const served = res.headers.get('X-WT-Builder-Build');
  if (staleBuild || !OWN_BUILD || !served || served === OWN_BUILD) return;
  staleBuild = true;
  for (const fn of staleListeners) fn();
}

/** A refusal from the service: its message, its HTTP status, and the code it names, when it names one. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  checkBuild(res);
  const text = await res.text();
  // A proxy, or the service restarting under a deploy, can answer with HTML
  // or nothing parseable. The error bar then said "Unexpected token '<'";
  // it says the status instead (review 2026-09-27, §1.4).
  let payload: { error?: string; code?: string } & Record<string, unknown>;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(
      res.ok ? `${res.status} ${res.statusText}: the answer was not JSON` : `${res.status} ${res.statusText}`,
      res.status,
    );
  }
  if (!res.ok) {
    // JSON null (or a bare value) has no fields to read; `null.error` threw a
    // TypeError in place of the refusal.
    const said = payload && typeof payload === 'object' ? payload : {};
    const error = typeof said.error === 'string' ? said.error : undefined;
    throw new ApiError(error ?? `${res.status} ${res.statusText}`, res.status, said.code);
  }
  return payload as T;
}

const post = (path: string, body?: unknown) =>
  call<IssueResponse>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const api = {
  health: () => call<Record<string, string>>('/health'),

  listIssues: () => call<{ issues: IssueSummary[]; next_number: number }>('/issues'),

  createIssue: (body: { number?: number; publication_date: string; window_days?: number; title?: string }) =>
    post('/issues', body),

  getIssue: (id: string) => call<IssueResponse>(`/issues/${id}`),

  deleteIssue: (id: string) => call<{ ok: true }>(`/issues/${id}`, { method: 'DELETE' }),

  sweep: (id: string) =>
    post(`/issues/${id}/sweep`) as Promise<IssueResponse & { report: {
      added: number; skipped: number;
      refreshed: number; gone: number; conflicts: number;
      window: { from: string; to: string };
    } }>,

  renderLens: (id: string, lens: string) =>
    call<{ lens: string; rendered: string }>(`/issues/${id}/render/${lens}`),

  /** `result` is present when the edit touched a mirrored field and was written to its source. */
  updateItem: (id: string, itemId: string, patch: Record<string, unknown>) =>
    call<IssueResponse & { result?: { sync_state: Item['sync_state']; error?: string } }>(
      `/issues/${id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  setChannel: (id: string, itemId: string, channel: Channel, on: boolean) =>
    post(`/issues/${id}/items/${itemId}/channel`, { channel, on }),

  setVisible: (id: string, itemId: string, visible: boolean) =>
    post(`/issues/${id}/items/${itemId}/visibility`, { visible }),

  promote: (id: string, itemId: string) => post(`/issues/${id}/items/${itemId}/promote`),
  /** Notable <-> Briefly. The server also writes the _brief tag to Pinboard. */
  moveToSection: (id: string, itemId: string, target: 'Notable' | 'Briefly') =>
    post(`/issues/${id}/items/${itemId}/section`, { target }),
  demote: (id: string, nodeId: string) => post(`/issues/${id}/nodes/${nodeId}/demote`),

  moveNode: (id: string, nodeId: string, delta: number) =>
    post(`/issues/${id}/nodes/${nodeId}/move`, { delta }),

  moveItem: (id: string, nodeId: string, itemId: string, delta: number) =>
    post(`/issues/${id}/nodes/${nodeId}/items/${itemId}/move`, { delta }),

  removeNode: (id: string, nodeId: string) =>
    call<IssueResponse>(`/issues/${id}/nodes/${nodeId}`, { method: 'DELETE' }),

  removeItem: (id: string, nodeId: string, itemId: string) =>
    call<IssueResponse>(`/issues/${id}/nodes/${nodeId}/items/${itemId}`, { method: 'DELETE' }),

  events: (id: string) =>
    call<{ events: { id: number; at: string; kind: string; summary: string }[] }>(
      `/issues/${id}/events`,
    ),

  renameNode: (id: string, nodeId: string, label: string) =>
    post(`/issues/${id}/nodes/${nodeId}/rename`, { label }),

  addNode: (id: string, body: { type?: string; label?: string; id?: string; kind?: string; before?: string }) =>
    post(`/issues/${id}/nodes`, body),

  /** One item into an existing node — a Currently entry, a written link. */
  addItem: (id: string, nodeId: string, type: string) =>
    post(`/issues/${id}/nodes/${nodeId}/items`, { type }),

  /** The echoes Jamie ticked, appended to the Echoes section as items. */
  addEchoes: (id: string, nodeId: string, echoes: EchoOption[]) =>
    post(`/issues/${id}/nodes/${nodeId}/echoes`, { echoes }),

  availableSections: (id: string) =>
    call<{ sections: { id: string; type: string; label: string }[] }>(`/issues/${id}/available-sections`),

  settings: (id: string, body: Record<string, unknown>) => post(`/issues/${id}/settings`, body),

  /**
   * A photo, sent as raw bytes rather than base64 — encoding inflates a real
   * photo by a third and pushes it past the request limit.
   */
  uploadPhoto: (id: string, itemId: string, file: File) =>
    call<IssueResponse & { image: { url: string; bytes: number; width?: number; height?: number } }>(
      `/issues/${id}/items/${itemId}/photo`,
      {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': file.name },
      },
    ),

  /**
   * Candidate text for one item. Never written — the wand offers, Jamie picks.
   * Returning candidates rather than committing is what keeps every word in the
   * issue his.
   */
  /** A proposed order for a link section; nothing moves until reorder() is called. */
  suggestOrder: (id: string, nodeId: string) =>
    call<{ order: string[]; why: string; notes: { id: string; note: string }[]; current: string[] }>(
      `/issues/${id}/nodes/${nodeId}/order`, { method: 'POST' },
    ),
  reorder: (id: string, nodeId: string, order: string[], why?: string) =>
    call<IssueResponse>(`/issues/${id}/nodes/${nodeId}/reorder`, { method: 'POST', body: JSON.stringify({ order, why }) }),

  /** The Echoes section wand: echoes to append. Nothing is written until addEchoes. */
  /** `force` drafts a section still waiting on its inputs — the editor asked first. */
  draftEchoes: (id: string, nodeId: string, force = false) =>
    call<{ candidates: string[]; echoes?: EchoOption[] }>(
      `/issues/${id}/nodes/${nodeId}/echoes/draft${force ? '?force=1' : ''}`, { method: 'POST', body: '{}' },
    ),

  /** What the draft in flight has to say while it waits ("The archive is busy; trying again…"), or null. */
  drafting: (id: string) =>
    call<{ drafting: { anchor: string; says: string } | null }>(`/issues/${id}/drafting`),

  draftItem: (id: string, itemId: string, context?: string, force = false) =>
    call<{ candidates: string[]; echoes?: EchoOption[]; membership?: { cta: string; thanks: string }[]; photo?: { alt: string }[]; alts?: { src: string; alt: string }[]; linked_before?: LinkedBefore[] }>(
      `/issues/${id}/items/${itemId}/draft${force ? '?force=1' : ''}`,
      { method: 'POST', body: JSON.stringify({ context }) },
    ),

  /** Share the draft as a static DRAFT-labeled page on the CDN. */
  shareDraft: (id: string, note?: string) =>
    call<IssueResponse & { share: { url: string } }>(`/issues/${id}/share`, {
      method: 'POST', body: JSON.stringify({ note }),
    }),
  unshareDraft: (id: string) => call<IssueResponse>(`/issues/${id}/share`, { method: 'DELETE' }),

  /** An editorial read. Advisory only — notes never gate publishing. */
  review: (id: string, only?: string) =>
    post(`/issues/${id}/review`, { only }) as Promise<IssueResponse & { review: unknown }>,

  /**
   * Apply one PROOF note's fix, named by its review and index; with `undo`,
   * the spot an Apply answered with, take it back. A 409 (`proof_*`) says
   * why nothing changed.
   */
  applyProof: (id: string, reviewAt: string, index: number, undo?: ProofSpot) =>
    post(`/issues/${id}/proof`, { review_at: reviewAt, index, ...(undo ? { undo } : {}) }) as Promise<IssueResponse & {
      applied: ProofSpot;
      result?: { sync_state: Item['sync_state']; error?: string };
    }>,

  writeBack: (id: string, itemId: string) =>
    post(`/issues/${id}/items/${itemId}/writeback`) as Promise<
      IssueResponse & { result: { sync_state: string; error?: string } }
    >,

  /** Out of `conflict`: write this copy over the source, or adopt the source's. */
  resolveConflict: (id: string, itemId: string, keep: 'mine' | 'theirs') =>
    post(`/issues/${id}/items/${itemId}/${keep === 'mine' ? 'keep-mine' : 'take-theirs'}`) as Promise<
      IssueResponse & { result?: { sync_state: string; error?: string } }
    >,

  // No checkLinks: links and domains are checked as they arrive, in the
  // background (src/server/arrival-check.ts), and the send legs check what
  // is still owed. POST /links/check stays for a script; no button calls it.

  /** A deliverability finding in the email kept as it is; `keep: false` asks again. */
  keepFinding: (id: string, key: string, keep = true) => post(`/issues/${id}/deliverability/keep`, { key, keep }),

  /**
   * One link finding: `use` prints the check's suggestion for the item's own
   * link, `original` goes back to the bookmark's, `keep` stops asking. None
   * of them touches Pinboard.
   */
  linkAction: (id: string, itemId: string, action: 'use' | 'original' | 'keep', url?: string) =>
    post(`/issues/${id}/items/${itemId}/link`, { action, url }),

  /** Move the bookmark at Pinboard to the link the issue prints. Jamie's click only. */
  moveBookmark: (id: string, itemId: string) =>
    post(`/issues/${id}/items/${itemId}/move-bookmark`) as Promise<IssueResponse & { result: { removed: boolean } }>,

  /** `force` goes past the leg's gate (approval, audio, not a draft, dead links) — the card asked first. */
  send: (id: string, destination: string, force = false) =>
    call<SendResult>(`/issues/${id}/send/${destination}${force ? '?force=1' : ''}`, { method: 'POST', body: '{}' }),

  /** How long the issue took, the Builder issue before it, and what shipped between. */
  timing: (id: string) => call<{
    timing: IssueTiming;
    previous: { number: number; timing: IssueTiming } | null;
    shipped: { sha: string; at: string; subject: string }[];
  }>(`/issues/${id}/timing`),

  /** Put an issue to bed, or wake it. */
  bed: (id: string, asleep: boolean) => post(`/issues/${id}/bed`, { asleep }),

  /** Have a model read the audio script for the ear; the review lands on the issue. */
  scriptReview: (id: string) => post(`/issues/${id}/script/review`),
  /** Approve the script that was read. */
  scriptApprove: (id: string) => post(`/issues/${id}/script/approve`),

  /** Re-check a sent leg at its destination. Returns at once; the result lands on the issue. */
  verify: (id: string, destination: string) =>
    call<{ issue: IssueDoc }>(`/issues/${id}/verify/${destination}`, { method: 'POST', body: '{}' }),

  /** What a leg would commit, committing nothing. website and archive only. */
  sendPreview: (id: string, leg: 'website' | 'archive') =>
    call<{ repo: string; sha: string; changed: string[]; unchanged: number }>(
      `/issues/${id}/send/${leg}/preview`,
    ),
};
