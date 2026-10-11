/**
 * The podcast's half of the app: the episode list, one episode, and its card.
 *
 * It holds its own episode and error, apart from the issue's: the two
 * products share the shell (the header, the log, the send guards on the
 * server) and nothing on screen. `run` is the issue's `run` over again:
 * every mutation absorbs the episode it answers with, and a failure is
 * shown without discarding what is on screen.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import type { Route } from '../router.ts';
import { podcastApi, type EpisodeView } from './api.ts';
import { Card } from './Card.tsx';
import { Episode } from './Episode.tsx';
import { EpisodeIndex } from './EpisodeIndex.tsx';

type PodcastRoute = Extract<Route, { view: 'episodes' | 'episode' | 'record' }>;

export function Podcast({ route, go }: { route: PodcastRoute; go: (r: Route, replace?: boolean) => void }) {
  const [view, setView] = useState<EpisodeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runError = useRef<string | null>(null);
  const wanted = route.view === 'episodes' ? null : route.id;
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;

  // An answer for an episode already left is dropped, as an issue's is.
  const absorb = useCallback((v: EpisodeView): boolean => {
    if (v.episode.episode.id !== wantedRef.current) return false;
    setView(v);
    return true;
  }, []);

  // Only a mutation that succeeds clears the message the last failed one put
  // up: the re-read after a refused outline save must leave the refusal on
  // screen, or Jamie never learns why the outline changed.
  const run = useCallback(async (fn: () => Promise<EpisodeView>): Promise<boolean> => {
    try {
      if (absorb(await fn())) setError((current) => (current !== null && current === runError.current ? null : current));
      return true;
    } catch (err) {
      runError.current = (err as Error).message;
      setError(runError.current);
      return false;
    }
  }, [absorb]);

  const load = useCallback((id: string) => {
    podcastApi.get(id)
      .then(absorb)
      .catch((err: Error) => {
        if (wantedRef.current !== id) return;
        setError(`${id}: ${err.message}`);
        go({ view: 'episodes' }, true);
      });
  }, [absorb, go]);

  useEffect(() => {
    if (!wanted) { setView(null); return; }
    if (view?.episode.episode.id === wanted) return;
    setError(null);
    load(wanted);
  }, [wanted]);

  // While the server masters, transcribes or sends in the background, look
  // again every few seconds so the panel says when it is done.
  const busy = view && (view.busy.mastering || view.busy.transcribing || view.busy.sending);
  useEffect(() => {
    if (!busy || !wanted) return;
    const t = setInterval(() => podcastApi.get(wanted).then(absorb).catch(() => { /* the next look says */ }), 4000);
    return () => clearInterval(t);
  }, [busy, wanted, absorb]);

  if (route.view === 'episodes' || !view || view.episode.episode.id !== route.id) {
    if (route.view !== 'episodes') return <div class="app pc"><p class="quiet pc-loading">Loading {route.id.toUpperCase()}…</p></div>;
    return (
      <EpisodeIndex
        error={error}
        onError={setError}
        onOpen={(id) => go({ view: 'episode', id })}
        onIssues={() => go({ view: 'index' })}
      />
    );
  }

  const id = view.episode.episode.id;
  if (route.view === 'record') {
    return <Card doc={view.episode} run={run} onExit={() => go({ view: 'episode', id })} />;
  }
  return (
    <Episode
      view={view}
      error={error}
      run={run}
      onError={setError}
      onIndex={() => go({ view: 'episodes' })}
      onRecord={() => go({ view: 'record', id })}
      onReload={() => load(id)}
    />
  );
}
