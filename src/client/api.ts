/** Thin client for the service. Every credential stays on the far side of this. */

import type { Channel, IssueDoc } from '../shared/types.ts';

export interface Readiness {
  units: { done: boolean; title: string; anchor: string }[];
  done: number;
  total: number;
  pct: number;
}

export interface IssueResponse {
  issue: IssueDoc;
  readiness: Readiness;
}

export interface IssueSummary {
  id: string;
  number: number;
  title: string;
  publication_date: string;
  status: string;
  updated_at: string;
  sends: Record<string, { status: string; url?: string; error?: string }>;
  readiness: number;
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

  saveIssue: (doc: IssueDoc) =>
    call<IssueResponse>(`/issues/${doc.issue.id}`, { method: 'PUT', body: JSON.stringify(doc) }),

  deleteIssue: (id: string) => call<{ ok: true }>(`/issues/${id}`, { method: 'DELETE' }),

  sweep: (id: string) =>
    post(`/issues/${id}/sweep`) as Promise<IssueResponse & { report: { added: number; skipped: number; window: { from: string; to: string } } }>,

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

  renameNode: (id: string, nodeId: string, label: string) =>
    post(`/issues/${id}/nodes/${nodeId}/rename`, { label }),

  addNode: (id: string, body: { type?: string; label?: string; id?: string; kind?: string; before?: string }) =>
    post(`/issues/${id}/nodes`, body),

  availableSections: (id: string) =>
    call<{ sections: { id: string; type: string; label: string }[] }>(`/issues/${id}/available-sections`),

  settings: (id: string, body: Record<string, unknown>) => post(`/issues/${id}/settings`, body),

  writeBack: (id: string, itemId: string) =>
    post(`/issues/${id}/items/${itemId}/writeback`) as Promise<
      IssueResponse & { result: { sync_state: string; error?: string } }
    >,

  send: (id: string, destination: string) =>
    call<{ issue: IssueDoc; send: { status: string; url?: string; external_id?: string } }>(
      `/issues/${id}/send/${destination}`,
      { method: 'POST', body: '{}' },
    ),
};
