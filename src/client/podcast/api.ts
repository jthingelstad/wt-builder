/** The podcast's half of the client: /api/episodes, through the same `call` as the issue's. */

import { call } from '../api.ts';
import type { IssueEvent } from '../../shared/events.ts';
import type { Problem } from '../../shared/podcast/contract.ts';
import type { EpisodeReadiness } from '../../shared/podcast/readiness.ts';
import type { EpisodeTiming } from '../../shared/podcast/timing.ts';
import type { EpisodeDoc, RecordingSession, Segment } from '../../shared/podcast/types.ts';

/** What every episode route answers with (src/server/podcast/routes.ts, view). */
export interface EpisodeView {
  episode: EpisodeDoc;
  outline_version: string;
  readiness: EpisodeReadiness;
  problems: Problem[];
  timing: EpisodeTiming;
  busy: { mastering: boolean; transcribing: boolean; sending: boolean };
  audio_on_disk: boolean;
  url?: string;
}

export interface EpisodeSummary {
  id: string;
  number: number;
  title: string;
  status: string;
  date?: string;
  segments: number;
  planned_seconds: number | null;
  audio_seconds?: number;
  readiness: EpisodeReadiness;
  sent_at?: string;
  send?: string;
}

export interface EpisodePackage {
  problems: Problem[];
  files: { path: string; content: string }[];
  audio: { path: string; bytes: number } | null;
  repo: string;
  error?: string;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const podcastApi = {
  list: () => call<{ episodes: EpisodeSummary[]; next_number: number }>('/episodes'),
  create: (body: { number?: number; title?: string }) => call<EpisodeView>('/episodes', json('POST', body)),
  get: (id: string) => call<EpisodeView>(`/episodes/${id}`),
  patch: (id: string, body: Record<string, unknown>) => call<EpisodeView>(`/episodes/${id}`, json('PATCH', body)),
  remove: (id: string) => call<{ ok: true }>(`/episodes/${id}`, { method: 'DELETE' }),
  outline: (id: string, segments: Segment[], base: string) =>
    call<EpisodeView>(`/episodes/${id}/outline`, json('PUT', { segments, base })),
  session: (id: string, session: RecordingSession | null) =>
    call<EpisodeView>(`/episodes/${id}/session`, json('PUT', { session })),
  addNote: (id: string, note: { text: string; elapsed?: number; segmentId?: string }) =>
    call<EpisodeView>(`/episodes/${id}/notes`, json('POST', note)),
  removeNote: (id: string, index: number) => call<EpisodeView>(`/episodes/${id}/notes/${index}`, { method: 'DELETE' }),
  /** The recording's bytes as the body: no JSON, no base64 (a WAV is hundreds of MB). */
  upload: (id: string, file: File) =>
    call<EpisodeView>(`/episodes/${id}/audio?name=${encodeURIComponent(file.name)}`, {
      method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
    }),
  audioUrl: (id: string, bust?: string) => `/api/episodes/${id}/audio${bust ? `?v=${encodeURIComponent(bust)}` : ''}`,
  transcribe: (id: string, replace = false) => call<EpisodeView>(`/episodes/${id}/transcribe`, json('POST', { replace })),
  package: (id: string) => call<EpisodePackage>(`/episodes/${id}/package`),
  send: (id: string, force = false) => call<EpisodeView>(`/episodes/${id}/send${force ? '?force=1' : ''}`, { method: 'POST' }),
  verify: (id: string) => call<EpisodeView>(`/episodes/${id}/verify`, { method: 'POST' }),
  events: (id: string) => call<{ events: IssueEvent[] }>(`/episodes/${id}/events`),
};
