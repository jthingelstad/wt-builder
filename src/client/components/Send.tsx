import { useEffect, useState } from 'preact/hooks';

import type { Destination, IssueDoc } from '../../shared/types.ts';
import { api, type Readiness } from '../api.ts';
import { ArrowLeft, Globe, Mail, Mic, Spinner } from '../icons.tsx';

interface Props {
  doc: IssueDoc;
  readiness: Readiness | null;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSent: (doc: IssueDoc) => void;
  onError: (m: string | null) => void;
}

interface ChannelSpec {
  key: Destination;
  name: string;
  dest: string;
  /** What sending actually ends at. Nothing here becomes authoritative. */
  ends: string;
  icon: preact.JSX.Element;
  built: boolean;
  /** Each destination says what it actually does, not Buttondown's words. */
  verb: string;
  again: string;
  resultLabel: string;
  openLabel: string;
}

const CHANNELS: ChannelSpec[] = [
  {
    key: 'buttondown',
    name: 'Email',
    dest: 'Buttondown',
    ends: 'Ends at a draft. Nothing is scheduled and nothing is sent, so a wrong draft has reached no reader. Sending again replaces the draft.',
    icon: <Mail />,
    built: true,
    verb: 'Create draft',
    again: 'Update draft',
    resultLabel: 'Draft',
    openLabel: 'Open in Buttondown',
  },
  {
    key: 'website',
    name: 'Website',
    dest: 'weekly.thingelstad.com',
    ends: 'Commits the generated inputs to the render surface, which builds and deploys them.',
    icon: <Globe />,
    built: true,
    verb: 'Commit',
    again: 'Re-commit',
    resultLabel: 'Commit',
    openLabel: 'View on GitHub',
  },
  {
    key: 'podcast',
    name: 'Podcast',
    dest: 'files.thingelstad.com',
    ends: 'Renders the script, synthesizes the audio, and uploads it to the CDN. The website publishes the reference.',
    icon: <Mic />,
    built: true,
    verb: 'Render audio',
    again: 'Re-render',
    resultLabel: 'Audio',
    openLabel: 'Listen',
  },
];

/**
 * Sending runs per destination, and each is independent: a failure in one does
 * not stop the others, and a failed leg resumes from where it stopped.
 */
export function Send({ doc, readiness, error, onBack, onSent, onError }: Props) {
  const [running, setRunning] = useState<Destination | null>(null);
  const sends = doc.sends ?? {};
  const blockers = readiness ? readiness.units.filter((u) => !u.done) : [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const send = async (destination: Destination) => {
    setRunning(destination);
    onError(null);
    try {
      const res = await api.send(doc.issue.id, destination);
      onSent(res.issue);
    } catch (err) {
      onError((err as Error).message);
      // Re-read so the failed state persists on screen.
      try {
        const fresh = await api.getIssue(doc.issue.id);
        onSent(fresh.issue);
      } catch { /* keep what is on screen */ }
    } finally {
      setRunning(null);
    }
  };

  return (
    <>
      <header class="header">
        <button class="btn" onClick={onBack}><ArrowLeft /> Issue</button>
        <span class="num">WT{doc.issue.number}</span>
        <span class="title">{doc.issue.title}</span>
      </header>

      <div class="send">
        <h1>Send</h1>
        {error && <div class="banner error">{error}</div>}

        {blockers.length > 0 && (
          <div class="banner info">
            {blockers.length} thing{blockers.length === 1 ? '' : 's'} still open on the checklist.
            Sending is not blocked — a draft is reviewable — but the list is worth a look first.
          </div>
        )}

        {CHANNELS.map((c) => {
          const state = sends[c.key];
          const isRunning = running === c.key;
          return (
            <div class="channel-card" key={c.key}>
              <div class="channel-head">
                <span style="color:var(--muted);margin-top:2px">{c.icon}</span>
                <span style="flex:1;min-width:0">
                  <span style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
                    <span class="name">{c.name}</span>
                    <span class={`pill${state?.status === 'sent' ? ' sent' : state?.status === 'failed' ? ' failed' : ''}`}>
                      {state?.status?.toUpperCase() ?? 'NOT SENT'}
                    </span>
                  </span>
                  <span class="dest">{c.dest}</span>
                  <span class="ends">{c.ends}</span>
                </span>
                <button
                  class="btn primary"
                  disabled={!c.built || isRunning}
                  title={c.built ? `Send to ${c.dest}` : 'Not built yet'}
                  onClick={() => send(c.key)}
                >
                  {isRunning
                    ? <><Spinner size={12} /> Sending…</>
                    : !c.built
                      ? 'Not built yet'
                      : state?.status === 'sent'
                        ? c.again
                        : state?.status === 'failed'
                          ? 'Retry'
                          : c.verb}
                </button>
              </div>

              {state?.status === 'failed' && state.error && (
                <div class="channel-note failed">{state.error}</div>
              )}
              {state?.status === 'sent' && (
                <div class="channel-note ok">
                  {c.resultLabel} {(state.external_id ?? '').slice(0, 48)}
                  {state.url && <> · <a href={state.url} target="_blank" rel="noreferrer">{c.openLabel}</a></>}
                  {state.at && <> · {state.at.slice(0, 16).replace('T', ' ')}</>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
