import { useCallback, useState } from 'preact/hooks';

import type { IssueDoc } from '../shared/types.ts';
import { api, type IssueResponse, type Readiness } from './api.ts';
import { IssueIndex } from './components/Index.tsx';
import { Editor } from './components/Editor.tsx';
import { Send } from './components/Send.tsx';

export type View = 'index' | 'issue' | 'send';

export function App() {
  const [view, setView] = useState<View>('index');
  const [doc, setDoc] = useState<IssueDoc | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const openIssue = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        absorb(await api.getIssue(id));
        setView('issue');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [absorb],
  );

  if (view === 'index' || !doc) {
    return (
      <IssueIndex
        error={error}
        onError={setError}
        onOpen={openIssue}
      />
    );
  }

  if (view === 'send') {
    return (
      <Send
        doc={doc}
        readiness={readiness}
        busy={busy}
        error={error}
        onBack={() => setView('issue')}
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
      onIndex={() => { setView('index'); setDoc(null); }}
      onSend={() => setView('send')}
      onError={setError}
    />
  );
}
