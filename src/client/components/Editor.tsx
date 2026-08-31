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
import { CollapseView } from './Collapse.tsx';
import { LeftPanel } from './LeftPanel.tsx';
import { Strip } from './Strip.tsx';
import { Inspector } from './Inspector.tsx';
import { ReviewPanel, type PanelNote } from './ReviewPanel.tsx';

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
  const [draft, setDraft] = useState<{ itemId: string; candidates: string[]; references?: { issue: number; url: string; note?: string }[] } | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [reading, setReading] = useState(false);
  const [readOpen, setReadOpen] = useState(false);
  const [cleared, setCleared] = useState<Map<string, 'done' | 'ignored'>>(new Map());
  const [showCleared, setShowCleared] = useState(false);
  // The staleness hint: how many edits this session since the read.
  const [editsSince, setEditsSince] = useState(0);
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

  /** Every mutation routes through here so the read's staleness hint is honest. */
  const runEdit = (fn: () => Promise<IssueResponse>) => {
    setEditsSince((e) => e + 1);
    return run(fn);
  };

  const act: PageActions = {
    updateItem: (itemId, patch) => void runEdit(() => api.updateItem(id, itemId, patch)),
    updateIssue: (patch) => void runEdit(() => api.settings(id, patch)),
    moveItem: (nodeId, itemId, delta) => void runEdit(() => api.moveItem(id, nodeId, itemId, delta)),
    removeItem: (nodeId, itemId) => void runEdit(() => api.removeItem(id, nodeId, itemId)),
    moveNode: (nodeId, delta) => void runEdit(() => api.moveNode(id, nodeId, delta)),
    removeNode: (nodeId) => void runEdit(() => api.removeNode(id, nodeId)),
    addNode: (spec) => void runEdit(() => api.addNode(id, spec)),
    addItem: (nodeId, type) => void runEdit(() => api.addItem(id, nodeId, type)),
    promote: (itemId) => void runEdit(() => api.promote(id, itemId)),
    demote: (nodeId) => void runEdit(() => api.demote(id, nodeId)),
    setChannel: (itemId, channel, on) => void runEdit(() => api.setChannel(id, itemId, channel, on)),
    uploadPhoto: (itemId, file) => {
      const p = api.uploadPhoto(id, itemId, file);
      void run(() => p);
      return p;
    },
    /**
     * The wand offers; it never writes. Candidates land in a picker beside the
     * block and nothing changes until Jamie chooses one — which is what keeps
     * every word in the issue his.
     */
    draft: (itemId) => {
      setDrafting(itemId);
      setDraft(null);
      api.draftItem(id, itemId)
        .then((r) => setDraft({ itemId, candidates: r.candidates, references: r.archive_references }))
        .catch((err) => onError((err as Error).message))
        .finally(() => setDrafting(null));
    },
  };

  const sweep = () => {
    setSweeping(true);
    void run(() => api.sweep(id)).finally(() => setSweeping(false));
  };

  // Opening a draft re-scans on its own: sources fill in all week, and the
  // page should show the week as it stands, not as it stood last session.
  // The doc renders immediately; the sweep lands when it lands.
  useEffect(() => {
    if (doc.issue.status !== 'draft') return;
    sweep();
  }, [id]); // once per issue open — not on every doc replacement

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

  /** A PROOF note whose substring is gone is fixed — it drops live, no re-read. */
  const stillAnchored = (n: Note) => {
    if (n.kind !== 'PROOF' || !n.was) return true;
    const item = n.item_id ? doc.items[n.item_id] : null;
    if (!item) return n.item_id === null;
    return [item.title, item.body, item.commentary, item.label]
      .filter(Boolean).join('\n').includes(n.was);
  };

  const allNotes: PanelNote[] = (review?.notes ?? [])
    .map((n, i) => ({ note: n, k: key(n, i), cleared: cleared.get(key(n, i)) }))
    .filter((pn) => stillAnchored(pn.note));
  const notes = allNotes.filter((pn) => !pn.cleared).map((pn) => pn.note);
  const noteKeys = allNotes.filter((pn) => !pn.cleared).map((pn) => pn.k);
  const proof = notes.filter((n) => n.kind === 'PROOF').length;

  const clear = (k: string, how: 'done' | 'ignored') =>
    setCleared(new Map([...cleared, [k, how]]));
  const reopen = (k: string) => {
    const next = new Map(cleared);
    next.delete(k);
    setCleared(next);
  };

  const anchorName = (itemId: string | null) => {
    if (!itemId) return 'the issue';
    const item = doc.items[itemId];
    if (!item) return itemId;
    const name = item.title || item.label || item.type.replace('_', ' ');
    return name.length > 26 ? `${name.slice(0, 25)}…` : name;
  };

  const read = () => {
    setReading(true);
    setReadOpen(true);
    setCleared(new Map());
    setEditsSince(0);
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
        <button class={`btn${collapsed ? ' primary' : ''}`} onClick={() => setCollapsed(!collapsed)}>
          Collapse
        </button>
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
                {collapsed
                  ? 'COLLAPSED — SECTIONS'
                  : doc.issue.status === 'published' && lens !== 'source'
                    ? kicker.replace('EDITABLE', 'PUBLISHED')
                    : kicker}
              </span>
              <span class="note">
                {collapsed
                  ? 'Drag to reorder. Click a section to open it. Nothing is editable here.'
                  : note}
              </span>
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

            {collapsed ? (
              <CollapseView
                doc={doc}
                selected={selected}
                onOpen={(nodeId) => { setCollapsed(false); jump(nodeId); }}
                onMove={(nodeId, delta) => void run(() => api.moveNode(id, nodeId, delta))}
                onRemove={(nodeId) => void run(() => api.removeNode(id, nodeId))}
                onReorder={(nodeId, before) => void run(() => api.addNode(id, { id: nodeId, before }))}
              />
            ) : (
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
                const refs = draft?.references;
                setDraft(null);
                // The head wand drafts the title theme and dek as two lines.
                if (itemId === 'issue') {
                  const [title, ...rest] = text.split('\n');
                  void run(() => api.settings(id, {
                    title: (title ?? '').trim(),
                    dek: rest.join(' ').trim(),
                  }));
                  return;
                }
                const item = doc.items[itemId];
                const field = item?.type === 'pinboard_link' ? 'commentary' : 'body';
                const patch: Record<string, unknown> = { [field]: text };
                // Echoes carries the citations it was drafted from, so the
                // inspector can show what the note stands on.
                if (item?.type === 'echoes' && refs?.length) patch.archive_references = refs;
                void run(() => api.updateItem(id, itemId, patch));
              }}
              onDismissDraft={() => setDraft(null)}
            >
              {readOpen && notes.length > 0 && (
                <Notes
                  notes={notes}
                  host={rowsRef}
                  selected={selected}
                  onShowMe={jump}
                  onDone={(i) => clear(noteKeys[i]!, 'done')}
                  onIgnore={(i) => clear(noteKeys[i]!, 'ignored')}
                />
              )}
            </Page>
            )}
          </div>
        </div>

        {inspecting ? (
          <Inspector
            doc={doc}
            itemId={inspecting}
            run={runEdit}
            onClose={() => setSelected(null)}
            onError={onError}
            onBackToReview={readOpen ? () => setSelected(null) : undefined}
          />
        ) : readOpen ? (
          <ReviewPanel
            reading={reading}
            summary={review?.summary}
            notes={allNotes}
            editsSince={editsSince}
            selected={selected}
            anchorName={anchorName}
            onShowMe={jump}
            onDone={(k) => clear(k, 'done')}
            onIgnore={(k) => clear(k, 'ignored')}
            onReopen={reopen}
            onReadAgain={read}
            onClose={() => setReadOpen(false)}
            showCleared={showCleared}
            onToggleCleared={() => setShowCleared(!showCleared)}
          />
        ) : null}
      </div>

      {busy && <div class="busy-hint">Saving…</div>}
    </div>
  );
}
