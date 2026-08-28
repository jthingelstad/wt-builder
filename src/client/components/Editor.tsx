/**
 * The editor: a 52px header over a progress strip, then three columns —
 * optional left panel, the canvas, optional right rail.
 *
 * The header is a single non-wrapping flex row in which everything is
 * `flex: none` except the identity line, so at narrow widths the window meta
 * truncates first and no control is ever clipped or unreachable. The row is
 * budgeted to fit at 924px with the Review badge present; anything added here
 * has to buy its width from something else.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import type { Channel, IssueDoc } from '../../shared/types.ts';
import { shortKicker, sourcesLabel } from '../../shared/dates.ts';
import { windowOf } from '../../shared/render/plan.ts';
import { api, type IssueResponse, type Readiness } from '../api.ts';
import { ArrowLeft } from '../icons.tsx';
import { Page, type Lens, type PageActions } from './Page.tsx';
import { Notes, type Note } from './Notes.tsx';
import { LeftPanel } from './LeftPanel.tsx';
import { Strip } from './Strip.tsx';
import { Inspector } from './Inspector.tsx';

interface Props {
  doc: IssueDoc;
  readiness: Readiness | null;
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<IssueResponse>) => Promise<void>;
  onIndex: () => void;
  onSend: () => void;
  onError: (m: string | null) => void;
}

const KICKER: Record<Lens, [string, string]> = {
  source: [
    'SOURCE — CANONICAL ITEMS',
    'Every item as stored, nothing filtered or transformed. The three channels are renderings of this.',
  ],
  website: [
    'WEBSITE — EDITABLE',
    'Click any text to edit it in place. The page is the editor.',
  ],
  email: [
    'EMAIL — BUTTONDOWN',
    'The same issue, minus anything held out of email, plus the subscriber block.',
  ],
  audio: [
    'AUDIO — SPOKEN SCRIPT',
    'A numbered script, not a page. Photos are omitted rather than narrated.',
  ],
};

const CHANNEL_LENSES: Channel[] = ['website', 'email', 'audio'];

export function Editor({ doc, readiness, busy, error, run, onIndex, onSend, onError }: Props) {
  const [lens, setLens] = useState<Lens>('website');
  const [panel, setPanel] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ itemId: string; candidates: string[] } | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [reading, setReading] = useState(false);
  const [readOpen, setReadOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const canvasRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const id = doc.issue.id;
  const w = windowOf(doc);
  const [kicker, note] = KICKER[lens];

  /** Jump the canvas to an anchor and select it — used by the progress strip. */
  const jump = useCallback((anchor: string) => {
    setSelected(anchor);
    const el = canvasRef.current?.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const act: PageActions = {
    updateItem: (itemId, patch) => void run(() => api.updateItem(id, itemId, patch)),
    updateIssue: (patch) => void run(() => api.settings(id, patch)),
    moveItem: (nodeId, itemId, delta) => void run(() => api.moveItem(id, nodeId, itemId, delta)),
    moveNode: (nodeId, delta) => void run(() => api.moveNode(id, nodeId, delta)),
    removeNode: (nodeId) => void run(() => api.removeNode(id, nodeId)),
    addNode: (spec) => void run(() => api.addNode(id, spec)),
    promote: (itemId) => void run(() => api.promote(id, itemId)),
    demote: (nodeId) => void run(() => api.demote(id, nodeId)),
    setChannel: (itemId, channel, on) => void run(() => api.setChannel(id, itemId, channel, on)),
    /**
     * The wand offers; it never writes. Candidates land in a picker beside the
     * block and nothing changes until Jamie chooses one — which is what keeps
     * every word in the issue his.
     */
    draft: (itemId) => {
      setDrafting(itemId);
      setDraft(null);
      api.draftItem(id, itemId)
        .then((r) => setDraft({ itemId, candidates: r.candidates }))
        .catch((err) => onError((err as Error).message))
        .finally(() => setDrafting(null));
    },
  };

  const sweep = () => {
    setSweeping(true);
    void run(() => api.sweep(id)).finally(() => setSweeping(false));
  };

  // Escape closes the right rail before it does anything else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected && !(e.target as HTMLElement).isContentEditable) {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const inspecting = selected && doc.items[selected] ? selected : null;

  const review = doc.review as { summary?: string; notes?: Note[] } | undefined;
  const key = (n: Note, i: number) => `${n.item_id ?? 'issue'}:${i}:${n.text.slice(0, 32)}`;
  const notes = (review?.notes ?? []).filter((n, i) => !dismissed.has(key(n, i)));
  const proof = notes.filter((n) => n.kind === 'PROOF').length;

  const read = () => {
    setReading(true);
    setReadOpen(true);
    setDismissed(new Set());
    void run(() => api.review(id)).finally(() => setReading(false));
  };

  return (
    <div class="app">
      <header class="header">
        <button class="btn ghost-btn" onClick={onIndex}><ArrowLeft /> Issues</button>
        <span class="mark">W</span>
        <span class="head-divider" />
        <span class="identity">
          <span class="wt">WT{doc.issue.number}</span>
          <span class="win">{shortKicker(doc.issue.publication_date)} · {sourcesLabel(w)}</span>
        </span>

        <span class="head-spacer" />

        {/*
          Source sits outside the segmented group on purpose: the three channels
          are permutations of it, not peers of it.
        */}
        <button
          class={`btn${lens === 'source' ? ' primary' : ''}`}
          onClick={() => setLens('source')}
        >
          Source
        </button>
        <div class="segment">
          {CHANNEL_LENSES.map((c) => (
            <button
              key={c}
              class={`seg${lens === c ? ' on' : ''}`}
              onClick={() => setLens(c)}
            >
              {c[0]!.toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>

        {/*
          Opens the read that exists; re-running is what "Read again" is for.
          Re-reading on every open would spend a model call to tell Jamie
          something he has already seen.
        */}
        <button
          class={`btn${readOpen ? ' reading' : ''}`}
          onClick={() => {
            if (readOpen) setReadOpen(false);
            else if (review) setReadOpen(true);
            else read();
          }}
        >
          {reading ? 'Reading…' : 'Review'}
          {!reading && notes.length > 0 && <span class="count-badge">{notes.length}</span>}
        </button>
        <button class={`btn${panel ? ' primary' : ''}`} onClick={() => setPanel(!panel)}>
          Issue
        </button>
        <button class="btn primary" onClick={onSend}>Publish</button>
      </header>

      <Strip number={doc.issue.number} readiness={readiness} onJump={jump} />

      {error && (
        <div class="error-bar" role="alert">
          {error}
          <button class="btn tiny" onClick={() => onError(null)}>Dismiss</button>
        </div>
      )}

      <div class="columns">
        {panel && (
          <LeftPanel
            doc={doc}
            selected={selected}
            onSelect={jump}
            onSettings={(patch) => void run(() => api.settings(id, patch))}
            onMove={(nodeId, delta) => void run(() => api.moveNode(id, nodeId, delta))}
            onRemove={(nodeId) => void run(() => api.removeNode(id, nodeId))}
            onAdd={(spec) => void run(() => api.addNode(id, spec))}
            onReorder={(nodeId, before) => void run(() => api.addNode(id, { id: nodeId, before: before ?? undefined }))}
            onSweep={sweep}
            sweeping={sweeping}
          />
        )}

        <div class="canvas" ref={canvasRef}>
          <div class="canvas-inner">
            <div class="lens-kicker">
              <span class="kicker">
                {doc.issue.status === 'published' && lens !== 'source'
                  ? kicker.replace('EDITABLE', 'PUBLISHED')
                  : kicker}
              </span>
              <span class="note">{note}</span>
            </div>

            {readOpen && (
              <div class="read-bar">
                <div class="kicker">EDITORIAL<br />READ</div>
                <div class="read-card">
                  {reading ? (
                    <>
                      <p class="working">Reading the issue…</p>
                      <div class="read-checks">
                        {['Balance and rhythm', 'Against the archive', 'Length', 'Proofing'].map((c) => (
                          <span class="read-check on" key={c}><span class="dot" />{c}</span>
                        ))}
                      </div>
                    </>
                  ) : notes.length === 0 ? (
                    <>
                      <p class="working">
                        {review ? 'That is everything cleared.' : 'Nothing worth raising.'}
                      </p>
                      <p class="counts">Read it again after you change something.</p>
                      <div class="acts">
                        <button class="btn small" onClick={read}>Read again</button>
                        <button class="btn small" onClick={() => setReadOpen(false)}>Done</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p class="working">{review?.summary}</p>
                      <p class="counts">
                        {notes.length} note{notes.length === 1 ? '' : 's'} in the margin
                        {proof > 0 && ` · ${proof} proof`} · read from this draft
                      </p>
                      <div class="acts">
                        <button class="btn small" onClick={read}>Read again</button>
                        <button class="btn small" onClick={() => setReadOpen(false)}>Done</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <Page
              doc={doc}
              lens={lens}
              hostRef={rowsRef}
              withNotes={readOpen && notes.length > 0}
              selected={selected}
              onSelect={setSelected}
              act={act}
              drafting={drafting}
              draft={draft}
              onPickDraft={(itemId, text) => {
                const item = doc.items[itemId];
                const field = !item ? 'body'
                  : item.type === 'pinboard_link' ? 'commentary'
                  : 'body';
                setDraft(null);
                void run(() => api.updateItem(id, itemId, { [field]: text }));
              }}
              onDismissDraft={() => setDraft(null)}
            >
              {readOpen && notes.length > 0 && (
                <Notes
                  notes={notes}
                  host={rowsRef}
                  selected={selected}
                  onShowMe={jump}
                  onDone={(i) => setDismissed(new Set([...dismissed, key(notes[i]!, i)]))}
                  onIgnore={(i) => setDismissed(new Set([...dismissed, key(notes[i]!, i)]))}
                />
              )}
            </Page>
          </div>
        </div>

        {inspecting && (
          <Inspector
            doc={doc}
            itemId={inspecting}
            run={run}
            onClose={() => setSelected(null)}
            onError={onError}
          />
        )}
      </div>

      {busy && <div class="busy-hint">Saving…</div>}
    </div>
  );
}
