import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import type { IssueDoc } from '../shared/types.ts';
import { api, type IssueResponse, type Readiness } from './api.ts';
import { parseRoute, routeHref, sameRoute, type Route } from './router.ts';
import { IssueIndex } from './components/Index.tsx';
import { Editor } from './components/Editor.tsx';
import { Send } from './components/Send.tsx';

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  const [doc, setDoc] = useState<IssueDoc | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  // The message the last failed run() put up. A success clears that one and
  // nothing else: a refusal the inspector reported, or a failed draft, stays
  // until Jamie dismisses it, where an unrelated save landing used to wipe it
  // before it could be read (review 2026-09-27, §1.4).
  const runError = useRef<string | null>(null);

  // The route as of now, for answers that land later. A scan, save or send
  // for the issue just left used to replace the one on screen, and the
  // editor then re-scanned it, in a loop (review 2026-09-27 §2.4). Set where
  // the route is set, so an answer landing before the next render is judged
  // against the route it will render.
  const routeRef = useRef(route);
  const onScreen = useCallback((issue: IssueDoc) => {
    const r = routeRef.current;
    return r.view !== 'index' && r.id === issue.issue.id;
  }, []);

  const absorb = useCallback((res: IssueResponse) => {
    if (!onScreen(res.issue)) return;
    setDoc(res.issue);
    setReadiness(res.readiness);
    setError((current) => (current !== null && current === runError.current ? null : current));
  }, []);

  /**
   * Every mutation goes through here: it runs the call, absorbs the returned
   * document, and surfaces the failure without discarding what is on screen.
   * It resolves to whether the call succeeded, so an editable can keep text
   * whose save failed on screen, marked unsaved (review 2026-09-27, §1.4).
   */
  const run = useCallback(
    async (fn: () => Promise<IssueResponse>): Promise<boolean> => {
      setBusy(true);
      try {
        absorb(await fn());
        return true;
      } catch (err) {
        runError.current = (err as Error).message;
        setError(runError.current);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [absorb],
  );

  /** Move, and leave a history entry so Back means what it looks like. */
  const go = useCallback((next: Route, replace = false) => {
    if (sameRoute(routeRef.current, next)) return;
    history[replace ? 'replaceState' : 'pushState']({}, '', routeHref(next));
    routeRef.current = next;
    setRoute(next);
  }, []);

  // The browser's own back and forward.
  useEffect(() => {
    const pop = () => {
      routeRef.current = parseRoute(location.pathname);
      setRoute(routeRef.current);
    };
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);

  /**
   * Load whatever the URL names. This is what makes a reload stay put and a
   * pasted link open the issue rather than the dashboard.
   */
  useEffect(() => {
    if (route.view === 'index') {
      setDoc(null);
      setReadiness(null);
      return;
    }
    if (doc?.issue.id === route.id) return;

    let live = true;
    setLoading(true);
    api.getIssue(route.id)
      // Opening an issue starts clean: what the last screen said was about it.
      .then((res) => { if (live) { absorb(res); setError(null); } })
      .catch((err: Error) => {
        if (!live) return;
        // A link to an issue that is gone lands on the dashboard, saying why,
        // rather than on an empty editor.
        setError(`${route.id}: ${err.message}`);
        go({ view: 'index' }, true);
      })
      .finally(() => { if (live) setLoading(false); });

    return () => { live = false; };
  }, [route, doc?.issue.id, absorb, go]);

  // Until the issue the route names has loaded, whatever doc is held is
  // another issue's, and is not shown.
  if (route.view === 'index' || !doc || doc.issue.id !== route.id) {
    return (
      <IssueIndex
        error={error}
        loading={loading}
        onError={setError}
        onOpen={(id) => go({ view: 'issue', id })}
      />
    );
  }

  // Send is a layer over the editor, which stays mounted beneath it: it used
  // to replace the editor, so every trip there and back re-scanned the draft
  // (posts/all is limited to once per five minutes) and lost the lens, the
  // inspector and the review's triage (review 2026-09-27 §2.4).
  const sending = route.view === 'send';
  return (
    <>
      <Editor
        key={doc.issue.id}
        doc={doc}
        readiness={readiness}
        busy={busy}
        error={error}
        run={run}
        covered={sending}
        onIndex={() => go({ view: 'index' })}
        onSend={() => go({ view: 'send', id: doc.issue.id })}
        onError={setError}
      />
      {sending && (
        <Send
          key={doc.issue.id}
          doc={doc}
          readiness={readiness}
          busy={busy}
          error={error}
          onBack={() => go({ view: 'issue', id: doc.issue.id })}
          onSent={(next) => { if (onScreen(next)) setDoc(next); }}
          onError={setError}
        />
      )}
    </>
  );
}
