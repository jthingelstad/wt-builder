/**
 * The Send view — its own full-screen layer.
 *
 * Four destinations in run order: Podcast, Website, Buttondown, Archive. The order is
 * the point. The website handoff publishes an audio reference, so the podcast
 * has to have produced a file for that reference to resolve. That dependency is
 * **stated, not enforced** — Jamie can send in any order and take the
 * consequence knowingly.
 *
 * Every state here is real. Nothing is drawn: a step shows done only when the
 * send came back with the evidence that step produces.
 */

import { useEffect, useState } from 'preact/hooks';

import type { Destination, IssueDoc, Verification } from '../../shared/types.ts';
import { api, type Readiness, type SendResult } from '../api.ts';
import {
  Archive, ArrowLeft, Check, Circle, CircleAlert, Globe, Mail, Podcast, Spinner, X,
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
          ? { text: [r.audio.audio_voice, r.pieces && `${r.pieces} blocks${r.synthesized !== undefined ? `, ${r.synthesized} new` : ''}`].filter(Boolean).join(' · ') }
          : undefined),
      },
      {
        label: 'Chapter and transcribe',
        evidence: (r) => (r.audio?.audio_chapters_url
          ? { href: r.audio.audio_chapters_url, label: 'Chapters', text: r.audio.audio_transcript_url ? 'and the WebVTT transcript' : undefined }
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
      : 'The page embeds the podcast’s audio reference, so the podcast runs first. The server refuses a commit without it.'),
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
    ends: 'Ends at a draft: WT Builder never schedules or sends, so a wrong draft reaches no reader. You send it from Buttondown, and Verify follows it until it has gone.',
    verb: 'Create draft',
    again: 'Update draft',
    steps: [
      { label: 'Render the email edition' },
      {
        label: 'Create the draft',
        // The editor, not the public archive: the draft is opened to be scheduled.
        evidence: (r) => (r.send.edit_url ?? r.send.url ? { href: r.send.edit_url ?? r.send.url!, label: 'Draft' } : undefined),
      },
    ],
  },
  {
    // A leg like the others (Jamie, WT351): the archive is where Thingy
    // answers from, and it is how the issue lasts. It runs last because it
    // holds published issues only — a draft committed here would put
    // unpublished text in front of readers asking Thingy.
    key: 'archive',
    name: 'Archive',
    dest: 'librarian-thing',
    icon: <Archive />,
    ends: 'Commits the canonical text to the corpus repository, where the Librarian indexes it and Thingy retrieves from it.',
    verb: 'Commit to archive',
    again: 'Re-commit',
    blocker: (sent) => (sent.website && sent.buttondown
      ? null
      : 'The archive holds published issues, so it goes after the website and Buttondown legs.'),
    steps: [
      { label: 'Render the archive files' },
      {
        label: 'Commit to the corpus',
        evidence: (r) => (r.send.external_id
          ? { text: String(r.send.external_id).slice(0, 7), href: r.send.url, label: 'Commit' }
          : undefined),
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

  // Verification runs on the server after each leg — a couple of minutes for
  // the podcast's listening, the site's deploy for the website — so while any
  // is running the view re-reads the issue until the results land.
  const verifying = CARDS.some((c) => doc.verify?.[c.key]?.status === 'running');
  const waiting = CARDS.some((c) => doc.verify?.[c.key]?.status === 'waiting');
  useEffect(() => {
    if (!verifying && !waiting) return;
    const t = setInterval(() => {
      api.getIssue(id).then((r) => onSent(r.issue)).catch(() => { /* next tick */ });
    }, verifying ? 5000 : 60_000);
    return () => clearInterval(t);
  }, [verifying, waiting, id]);

  const verify = (key: Destination) => {
    api.verify(id, key).then((r) => onSent(r.issue)).catch((err: Error) => onError(`${key}: ${err.message}`));
  };

  /** One leg. True when it went; a failure is shown and stops any run it is part of. */
  const send = async (key: Destination): Promise<boolean> => {
    setRunning(key);
    onError(null);
    try {
      const res = await api.send(id, key);
      setResults((r) => ({ ...r, [key]: res }));
      onSent(res.issue);
      return true;
    } catch (err) {
      onError(`${key}: ${(err as Error).message}`);
      return false;
    } finally {
      setRunning(null);
    }
  };

  /** Run order, stopping at the first failure — later legs assume earlier ones. */
  const sendAll = async () => {
    for (const card of CARDS) {
      if (card.key === 'podcast' && !approved) return;
      if (stateOf(card.key) === 'sent') continue;
      if (!(await send(card.key))) return;
    }
  };

  /**
   * After a fix, every text leg that has already gone out goes out again, in
   * run order: website, Buttondown, archive. WT350's send day ended with an
   * hour of re-sending those three by hand, twice (Jamie, 2026-09-20). The
   * podcast is not among them — re-sending it re-synthesizes and replaces
   * the mp3, which a text fix never wants; its own card does that on purpose.
   */
  const RESEND: Destination[] = ['website', 'buttondown', 'archive'];
  const resendable = RESEND.filter((key) => stateOf(key) === 'sent');
  const resendAll = async () => {
    for (const key of resendable) {
      if (!(await send(key))) return;
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
        {resendable.length > 0 && (
          <button
            class="btn" disabled={Boolean(running)} onClick={resendAll}
            title={`Re-send ${resendable.join(', ')} in order. The podcast is left as it is — its card re-synthesizes on purpose.`}
          >
            Re-send all sent
          </button>
        )}
        {sentCount < CARDS.length && (
          <button class="btn primary" disabled={Boolean(running)} onClick={sendAll}>
            {sentCount > 0 ? 'Send the rest' : 'Send all four'}
          </button>
        )}
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
            issueId={id}
            verification={doc.verify?.[card.key]}
            onVerify={() => verify(card.key)}
          />
        ))}

      </div>
    </div>
  );
}

/**
 * What the archive commit would change in the corpus repository, changing
 * nothing — a draft must never be committed there, and this is how to look
 * before committing (or before re-committing after a fix).
 */
function ArchivePreview({ issueId }: { issueId: string }) {
  const [preview, setPreview] = useState<{ repo: string; changed: string[]; unchanged: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setLoading(true);
    setErr(null);
    api.sendPreview(issueId, 'archive')
      .then(setPreview)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  return (
    <div class="sc-preview">
      <div class="sv-head">
        <span class="mono-label">PREVIEW</span>
        <span class="head-spacer" />
        <button class="btn small" disabled={loading} onClick={load}>{loading ? 'Diffing…' : 'What would change'}</button>
      </div>
      {err && <div class="sc-evidence error">{err}</div>}
      {preview && (
        <div class="after-preview">
          <span class="mono-label">WOULD COMMIT TO {preview.repo.toUpperCase()}</span>
          {preview.changed.length === 0
            ? <span class="quiet">Nothing — the corpus already matches this issue.</span>
            : preview.changed.map((f) => <code key={f}>~ {f}</code>)}
        </div>
      )}
    </div>
  );
}

function SendCard({
  card, state, send, result, blocker, gated, busy, onApprove, onRun, verification, onVerify, issueId,
}: {
  issueId: string;
  verification?: Verification;
  onVerify: () => void;
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

      {card.key === 'archive' && <ArchivePreview issueId={issueId} />}
      {done && <VerifyPanel v={verification} busy={busy} onVerify={onVerify} />}
    </section>
  );
}

const VERDICT: Record<Verification['status'], string> = {
  running: 'CHECKING', passed: 'VERIFIED', waiting: 'WAITING', warnings: 'LOOK AT THIS', problems: 'NOT RIGHT', error: 'COULD NOT CHECK',
};

/**
 * What the destination says now, read back after the leg went out: the files
 * on the CDN, the live page and feed, the draft in Buttondown, the audio as
 * whisper hears it. Sent is not the same as right; this is the second half.
 */
function VerifyPanel({ v, busy, onVerify }: { v?: Verification; busy: boolean; onVerify: () => void }) {
  const running = v?.status === 'running';
  return (
    <div class={`sc-verify ${v?.status ?? 'none'}`}>
      <div class="sv-head">
        <span class="mono-label">VERIFY</span>
        {v && <span class={`sc-pill ${v.status}`}>{VERDICT[v.status]}</span>}
        {running && <Spinner size={12} />}
        {v && !running && <span class="sv-at">{new Date(v.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
        <span class="head-spacer" />
        <button class="btn small" disabled={busy || running} onClick={onVerify}>
          {v ? 'Check again' : 'Check it'}
        </button>
      </div>
      {!v && <div class="sv-none">Not checked yet.</div>}
      {running && v.checks.length === 0 && <div class="sv-none">Reading it back from the destination…</div>}
      {v?.error && <div class="sc-evidence error">{v.error}</div>}
      {v?.status === 'waiting' && v.recheck_at && (
        <div class="sv-none">Looking again on its own at {new Date(v.recheck_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</div>
      )}
      {v?.checks.map((c) => (
        <div class="sc-step" key={c.label}>
          <span class="sc-glyph">
            {c.ok === true ? <Check size={13} class="ok" /> : c.ok === false ? <X size={13} class="failed" /> : <CircleAlert size={13} class="warn" />}
          </span>
          <div class="sc-step-main">
            <div class="sc-step-label">{c.label}</div>
            <div class="sc-evidence">{c.detail}</div>
            {c.items?.map((it) => <div class="sc-evidence item" key={it}>{it}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}
