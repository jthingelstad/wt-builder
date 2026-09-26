/**
 * The issue index — a working dashboard, not a landing page.
 *
 * No kicker, no explanatory paragraph, no footnote: the heading and the rows.
 * Anything else here is furniture in front of the one thing Jamie came for,
 * which is the live issue.
 */

import { useEffect, useState } from 'preact/hooks';

import { api, type IssueSummary } from '../api.ts';
import { countdown, isSaturday, issueSaturday, issueWindow, kickerDate, longDate, snapToSaturday, spanLabel, todayCentral, wallClock } from '../../shared/dates.ts';
import { Archive, Check, CircleAlert, Spinner, Moon } from '../icons.tsx';
import { omnifocusUrl, taskpaper } from '../../shared/taskpaper.ts';

/** AT Builder: the same host, served one port up (tailnet :10002, dev :5318). */
function siblingUrl(): string {
  const { protocol, hostname, port } = window.location;
  const sibling = port === '10001' ? '10002' : port === '5317' ? '5318' : port === '4317' ? '4318' : '10002';
  return `${protocol}//${hostname}:${sibling}/`;
}

/**
 * The issue's OmniFocus project, from the dashboard: the week starts here,
 * before the issue is opened (Jamie, 2026-09-20). The row only has the
 * summary, so the document is fetched on click. ⌥-click copies the TaskPaper.
 */
async function openInOmniFocus(id: string, alt: boolean, onError: (m: string) => void) {
  try {
    const { issue } = await api.getIssue(id);
    const text = taskpaper(issue, window.location.origin);
    if (alt) { await navigator.clipboard.writeText(text); return; }
    window.location.href = omnifocusUrl(text);
  } catch (err) {
    onError((err as Error).message);
  }
}

interface Props {
  error: string | null;
  /** True while a URL-named issue is being fetched. */
  loading?: boolean;
  onError: (message: string | null) => void;
  onOpen: (id: string) => void;
}

interface Filters {
  q: string;
  year: string;
  hideAsleep: boolean;
}
const FILTERS_KEY = 'wt-builder:index-filters';
const DEFAULT_FILTERS: Filters = { q: '', year: '', hideAsleep: true };

function loadFilters(): Filters {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') as Partial<Filters>;
    return { q: saved.q ?? '', year: saved.year ?? '', hideAsleep: saved.hideAsleep ?? true };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** A draft always shows: it is the work in hand, whatever the filters say. */
function matches(i: IssueSummary, f: Filters): boolean {
  if (i.status === 'draft') return true;
  if (f.hideAsleep && i.put_to_bed_at) return false;
  if (f.year && !i.publication_date.startsWith(f.year)) return false;
  const q = f.q.trim().toLowerCase().replace(/^wt\s*/, '');
  // "351" or "WT35" finds by number; words find by title.
  if (q && !(/^\d+$/.test(q) ? String(i.number).startsWith(q) : i.title.toLowerCase().includes(q))) return false;
  return true;
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

  // Filters, remembered per browser (a convenience, not state anyone else
  // needs). Put-to-bed issues are hidden by default: finished is finished.
  const [filters, setFilters] = useState<Filters>(() => loadFilters());
  const setFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(next)); } catch { /* private window */ }
  };
  const years = [...new Set(issues.map((i) => i.publication_date.slice(0, 4)))].sort().reverse();
  const shown = issues.filter((i) => matches(i, filters));
  const asleepHidden = filters.hideAsleep ? issues.filter((i) => i.put_to_bed_at && matches(i, { ...filters, hideAsleep: false })).length : 0;

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
        {/* The sibling, one hop away: same host, the next port on the tailnet
            (:10001 → :10002; :5317 → :5318 in dev). Jamie, 2026-09-20. */}
        <a class="sibling-link" href={siblingUrl()}>AT Builder →</a>
        <span class="head-spacer" />
        <button class="btn primary" onClick={() => setSheet(true)}>New issue</button>
      </header>

      <div class="index-body">
        <h1>Issues</h1>

        {issues.length > 0 && (
          <div class="index-filters" role="search">
            <input
              class="if-search" type="search" placeholder="Search titles or numbers"
              value={filters.q} onInput={(e) => setFilter({ q: (e.currentTarget as HTMLInputElement).value })}
            />
            <select class="if-year" value={filters.year} aria-label="Year" onChange={(e) => setFilter({ year: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <label class="if-toggle">
              <input type="checkbox" checked={filters.hideAsleep} onChange={(e) => setFilter({ hideAsleep: (e.currentTarget as HTMLInputElement).checked })} />
              <Moon size={11} /> Hide put to bed
            </label>
          </div>
        )}
        {issues.length > 0 && (
          <div class="if-count">
            {shown.length === issues.length ? `${issues.length} issues` : `${shown.length} of ${issues.length}`}
            {asleepHidden > 0 && ` · ${asleepHidden} asleep hidden`}
          </div>
        )}

        {error && <div class="error-bar" role="alert">{error}</div>}
        {(loading || opening) && <p class="quiet">Loading…</p>}
        {!loading && !issues.length && (
          <p class="quiet">Nothing here yet. Start WT{nextNumber} and sweep the week.</p>
        )}

        <div class="issue-rows">
          {shown.length === 0 && issues.length > 0 && (
            <p class="quiet">Nothing matches. <button class="btn small" onClick={() => setFilter(DEFAULT_FILTERS)}>Clear filters</button></p>
          )}
          {shown.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              live={issue.id === draft?.id}
              archiving={archiving === issue.id}
              onOpen={onOpen}
              onArchive={() => void sendArchive(issue.id)}
              onBed={(asleep) => {
                if (!asleep && !confirm(`Wake WT${issue.number}? It becomes editable and re-sendable again.`)) return;
                api.bed(issue.id, asleep).then(() => load()).catch((e: Error) => onError(e.message));
              }}
              onError={onError}
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
  issue, live, archiving, onOpen, onArchive, onBed, onError,
}: {
  issue: IssueSummary;
  live: boolean;
  archiving: boolean;
  onOpen: (id: string) => void;
  onArchive: () => void;
  /** Put to bed (true) or wake (false) — also offered on the Send view. */
  onBed: (asleep: boolean) => void;
  onError: (m: string) => void;
}) {
  const isDraft = issue.status === 'draft';
  const when = wallClock(issue.publication_date);
  const clock = countdown(issue.publication_date);

  const counts = issue.imported
    // A record, not a reconstruction: the text is one block, so item counts
    // would only mislead.
    ? 'published with the Shortcuts workflow'
    : isDraft
      ? `${issue.counts.items} item${issue.counts.items === 1 ? '' : 's'}`
      : [
          `${issue.counts.links} link${issue.counts.links === 1 ? '' : 's'}`,
          `${issue.counts.journal} journal post${issue.counts.journal === 1 ? '' : 's'}`,
        ].join(' · ');

  return (
    <div class={`issue-row${isDraft ? ' draft' : ''}${live ? ' live' : ''}${issue.put_to_bed_at ? ' asleep' : ''}`}>
      <div class="ir-line">
        <span class="ir-num">WT{issue.number}</span>

        <span class="ir-main">
          <span class={`ir-title${issue.title ? '' : ' untitled'}`}>{issue.title || 'No title yet'}</span>
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
          {issue.put_to_bed_at && (
            <span class="ir-chip asleep" title={`Put to bed ${new Date(issue.put_to_bed_at).toLocaleString()} — open it and wake it to change anything`}>
              <Moon size={11} /> PUT TO BED
            </span>
          )}
          {issue.imported && <span class="ir-chip imported">PRE-BUILDER</span>}
          {!issue.imported && LEGS.map(([key, label, name]) => {
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
          {isDraft && !issue.imported && (
            <button
              class="btn small"
              title="Create this issue's project in OmniFocus (⌥-click to copy the TaskPaper)"
              onClick={(e) => void openInOmniFocus(issue.id, e.altKey, onError)}
            >
              OmniFocus
            </button>
          )}
          {!isDraft && (
            // "Website", never "Archive" — here the archive is the retrieval
            // feed, and the two must not share a word.
            <a
              class="btn small"
              href={`https://weekly.thingelstad.com/archive/${issue.number}/`}
              target="_blank"
              rel="noreferrer"
            >
              Website ↗
            </a>
          )}
          {/* A published issue can be put to bed right here (Jamie, WT351). */}
          {!isDraft && (
            issue.put_to_bed_at
              ? <button class="btn small" title="Make it editable and re-sendable again" onClick={() => onBed(false)}>Wake</button>
              : <button class="btn small" title="Finished: refuse every change until woken" onClick={() => onBed(true)}><Moon size={11} /> Put to bed</button>
          )}
        </span>

        <span class="ir-right">
          {issue.imported
            // The corpus was built FROM these issues — they are the archive.
            ? <span class="arch sent"><Check size={11} />IN ARCHIVE</span>
            : !isDraft && <ArchiveCell issue={issue} busy={archiving} onSend={onArchive} />}
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
  const today = todayCentral();
  const [date, setDate] = useState(snapToSaturday(today));
  const [number, setNumber] = useState(nextNumber);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  const saturday = isSaturday(date);
  const dated = issueSaturday(date);
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
              : <span class="ok-note">
                  Will be dated {kickerDate(dated)} — the issue is dated its
                  Saturday no matter when it sends.
                </span>}
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
