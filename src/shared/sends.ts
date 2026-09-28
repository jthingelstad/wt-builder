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
