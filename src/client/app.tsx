import { useCallback, useEffect, useState } from 'preact/hooks';

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

  const absorb = useCallback((res: IssueResponse) => {
    setDoc(res.issue);
    setReadiness(res.readiness);
    setError(null);
  }, []);

  /**
   * Every mutation goes through here: it runs the call, absorbs the returned
   * document, and surfaces the failure without discarding what is on screen.
   */
  const run = useCallback(
    async (fn: () => Promise<IssueResponse>) => {
      setBusy(true);
      try {
        absorb(await fn());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [absorb],
  );

  /** Move, and leave a history entry so Back means what it looks like. */
  const go = useCallback((next: Route, replace = false) => {
    setRoute((current) => {
      if (sameRoute(current, next)) return current;
      history[replace ? 'replaceState' : 'pushState']({}, '', routeHref(next));
      return next;
    });
  }, []);

  // The browser's own back and forward.
  useEffect(() => {
    const pop = () => setRoute(parseRoute(location.pathname));
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
      .then((res) => { if (live) absorb(res); })
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

  if (route.view === 'index' || !doc) {
    return (
      <IssueIndex
        error={error}
        loading={loading}
        onError={setError}
        onOpen={(id) => go({ view: 'issue', id })}
      />
    );
  }

  if (route.view === 'send') {
    return (
      <Send
        doc={doc}
        readiness={readiness}
        busy={busy}
        error={error}
        onBack={() => go({ view: 'issue', id: doc.issue.id })}
        onSent={(next) => setDoc(next)}
        onError={setError}
      />
    );
  }

  return (
    <Editor
      doc={doc}
      readiness={readiness}
      busy={busy}
      error={error}
      run={run}
      onIndex={() => go({ view: 'index' })}
      onSend={() => go({ view: 'send', id: doc.issue.id })}
      onError={setError}
    />
  );
}
