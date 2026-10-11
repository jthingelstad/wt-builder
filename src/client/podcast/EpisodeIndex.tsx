/**
 * Another Thing's episodes: the podcast's dashboard, beside the issues'.
 * The heading and the rows, as the issue index is; a new episode takes the
 * next number and opens on its outline.
 */

import { useEffect, useState } from 'preact/hooks';

import { fmt } from '../../shared/podcast/pace.ts';
import { ArrowLeft, Plus } from '../icons.tsx';
import { podcastApi, type EpisodeSummary } from './api.ts';

interface Props {
  error: string | null;
  onError: (m: string | null) => void;
  onOpen: (id: string) => void;
  onIssues: () => void;
}

export function EpisodeIndex({ error, onError, onOpen, onIssues }: Props) {
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    podcastApi.list()
      .then((r) => { setEpisodes(r.episodes); setNext(r.next_number); })
      .catch((err: Error) => onError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const v = await podcastApi.create({});
      onOpen(v.episode.episode.id);
    } catch (err) {
      onError((err as Error).message);
      setCreating(false);
    }
  };

  return (
    <div class="app pc">
      <header class="header">
        <button class="btn small" onClick={onIssues}><ArrowLeft /> Issues</button>
        <span class="mark pc-mark">A</span>
        <span class="wordmark">Another Thing</span>
        <span class="head-spacer" />
        <button class="btn primary" disabled={creating || next === null} onClick={() => void create()}>
          <Plus /> {next !== null ? `Start AT${next}` : 'New episode'}
        </button>
      </header>

      <div class="index-body">
        <h1>Episodes</h1>
        {error && <div class="error-bar" role="alert">{error}</div>}
        {loading && <p class="quiet">Loading…</p>}
        {!loading && !episodes.length && (
          <p class="quiet">
            No episodes here yet. Episodes published before this builder live on another.thingelstad.com; the next one is AT{next}.
          </p>
        )}

        <div class="issue-rows">
          {episodes.map((e) => {
            const draft = e.status !== 'published';
            const send = e.send ?? 'none';
            const left = e.readiness.total - e.readiness.done;
            const facts = [
              `${e.segments} segment${e.segments === 1 ? '' : 's'}`,
              e.planned_seconds !== null ? `plan ${fmt(e.planned_seconds)}` : '',
              e.audio_seconds !== undefined ? `audio ${fmt(e.audio_seconds)}` : '',
            ].filter(Boolean).join(' · ');
            return (
              <div key={e.id} class={`issue-row${draft ? ' draft' : ''}`}>
                <div class="ir-line">
                  <span class="ir-num">AT{e.number}</span>
                  <span class="ir-main">
                    <span class={`ir-title${e.title ? '' : ' untitled'}`}>{e.title || 'No title yet'}</span>
                    <span class="ir-when">{e.date ? new Date(e.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'not recorded'}</span>
                    <span class="ir-counts">{facts}</span>
                  </span>
                  <span class="ir-chips">
                    <span class={`ir-chip ${send}`} title={send === 'sent' ? 'Sent to another.thingelstad.com' : send === 'failed' ? 'The last send failed' : send === 'sending' ? 'Sending…' : 'Not sent'}>
                      SITE
                    </span>
                  </span>
                  <span class="ir-actions">
                    <button class={`btn small${draft ? ' primary' : ''}`} onClick={() => onOpen(e.id)}>Open</button>
                  </span>
                  <span class="ir-right" />
                </div>
                {draft && (
                  <button class="ir-strip" onClick={() => onOpen(e.id)} aria-label={`Open AT${e.number}`}>
                    <span class="ir-ticks">
                      {e.readiness.units.map((u) => <span key={u.key} class={`ir-tick${u.done ? ' done' : ''}`} />)}
                    </span>
                    <span class={`ir-left${left === 0 ? ' ready' : ''}`}>{left === 0 ? 'READY' : `${left} LEFT`}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
