import { useEffect, useState } from 'preact/hooks';

import { api, type IssueSummary } from '../api.ts';
import { snapToSaturday } from '../../shared/dates.ts';

interface Props {
  error: string | null;
  onError: (message: string | null) => void;
  onOpen: (id: string) => void;
}

/** The working dashboard: the current draft first, then what has shipped. */
export function IssueIndex({ error, onError, onOpen }: Props) {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [nextNumber, setNextNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

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

  const create = async () => {
    setCreating(true);
    try {
      // Publication is a Saturday; the sheet defaults to the next one.
      const saturday = snapToSaturday(new Date().toISOString().slice(0, 10));
      const res = await api.createIssue({ number: nextNumber, publication_date: saturday });
      onOpen(res.issue.issue.id);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <header class="header">
        <span class="num">WT BUILDER</span>
        <span class="spacer" />
        <button class="btn primary" onClick={create} disabled={creating}>
          {creating ? 'Opening…' : `New issue — WT${nextNumber}`}
        </button>
      </header>

      <div class="index">
        <h1>Issues</h1>
        {error && <div class="banner error">{error}</div>}

        {loading && <div class="empty">Loading…</div>}

        {!loading && !issues.length && (
          <div class="empty">
            No issues yet. Start WT{nextNumber} and sweep the week.
          </div>
        )}

        {issues.map((issue) => (
          <button key={issue.id} class="issue-row" onClick={() => onOpen(issue.id)}>
            <span class="n">WT{issue.number}</span>
            <span class="t">{issue.title}</span>
            <SendChips sends={issue.sends} />
            {issue.status === 'draft' && (
              <span class="pill draft">{issue.readiness}%</span>
            )}
            <span class="d">{issue.publication_date}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Per-destination chips: an issue is not published, it is sent, one leg at a time. */
function SendChips({ sends }: { sends: IssueSummary['sends'] }) {
  const legs: [string, string][] = [
    ['website', 'SITE'],
    ['buttondown', 'MAIL'],
    ['podcast', 'POD'],
  ];
  return (
    <span class="chips">
      {legs.map(([key, label]) => {
        const state = sends?.[key]?.status;
        const cls = state === 'sent' ? 'pill sent' : state === 'failed' ? 'pill failed' : 'pill';
        return <span key={key} class={cls} title={sends?.[key]?.error ?? state ?? 'not sent'}>{label}</span>;
      })}
    </span>
  );
}
