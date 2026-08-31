/**
 * The issue's event log — a sheet listing every action taken on the issue:
 * arrivals from the sweep, source-side refreshes, edits, outline moves,
 * write-backs, sends. The log narrates; it never decides anything.
 */

import { useEffect, useState } from 'preact/hooks';

import { api } from '../api.ts';

interface Ev {
  id: number;
  at: string;
  kind: string;
  summary: string;
}

/** Chip text per kind — words, not codes. */
const KIND: Record<string, string> = {
  issue: 'issue',
  sweep: 'scan',
  'swept-in': 'in',
  refreshed: 'refresh',
  gone: 'gone',
  conflict: 'conflict',
  edit: 'edit',
  structure: 'outline',
  channels: 'channels',
  settings: 'settings',
  sync: 'write',
  send: 'send',
  review: 'review',
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
  const [events, setEvents] = useState<Ev[] | null>(null);
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
            <div class="log-list">
              {events.map((e) => (
                <div key={e.id} class="log-row">
                  <span class="log-when">{when(e.at)}</span>
                  <span class="log-kind">{KIND[e.kind] ?? e.kind}</span>
                  <span class="log-what">{e.summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div class="sheet-foot">
          <button class="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
