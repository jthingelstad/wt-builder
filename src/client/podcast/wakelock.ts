/**
 * Keep the screen awake while the card is up.
 *
 * The card is read from an iPad on a stand, and an iPad left alone for a
 * few minutes goes to sleep — mid-beat, microphone on. The Screen Wake Lock
 * API (Safari 16.4+, Chrome) holds it open. Two things the API does not do
 * on its own, which this hook does:
 *
 *   - a lock is released whenever the page is hidden (app switch, lock
 *     button); when the page is visible again it must be requested again;
 *   - the first request can be refused — low power mode, or a browser that
 *     wants a user gesture first — so a refused lock retries on the next
 *     tap or key, which on the card is the space that starts the clock.
 *
 * The status is surfaced only when the lock is NOT held: one line in the
 * card's foot, in the chrome's warning orange, saying the screen may sleep.
 * Held is the normal case and says nothing — the card's chrome does not grow.
 */

import { useEffect, useState } from 'preact/hooks';

export type WakeStatus = 'held' | 'off' | 'refused' | 'unsupported';

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

function wakeLockApi(): { request(type: 'screen'): Promise<WakeLockSentinelLike> } | null {
  const nav = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
  return nav.wakeLock ?? null;
}

export function useWakeLock(active: boolean): WakeStatus {
  const [status, setStatus] = useState<WakeStatus>(() => (wakeLockApi() ? 'off' : 'unsupported'));

  useEffect(() => {
    const api = wakeLockApi();
    if (!active || !api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let gone = false;

    const request = async () => {
      if (gone || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const s = await api.request('screen');
        if (gone) { void s.release(); return; }
        sentinel = s;
        s.addEventListener('release', () => { if (!gone) setStatus('off'); });
        setStatus('held');
      } catch {
        // Refused — not an error worth a dialog. Retry on the next gesture.
        setStatus('refused');
      }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') void request(); };
    const onGesture = () => { if (!sentinel || sentinel.released) void request(); };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    void request();

    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      if (sentinel && !sentinel.released) void sentinel.release();
      setStatus('off');
    };
  }, [active]);

  return status;
}
