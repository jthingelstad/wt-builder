/**
 * Reading a send leg's state. A leg that is `sending` or `failed` still has
 * whatever it last delivered — the draft Buttondown holds, the mp3 on the
 * CDN, the commit on the site — and every reader that needs one of those
 * reads it here, so a failed retry never makes it look as if nothing went.
 */

import type { SendState, SentRecord } from './types.ts';

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
