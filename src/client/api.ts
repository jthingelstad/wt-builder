/** Thin client for the service. Every credential stays on the far side of this. */

import type { Channel, IssueDoc, Item } from '../shared/types.ts';

/** True when a local edit touches a field owned by an imported source. */
export function shouldWriteBack(item: Item, patch: Record<string, unknown>): boolean {
  const fields = item.source === 'Pinboard'
    ? ['title', 'commentary', 'tags']
    : item.source === 'Micro.blog'
      ? ['title', 'body']
      : [];
  return fields.some((field) => field in patch);
}

export type ReadinessKind = 'required' | 'commentary' | 'sync' | 'thingy';

export interface Readiness {
  units: {
    done: boolean;
    title: string;
    anchor: string;
    kind: ReadinessKind;
    context?: string;
  }[];
  done: number;
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
  send: { status: string; url?: string; external_id?: string; error?: string };
  /** Podcast only. */
  audio?: {
    audio_url?: string;
    audio_duration_seconds?: number;
    audio_byte_size?: number;
    audio_voice?: string;
  };
  chunks?: number;
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
  sends: Record<string, { status: string; url?: string; error?: string }>;
  readiness: number;
  /** One entry per readiness unit — the dashboard draws these as the strip. */
  ticks: boolean[];
  outstanding: number;
  counts: { items: number; links: number; journal: number };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(payload.error ?? `${res.status} ${res.statusText}`);
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

  updateItem: (id: string, itemId: string, patch: Record<string, unknown>) =>
    call<IssueResponse>(`/issues/${id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  setChannel: (id: string, itemId: string, channel: Channel, on: boolean) =>
    post(`/issues/${id}/items/${itemId}/channel`, { channel, on }),

  setVisible: (id: string, itemId: string, visible: boolean) =>
    post(`/issues/${id}/items/${itemId}/visibility`, { visible }),

  promote: (id: string, itemId: string) => post(`/issues/${id}/items/${itemId}/promote`),
  demote: (id: string, nodeId: string) => post(`/issues/${id}/nodes/${nodeId}/demote`),

  moveNode: (id: string, nodeId: string, delta: number) =>
    post(`/issues/${id}/nodes/${nodeId}/move`, { delta }),

  moveItem: (id: string, nodeId: string, itemId: string, delta: number) =>
    post(`/issues/${id}/nodes/${nodeId}/items/${itemId}/move`, { delta }),

  removeNode: (id: string, nodeId: string) =>
    call<IssueResponse>(`/issues/${id}/nodes/${nodeId}`, { method: 'DELETE' }),

  removeItem: (id: string, nodeId: string, itemId: string) =>
    call<IssueResponse>(`/issues/${id}/nodes/${nodeId}/items/${itemId}`, { method: 'DELETE' }),

  renameNode: (id: string, nodeId: string, label: string) =>
    post(`/issues/${id}/nodes/${nodeId}/rename`, { label }),

  addNode: (id: string, body: { type?: string; label?: string; id?: string; kind?: string; before?: string }) =>
    post(`/issues/${id}/nodes`, body),

  /** One item into an existing node — a Currently entry, a written link. */
  addItem: (id: string, nodeId: string, type: string) =>
    post(`/issues/${id}/nodes/${nodeId}/items`, { type }),

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
  draftItem: (id: string, itemId: string, context?: string) =>
    call<{ candidates: string[]; archive_references?: { issue: number; url: string; note?: string }[] }>(
      `/issues/${id}/items/${itemId}/draft`,
      { method: 'POST', body: JSON.stringify({ context }) },
    ),

  /** An editorial read. Advisory only — notes never gate publishing. */
  review: (id: string, only?: string) =>
    post(`/issues/${id}/review`, { only }) as Promise<IssueResponse & { review: unknown }>,

  writeBack: (id: string, itemId: string) =>
    post(`/issues/${id}/items/${itemId}/writeback`) as Promise<
      IssueResponse & { result: { sync_state: string; error?: string } }
    >,

  send: (id: string, destination: string) =>
    call<SendResult>(`/issues/${id}/send/${destination}`, { method: 'POST', body: '{}' }),

  /** What a leg would commit, committing nothing. website and archive only. */
  sendPreview: (id: string, leg: 'website' | 'archive') =>
    call<{ repo: string; sha: string; changed: string[]; unchanged: number }>(
      `/issues/${id}/send/${leg}/preview`,
    ),
};
