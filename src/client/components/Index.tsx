/**
 * The issue index — the landing view.
 *
 * A working dashboard rather than an archive: the live draft is the thing you
 * came here for, and everything else is a record of what shipped.
 */

import { useEffect, useState } from 'preact/hooks';

import { api, type IssueSummary } from '../api.ts';
import { isSaturday, kickerDate, issueWindow, snapToSaturday, spanLabel } from '../../shared/dates.ts';

interface Props {
  error: string | null;
  onError: (message: string | null) => void;
  onOpen: (id: string) => void;
}

export function IssueIndex({ error, onError, onOpen }: Props) {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [nextNumber, setNextNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(false);

  const load = async () => {
    setLoading(true);
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

  return (
    <div class="app">
      <header class="header">
        <span class="mark">W</span>
        <span class="wordmark">WT Builder</span>
        <span class="head-spacer" />
        <button class="btn primary" onClick={() => setSheet(true)}>New issue</button>
      </header>

      <div class="index-body">
        <div class="mono-label">THE WEEKLY THING</div>
        <h1>Issues</h1>
        <p class="lede">
          One issue a week, published Saturday. Everything bookmarked or posted
          between Friday and Friday is already on the page — the work is deciding
          what stays.
        </p>

        {error && <div class="error-bar">{error}</div>}
        {loading && <p class="quiet">Loading…</p>}

        {!loading && !issues.length && (
          <p class="quiet">Nothing here yet. Start WT{nextNumber} and sweep the week.</p>
        )}

        <div class="issue-rows">
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} onOpen={onOpen} />
          ))}
        </div>

        <p class="index-foot">
          Issues before WT{issues.length ? Math.min(...issues.map((i) => i.number)) : nextNumber}{' '}
          were built by hand and live on the website. They open as a read-only record of
          the send.
        </p>
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
            }
          }}
        />
      )}
    </div>
  );
}

const STATUS: Record<string, string> = { draft: 'DRAFT', published: 'PUBLISHED' };

function IssueRow({ issue, onOpen }: { issue: IssueSummary; onOpen: (id: string) => void }) {
  const sends = Object.values(issue.sends ?? {});
  const sent = sends.filter((s) => s.status === 'sent').length;
  const failed = sends.some((s) => s.status === 'failed');

  const meta = issue.status === 'draft'
    ? `${issue.readiness}% ready · publishes ${issue.publication_date}`
    : `${sent} of 3 sent${failed ? ' · one failed' : ''} · ${issue.publication_date}`;

  return (
    <div class="issue-row">
      <span class="ir-num">WT{issue.number}</span>
      <span class="ir-main">
        <span class="ir-title">{issue.title}</span>
        <span class="ir-meta">{meta}</span>
      </span>
      <span class={`ir-pill ${issue.status}${failed ? ' failed' : ''}`}>
        {STATUS[issue.status] ?? issue.status.toUpperCase()}
      </span>
      <button
        class={`btn small${issue.status === 'draft' ? ' primary' : ''}`}
        onClick={() => onOpen(issue.id)}
      >
        Open
      </button>
    </div>
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
            onClick={() => {
              setBusy(true);
              onCreate({ number, publication_date: date, window_days: days });
            }}
          >
            {busy ? 'Creating…' : `Create WT${number}`}
          </button>
        </div>
      </div>
    </div>
  );
}
