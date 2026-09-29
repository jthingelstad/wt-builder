/**
 * Reading a send leg's state. A leg that is `sending` or `failed` still has
 * whatever it last delivered — the draft Buttondown holds, the mp3 on the
 * CDN, the commit on the site — and every reader that needs one of those
 * reads it here, so a failed retry never makes it look as if nothing went.
 */

import type { SendState, SentRecord, Verification } from './types.ts';

/**
 * How long a persisted `sending` counts as a leg in flight. Older, a crash
 * or a restart stranded it, and the server lets a retry through; the Send
 * view stops treating it as out at the same moment.
 */
export const IN_FLIGHT_MS = 10 * 60_000;

/** A leg the server has out now: `sending`, and younger than the in-flight window. */
export function isOut(state: SendState | undefined, now = Date.now()): boolean {
  if (state?.status !== 'sending') return false;
  const age = now - Date.parse(state.at ?? '');
  return Number.isFinite(age) && age < IN_FLIGHT_MS;
}

/** The leg's last successful send: itself when sent, else what it carried forward. */
export function lastSent(state: SendState | undefined): SentRecord | undefined {
  if (!state) return undefined;
  if (state.status === 'sent') {
    const { last_sent: _carried, error: _error, ...sent } = state;
    return { ...sent, status: 'sent' };
  }
  return state.last_sent;
}

/**
 * The email Buttondown holds for this issue: the id and archive URL of the
 * last good send. A failed state from before `last_sent` existed carried the
 * draft id on itself and nothing else, so the id falls back to it — the one
 * reader for the Buttondown retry, the website page, the archive, and verify,
 * so none of them writes an empty id where another finds the draft.
 */
export function emailOf(state: SendState | undefined): { id?: string; url?: string } {
  const sent = lastSent(state);
  return { id: sent?.external_id ?? state?.external_id, url: sent?.url };
}

/**
 * The episode the website page would embed, when there is one: the audio
 * the podcast leg last delivered. What the website leg waits for — not the
 * podcast's status, which a failed re-render turns to `failed` while the
 * last episode is still on the CDN (review 2026-09-27 §2.1).
 */
export function recordedAudioUrl(sends: Partial<Record<string, SendState>> | undefined): string | undefined {
  const url = lastSent(sends?.podcast)?.audio?.audio_url;
  return typeof url === 'string' && url ? url : undefined;
}

/**
 * The Buttondown record a refused re-send leaves when no check has run: the
 * one fact Buttondown gave — the email's status, which is not `draft` — and
 * nothing more. Never `passed`: subject, body and delivery were not read, so
 * the card must go on saying it is not verified until the real check
 * (started beside it) lands.
 */
export function refusedNotDraft(at: string, status: string): Verification {
  return {
    status: 'waiting',
    at,
    remote_status: status,
    checks: [{
      label: 'Status',
      ok: null,
      detail: `Buttondown said "${status}" when a re-send was refused. Subject, body and delivery have not been checked yet.`,
    }],
  };
}
