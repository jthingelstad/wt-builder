/**
 * The issue's event log — a sheet listing every action taken on the issue:
 * arrivals from the sweep, source-side refreshes, edits, outline moves,
 * write-backs, sends. The log narrates; it never decides anything.
 */

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';
import type { EventActor, EventKind, IssueEvent } from '../../shared/events.ts';

/** Chip text per kind — words, not codes. Every kind has one (the type says so). */
export const KIND: Record<EventKind, string> = {
  issue: 'issue',
  sweep: 'scan',
  'swept-in': 'in',
  refreshed: 'refresh',
  conflict: 'conflict',
  gone: 'gone',
  dropped: 'dropped',
  kept: 'kept',
  'held-out': 'held out',
  'put-back': 'put back',
  moved: 'moved',
  edit: 'edit',
  structure: 'outline',
  channels: 'channels',
  settings: 'settings',
  source: 'source',
  write: 'write',
  links: 'links',
  review: 'review',
  wand: 'wand',
  send: 'send',
  verify: 'verify',
  share: 'share',
};

/** Who, for a row that is not Jamie's own act. */
export const ACTOR: Record<EventActor, string> = {
  jamie: 'You',
  'wt-builder': 'WT Builder',
  source: 'The source',
};

function when(at: string): string {
  return new Date(at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function EventLog({ issueId, number, onClose }: {
  issueId: string;
  number: number;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<IssueEvent[] | null>(null);
  // Jamie's own acts only: the service's write-backs, verifications and
  // scans are most of a long log.
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.events(issueId)
      .then((r) => setEvents(r.events))
      .catch((e) => setError((e as Error).message));
  }, [issueId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div class="scrim" onClick={onClose}>
      <div class="sheet log-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-body">
          <h2>WT{number} — the log</h2>
          {error && <p class="err-note">{error}</p>}
          {events && !events.length && (
            <p class="quiet">Nothing yet. Actions land here as they happen.</p>
          )}
          {events && events.length > 0 && (
            <>
              <label class="log-filter">
                <input type="checkbox" checked={mine} onChange={(e) => setMine((e.target as HTMLInputElement).checked)} />
                {' '}Only what you did
              </label>
              <div class="log-list">
                {events.filter((e) => !mine || e.actor === 'jamie').map((e) => (
                  <div key={e.id} class={`log-row${e.actor === 'jamie' ? '' : ' auto'}`}>
                    <span class="log-when">{when(e.at)}</span>
                    <span class="log-kind" title={ACTOR[e.actor]}>{KIND[e.kind] ?? e.kind}</span>
                    <span class="log-what">{e.summary}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div class="sheet-foot">
          <button class="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
