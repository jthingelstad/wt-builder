/**
 * The issue index — a working dashboard, not a landing page.
 *
 * No kicker, no explanatory paragraph, no footnote: the heading and the rows.
 * Anything else here is furniture in front of the one thing Jamie came for,
 * which is the live issue.
 */

import { useEffect, useState } from 'preact/hooks';

import { api, type IssueSummary } from '../api.ts';
import {
  countdown, isSaturday, kickerDate, issueWindow, longDate, snapToSaturday,
  spanLabel, wallClock,
} from '../../shared/dates.ts';
import { Archive, Check, CircleAlert, Spinner } from '../icons.tsx';

interface Props {
  error: string | null;
  /** True while a URL-named issue is being fetched. */
  loading?: boolean;
  onError: (message: string | null) => void;
  onOpen: (id: string) => void;
}

export function IssueIndex({ error, loading: opening, onError, onOpen }: Props) {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [nextNumber, setNextNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.listIssues();
      setIssues(res.issues);
      setNextNumber(res.next_number);
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const draft = issues.find((i) => i.status === 'draft');

  const sendArchive = async (id: string) => {
    setArchiving(id);
    try {
      await api.send(id, 'archive');
      await load();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setArchiving(null);
    }
  };

  return (
    <div class="app">
      <header class="header">
        <span class="mark">W</span>
        <span class="wordmark">WT Builder</span>
        <span class="head-spacer" />
        <button class="btn primary" onClick={() => setSheet(true)}>New issue</button>
      </header>

      <div class="index-body">
        <h1>Issues</h1>

        {error && <div class="error-bar" role="alert">{error}</div>}
        {(loading || opening) && <p class="quiet">Loading…</p>}
        {!loading && !issues.length && (
          <p class="quiet">Nothing here yet. Start WT{nextNumber} and sweep the week.</p>
        )}

        <div class="issue-rows">
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              live={issue.id === draft?.id}
              archiving={archiving === issue.id}
              onOpen={onOpen}
              onArchive={() => void sendArchive(issue.id)}
            />
          ))}
        </div>
      </div>

      {sheet && (
        <SetupSheet
          nextNumber={nextNumber}
          replacing={draft}
          onCancel={() => setSheet(false)}
          onCreate={async (body) => {
            try {
              const res = await api.createIssue(body);
              onOpen(res.issue.issue.id);
            } catch (err) {
              onError((err as Error).message);
              setSheet(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ── one row ───────────────────────────────────────────────────────────────

const LEGS: [string, string, string][] = [
  ['website', 'SITE', 'the website'],
  ['buttondown', 'MAIL', 'the Buttondown draft'],
  ['podcast', 'POD', 'the podcast'],
];

function IssueRow({
  issue, live, archiving, onOpen, onArchive,
}: {
  issue: IssueSummary;
  live: boolean;
  archiving: boolean;
  onOpen: (id: string) => void;
  onArchive: () => void;
}) {
  const isDraft = issue.status === 'draft';
  const when = wallClock(issue.publication_date);
  const clock = countdown(issue.publication_date);

  const counts = isDraft
    ? `${issue.counts.items} item${issue.counts.items === 1 ? '' : 's'}`
    : [
        `${issue.counts.links} link${issue.counts.links === 1 ? '' : 's'}`,
        `${issue.counts.journal} journal post${issue.counts.journal === 1 ? '' : 's'}`,
      ].join(' · ');

  return (
    <div class={`issue-row${isDraft ? ' draft' : ''}${live ? ' live' : ''}`}>
      <div class="ir-line">
        <span class="ir-num">WT{issue.number}</span>

        <span class="ir-main">
          <span class="ir-title">{issue.title}</span>
          <span class="ir-when">
            {when ? longDate(when) : issue.publication_date}
            {isDraft && clock.label && (
              <span class={`ir-clock ${clock.tone}`}>{clock.label}</span>
            )}
          </span>
          <span class="ir-counts">{counts}</span>
        </span>

        {/*
          Three chips, not one flag: an issue can be live on the website with no
          audio and a draft still sitting in Buttondown, and one status word
          cannot say that.
        */}
        <span class="ir-chips">
          {LEGS.map(([key, label, name]) => {
            const state = issue.sends?.[key]?.status ?? 'none';
            return (
              <span
                key={key}
                class={`ir-chip ${state}`}
                title={
                  state === 'sent' ? `Sent to ${name}`
                    : state === 'sending' ? `Sending to ${name}…`
                    : state === 'failed' ? `Did not send to ${name}`
                    : `Not sent to ${name}`
                }
              >
                {label}
              </span>
            );
          })}
        </span>

        <span class="ir-actions">
          <button class={`btn small${isDraft ? ' primary' : ''}`} onClick={() => onOpen(issue.id)}>
            Open
          </button>
          {!isDraft && (
            // "Website", never "Archive" — here the archive is the retrieval
            // feed, and the two must not share a word.
            <a
              class="btn small"
              href={`https://weekly.thingelstad.com/issues/${issue.number}/`}
              target="_blank"
              rel="noreferrer"
            >
              Website ↗
            </a>
          )}
        </span>

        <span class="ir-right">
          {!isDraft && <ArchiveCell issue={issue} busy={archiving} onSend={onArchive} />}
        </span>
      </div>

      {/*
        Full width, because a strip squeezed into the right cell reads as a
        fragment; across the row it reads as the issue's state.
      */}
      {isDraft && (
        <button class="ir-strip" onClick={() => onOpen(issue.id)} aria-label={`Open WT${issue.number}`}>
          <span class="ir-ticks">
            {issue.ticks.map((done, i) => (
              <span key={i} class={`ir-tick${done ? ' done' : ''}`} />
            ))}
          </span>
          <span class={`ir-left${issue.outstanding === 0 ? ' ready' : ''}`}>
            {issue.outstanding === 0 ? 'READY' : `${issue.outstanding} LEFT`}
          </span>
        </button>
      )}
    </div>
  );
}

/** The archive feed's own state. Not a channel, and not a gate. */
function ArchiveCell({
  issue, busy, onSend,
}: { issue: IssueSummary; busy: boolean; onSend: () => void }) {
  const state = busy ? 'sending' : (issue.sends?.archive?.status ?? 'none');

  if (state === 'sent') {
    return <span class="arch sent"><Check size={11} />IN ARCHIVE</span>;
  }
  if (state === 'sending') {
    return <span class="arch sending"><Spinner size={11} />SENDING</span>;
  }
  return (
    <>
      <span class="arch missing"><CircleAlert size={11} />NOT IN ARCHIVE</span>
      <button class="btn tiny" onClick={onSend}>
        <Archive size={11} />
        {state === 'failed' ? 'Retry' : 'Send to archive'}
      </button>
    </>
  );
}

// ── the setup sheet ───────────────────────────────────────────────────────

const SPANS = [7, 14, 21];

function SetupSheet({
  nextNumber, replacing, onCancel, onCreate,
}: {
  nextNumber: number;
  replacing?: IssueSummary;
  onCancel: () => void;
  onCreate: (body: { number: number; publication_date: string; window_days: number }) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(snapToSaturday(today));
  const [number, setNumber] = useState(nextNumber);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  const saturday = isSaturday(date);
  const w = issueWindow(date, days);

  return (
    <div class="scrim" onClick={onCancel}>
      <div class="sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-body">
          <h2>Start a new issue</h2>
          {replacing && (
            <p class="quiet">
              WT{replacing.number} is still a draft. Starting a new issue leaves it
              where it is — nothing is discarded.
            </p>
          )}

          <label class="field">
            <span class="mono-label">PUBLICATION DATE</span>
            <input type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
            {saturday
              ? <span class="ok-note">{kickerDate(date)} · 12:00 AM CT</span>
              : <span class="err-note">The Weekly Thing publishes Saturday. Pick a Saturday.</span>}
          </label>

          <label class="field">
            <span class="mono-label">ISSUE NUMBER</span>
            <input
              type="number" value={number}
              onInput={(e) => setNumber(Number((e.target as HTMLInputElement).value))}
            />
            <span class="quiet">Follows WT{nextNumber - 1}</span>
          </label>

          <div class="field">
            <span class="mono-label">SOURCE MATERIAL</span>
            <div class="chips">
              {SPANS.map((d) => (
                <button key={d} class={`chip${days === d ? ' on' : ''}`} onClick={() => setDays(d)}>{d}</button>
              ))}
              <input
                type="number" class="num small" value={days}
                aria-label="Days back from Friday"
                onInput={(e) => setDays(Number((e.target as HTMLInputElement).value) || 7)}
              />
            </div>
            <span class="window-line">{spanLabel(w)}</span>
          </div>
        </div>

        <div class="sheet-foot">
          <button class="btn" onClick={onCancel}>Cancel</button>
          <button
            class="btn primary"
            disabled={!saturday || busy}
            onClick={() => { setBusy(true); onCreate({ number, publication_date: date, window_days: days }); }}
          >
            {busy ? 'Creating…' : `Create WT${number}`}
          </button>
        </div>
      </div>
    </div>
  );
}
