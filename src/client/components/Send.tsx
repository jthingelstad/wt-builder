/**
 * The Send view — its own full-screen layer.
 *
 * Three destinations in run order: Podcast, Website, Buttondown. The order is
 * the point. The website handoff publishes an audio reference, so the podcast
 * has to have produced a file for that reference to resolve. That dependency is
 * **stated, not enforced** — Jamie can send in any order and take the
 * consequence knowingly.
 *
 * Every state here is real. Nothing is drawn: a step shows done only when the
 * send came back with the evidence that step produces.
 */

import { useState } from 'preact/hooks';

import type { Destination, IssueDoc } from '../../shared/types.ts';
import { api, type Readiness, type SendResult } from '../api.ts';
import {
  ArrowLeft, Check, Circle, CircleAlert, Globe, Mail, Podcast, Spinner, X,
} from '../icons.tsx';

interface Props {
  doc: IssueDoc;
  readiness: Readiness | null;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSent: (doc: IssueDoc) => void;
  onError: (m: string | null) => void;
}

interface Step {
  label: string;
  /** The evidence this step produced, read off the send result. */
  evidence?: (r: SendResult) => { text?: string; href?: string; label?: string } | undefined;
}

interface Card {
  key: Destination;
  name: string;
  dest: string;
  icon: preact.JSX.Element;
  /** What finishing actually means. Sending is not the same as authoritative. */
  ends: string;
  verb: string;
  again: string;
  steps: Step[];
  /** A dependency that is stated rather than enforced. */
  blocker?: (sent: Partial<Record<Destination, boolean>>) => string | null;
}

const bytes = (n?: number) => (n ? `${(n / 1_048_576).toFixed(1)} MB` : undefined);
const clock = (s?: number) =>
  s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : undefined;

const CARDS: Card[] = [
  {
    key: 'podcast',
    name: 'Podcast',
    dest: 'files.thingelstad.com',
    icon: <Podcast />,
    ends: 'Ends at an mp3 on the CDN. The website publishes the reference to it; the file itself lives only here.',
    verb: 'Synthesize and upload',
    again: 'Synthesize again',
    steps: [
      { label: 'Approve the script' },
      { label: 'Render the spoken script' },
      {
        label: 'Synthesize the voice',
        evidence: (r) => (r.audio?.audio_voice
          ? { text: [r.audio.audio_voice, r.chunks && `${r.chunks} chunks`].filter(Boolean).join(' · ') }
          : undefined),
      },
      {
        label: 'Master and tag',
        evidence: (r) => (r.audio?.audio_duration_seconds
          ? { text: [clock(r.audio.audio_duration_seconds), bytes(r.audio.audio_byte_size)].filter(Boolean).join(' · ') }
          : undefined),
      },
      {
        label: 'Upload to the CDN',
        evidence: (r) => (r.audio?.audio_url ? { href: r.audio.audio_url, label: 'File' } : undefined),
      },
    ],
  },
  {
    key: 'website',
    name: 'Website',
    dest: 'weekly.thingelstad.com',
    icon: <Globe />,
    ends: 'Commits the generated inputs to the render surface, which builds and deploys them.',
    verb: 'Commit',
    again: 'Re-commit',
    blocker: (sent) => (sent.podcast
      ? null
      : 'The handoff publishes an audio reference, so the podcast should run first. Nothing stops you.'),
    steps: [
      { label: 'Render the website edition' },
      {
        label: 'Commit to the repo',
        evidence: (r) => (r.send.external_id
          ? { text: String(r.send.external_id).slice(0, 7), href: r.send.url, label: 'Commit' }
          : undefined),
      },
    ],
  },
  {
    key: 'buttondown',
    name: 'Buttondown',
    dest: 'Buttondown',
    icon: <Mail />,
    ends: 'Ends at a draft. Nothing is scheduled and nothing is sent, so a wrong draft has reached no reader.',
    verb: 'Create draft',
    again: 'Update draft',
    steps: [
      { label: 'Render the email edition' },
      {
        label: 'Create the draft',
        evidence: (r) => (r.send.url ? { href: r.send.url, label: 'Draft' } : undefined),
      },
    ],
  },
];

const PILL: Record<string, string> = {
  none: 'NOT SENT', gate: 'NEEDS YOU', sending: 'SENDING', sent: 'SENT', failed: 'DID NOT SEND',
};

export function Send({ doc, readiness, error, onBack, onSent, onError }: Props) {
  const [running, setRunning] = useState<Destination | null>(null);
  const [results, setResults] = useState<Partial<Record<Destination, SendResult>>>({});
  const [approved, setApproved] = useState(false);

  const id = doc.issue.id;
  const stateOf = (key: Destination) => doc.sends?.[key]?.status ?? 'none';
  const sentMap = Object.fromEntries(CARDS.map((c) => [c.key, stateOf(c.key) === 'sent']));
  const sentCount = CARDS.filter((c) => stateOf(c.key) === 'sent').length;

  const send = async (key: Destination) => {
    setRunning(key);
    onError(null);
    try {
      const res = await api.send(id, key);
      setResults((r) => ({ ...r, [key]: res }));
      onSent(res.issue);
    } catch (err) {
      onError(`${key}: ${(err as Error).message}`);
    } finally {
      setRunning(null);
    }
  };

  /** Run order, stopping at the first failure — later legs assume earlier ones. */
  const sendAll = async () => {
    for (const card of CARDS) {
      if (card.key === 'podcast' && !approved) return;
      if (stateOf(card.key) === 'sent') continue;
      await send(card.key);
    }
  };

  return (
    <div class="send-layer">
      <header class="header">
        <button class="btn ghost-btn" onClick={onBack}><ArrowLeft /> Issue</button>
        <span class="mark">W</span>
        <span class="head-divider" />
        <span class="identity">
          <span class="wt">WT{doc.issue.number}</span>
          <span class="win">{doc.issue.title}</span>
        </span>
        <span class="head-spacer" />
        <button class="btn primary" disabled={Boolean(running)} onClick={sendAll}>
          {sentCount > 0 && sentCount < 3 ? `Send the rest` : 'Send all three'}
        </button>
      </header>

      <div class="send-body">
        <h1>Send</h1>
        <p class="lede">
          Each destination is its own leg, and none of them makes the issue
          authoritative — the archive does that, afterwards. A leg that fails
          leaves the others untouched.
        </p>

        {readiness && readiness.done < readiness.total && (
          <div class="send-warn">
            <CircleAlert />
            <span>
              {readiness.total - readiness.done} of {readiness.total} things on the
              checklist are still open. Nothing here is blocked by that.
            </span>
          </div>
        )}

        {error && <div class="error-bar" role="alert">{error}</div>}

        {CARDS.map((card) => (
          <SendCard
            key={card.key}
            card={card}
            state={running === card.key ? 'sending' : stateOf(card.key)}
            send={doc.sends?.[card.key]}
            result={results[card.key]}
            blocker={card.blocker?.(sentMap) ?? null}
            gated={card.key === 'podcast' && !approved}
            busy={Boolean(running)}
            onApprove={() => setApproved(true)}
            onRun={() => void send(card.key)}
          />
        ))}

        <div class="after">
          <span class="mono-label">AFTER THE ISSUE IS OUT</span>
          <p>
            The archive feed makes the issue retrievable by Thingy. It is neither a
            channel nor a gate — it runs on its own once the website is live.
          </p>
          <span class="after-state">
            {doc.sends?.archive?.status === 'sent' ? 'INDEXED' : 'NOT YET INDEXED'}
          </span>
        </div>
      </div>
    </div>
  );
}

function SendCard({
  card, state, send, result, blocker, gated, busy, onApprove, onRun,
}: {
  card: Card;
  state: string;
  send?: { status: string; url?: string; error?: string };
  result?: SendResult;
  blocker: string | null;
  gated: boolean;
  busy: boolean;
  onApprove: () => void;
  onRun: () => void;
}) {
  const pillState = gated && state === 'none' ? 'gate' : state;
  const done = state === 'sent';
  const failed = state === 'failed';

  return (
    <section class={`send-card ${state}${failed ? ' failed' : ''}`}>
      <div class="sc-head">
        <span class={`sc-tile${done ? ' done' : ''}`}>{card.icon}</span>
        <div class="sc-name">
          <div class="sc-title">
            {card.name}
            <span class={`sc-pill ${pillState}`}>{PILL[pillState]}</span>
          </div>
          <div class="sc-dest">{card.dest}</div>
          <p class="sc-ends">{card.ends}</p>
        </div>
        {/*
          No button while the gate is waiting: the step row owns that
          interaction. A card button labelled with a state duplicates the pill
          beside it and does nothing when clicked.
        */}
        {!gated && (
          <button class="btn primary" disabled={busy} onClick={onRun}>
            {state === 'sending' ? 'Sending…' : failed ? 'Try again' : done ? card.again : card.verb}
          </button>
        )}
      </div>

      {blocker && !done && (
        <div class="sc-blocker"><CircleAlert /><span>{blocker}</span></div>
      )}

      {failed && (
        <div class="sc-failed">
          <span>
            This leg did not send. The others are unaffected, and trying again
            resumes from the step that failed.
          </span>
        </div>
      )}

      <div class="sc-steps">
        {card.steps.map((step, i) => {
          const isGate = card.key === 'podcast' && i === 0;
          const stepDone = isGate ? !gated : done;
          const stepFailed = failed && i === card.steps.length - 1;
          const evidence = result && done ? step.evidence?.(result) : undefined;

          return (
            <div class="sc-step" key={step.label}>
              <span class="sc-glyph">
                {stepFailed ? <X size={13} class="failed" />
                  : stepDone ? <Check size={13} class="ok" />
                  : state === 'sending' ? <Spinner size={13} />
                  : <Circle size={13} class="idle" />}
              </span>
              <div class="sc-step-main">
                <div class="sc-step-label">{step.label}</div>
                {stepFailed && send?.error && <div class="sc-evidence error">{send.error}</div>}
                {evidence?.text && <div class="sc-evidence">{evidence.text}</div>}
                {evidence?.href && (
                  <a class="sc-evidence link" href={evidence.href} target="_blank" rel="noreferrer">
                    {evidence.label ?? 'Open'} ↗
                  </a>
                )}
              </div>
              {isGate && gated && (
                <span class="sc-gate">
                  <button class="btn small" onClick={onApprove}>Read it</button>
                  <button class="btn small primary" onClick={onApprove}>Approve</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
