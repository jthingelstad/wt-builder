/** Thin client for the service. Every credential stays on the far side of this. */

import type { ArchiveReference, Channel, EchoOption, IssueDoc, Item } from '../shared/types.ts';
import type { IssueTiming } from '../shared/timing.ts';

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
 * clears it, `undefined` leaves it as it is, a string replaces it. The
 * state is the item's as saved. `syncing` means a newer write is queued
 * behind this one, and that write's answer is the one that counts.
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

export type ReadinessKind = 'required' | 'commentary' | 'sync' | 'thingy';

export type ReadinessState = 'done' | 'partial' | 'todo';

export interface Readiness {
  units: {
    done: boolean;
    state: ReadinessState;
    title: string;
    anchor: string;
    kind: ReadinessKind;
    context?: string;
  }[];
  done: number;
  partial: number;
  total: number;
  pct: number;
}

export interface IssueResponse {
  issue: IssueDoc;
  readiness: Readiness;
}

/** What a send hands back — the evidence each step produced. */
export interface SendResult {
  issue: IssueDoc;
  send: { status: string; url?: string; edit_url?: string; external_id?: string; error?: string };
  /** Podcast only. */
  audio?: {
    audio_url?: string;
    audio_duration_seconds?: number;
    audio_byte_size?: number;
    audio_voice?: string;
    audio_chapters_url?: string;
    audio_transcript_url?: string;
  };
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
  draftEchoes: (id: string, nodeId: string) =>
    call<{ candidates: string[]; echoes?: EchoOption[] }>(
      `/issues/${id}/nodes/${nodeId}/echoes/draft`, { method: 'POST', body: '{}' },
    ),

  draftItem: (id: string, itemId: string, context?: string) =>
    call<{ candidates: string[]; echoes?: EchoOption[]; membership?: { cta: string; thanks: string }[]; photo?: { alt: string }[]; alts?: { src: string; alt: string }[] }>(
      `/issues/${id}/items/${itemId}/draft`,
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

  writeBack: (id: string, itemId: string) =>
    post(`/issues/${id}/items/${itemId}/writeback`) as Promise<
      IssueResponse & { result: { sync_state: string; error?: string } }
    >,

  /** Out of `conflict`: write this copy over the source, or adopt the source's. */
  resolveConflict: (id: string, itemId: string, keep: 'mine' | 'theirs') =>
    post(`/issues/${id}/items/${itemId}/${keep === 'mine' ? 'keep-mine' : 'take-theirs'}`) as Promise<
      IssueResponse & { result?: { sync_state: string; error?: string } }
    >,

  /** `webCopy`: update a Buttondown email that has already gone (the server refuses it otherwise). */
  send: (id: string, destination: string, opts: { webCopy?: boolean } = {}) =>
    call<SendResult>(`/issues/${id}/send/${destination}${opts.webCopy ? '?web_copy=1' : ''}`, { method: 'POST', body: '{}' }),

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
