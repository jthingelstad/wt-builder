/**
 * The editorial review panel — the read as a working list, in the right rail.
 *
 * Shares the rail with the inspector, never both at once: opening an item
 * from a note swaps to the inspector, which carries a ← Review button back
 * (docs/interface-spec.md § Editorial review panel). The margin notes and the
 * summary bar stay on the canvas; this is the same read, grouped and
 * clearable, beside the page instead of on it.
 */

import { Check } from '../icons.tsx';
import type { Note } from './Notes.tsx';

/** A note with its stable key and cleared state, prepared by the editor. */
export interface PanelNote {
  note: Note;
  k: string;
  cleared?: 'done' | 'ignored';
}

interface Props {
  reading: boolean;
  summary?: string;
  notes: PanelNote[];
  /** Session edits since the read — the staleness hint. */
  editsSince: number;
  selected: string | null;
  anchorName: (itemId: string | null) => string;
  onShowMe: (itemId: string) => void;
  onDone: (k: string) => void;
  onIgnore: (k: string) => void;
  onReopen: (k: string) => void;
  onReadAgain: () => void;
  onClose: () => void;
  showCleared: boolean;
  onToggleCleared: () => void;
}

/** Spec badge names for the model's note kinds. */
const BADGE: Record<string, { label: string; cls: string }> = {
  PROOF: { label: 'PROOF', cls: 'proof' },
  REPETITION: { label: 'ARCHIVE', cls: 'archive' },
  BALANCE: { label: 'RHYTHM', cls: 'quiet' },
  LENGTH: { label: 'LENGTH', cls: 'quiet' },
};

export function ReviewPanel({
  reading, summary, notes, editsSince, selected, anchorName,
  onShowMe, onDone, onIgnore, onReopen, onReadAgain, onClose,
  showCleared, onToggleCleared,
}: Props) {
  const open = notes.filter((n) => !n.cleared);
  const cleared = notes.filter((n) => n.cleared);

  const proof = open.filter((n) => n.note.kind === 'PROOF');
  const judgement = open.filter((n) => n.note.kind !== 'PROOF');
  // The read's two best observations get the label; the rest are noticed.
  const worth = judgement.slice(0, 2);
  const also = judgement.slice(2);

  return (
    <aside class="panel review-panel" aria-label="editorial review">
      <div class="rp-head">
        <span class="mono-label">EDITORIAL REVIEW</span>
        <button class="rp-x" onClick={onClose} aria-label="Close review">✕</button>
      </div>

      {reading ? (
        <div class="rp-running">
          <p class="working">Reading the issue…</p>
          {['Balance and rhythm', 'Against the archive', 'Length', 'Proofing'].map((c) => (
            <span class="read-check on" key={c}><span class="dot" />{c}</span>
          ))}
        </div>
      ) : (
        <>
          <div class="rp-stale">
            <span>
              {editsSince === 0
                ? 'Read from this draft.'
                : `You have edited ${editsSince} thing${editsSince === 1 ? '' : 's'} since this read.`}
            </span>
            <button class="btn tiny" onClick={onReadAgain}>Read again</button>
          </div>

          {summary && (
            <div class="rp-working">
              <span class="mono-label good">WHAT'S WORKING</span>
              <p>{summary}</p>
            </div>
          )}

          {open.length === 0 && (
            <div class="rp-empty">
              <p class="good">
                {cleared.length ? 'That is everything cleared.' : 'Nothing worth raising.'}
              </p>
              <p class="quiet">Read it again after you change something.</p>
            </div>
          )}

          <NoteGroup label="PROOF" notes={proof} {...{ selected, anchorName, onShowMe, onDone, onIgnore }} />
          <NoteGroup label="WORTH YOUR TIME" notes={worth} {...{ selected, anchorName, onShowMe, onDone, onIgnore }} />
          <NoteGroup label="ALSO NOTICED" notes={also} {...{ selected, anchorName, onShowMe, onDone, onIgnore }} />

          {cleared.length > 0 && (
            <div class="rp-cleared">
              <button class="btn tiny" onClick={onToggleCleared}>
                {showCleared ? 'Hide cleared' : 'Show cleared'}
                {' '}· {cleared.filter((n) => n.cleared === 'done').length} done
                · {cleared.filter((n) => n.cleared === 'ignored').length} ignored
              </button>
              {showCleared && cleared.map((pn) => (
                <div key={pn.k} class={`rp-note cleared ${pn.cleared}`}>
                  <div class="rp-note-head">
                    <span class={`rp-badge ${BADGE[pn.note.kind]?.cls ?? 'quiet'}`}>
                      {pn.cleared === 'done' ? 'DONE' : 'IGNORED'}
                    </span>
                    <span class="rp-anchor">{anchorName(pn.note.item_id)}</span>
                    <button class="rp-act" title="Reopen" onClick={() => onReopen(pn.k)}>↩</button>
                  </div>
                  <p class="rp-body">{pn.note.text}</p>
                </div>
              ))}
            </div>
          )}

          <p class="rp-foot">
            The review reads the website edition and writes no prose. Notes are
            advisory — they never gate publishing, and every word in the issue
            stays yours.
          </p>
        </>
      )}
    </aside>
  );
}

function NoteGroup({
  label, notes, selected, anchorName, onShowMe, onDone, onIgnore,
}: {
  label: string;
  notes: PanelNote[];
  selected: string | null;
  anchorName: (itemId: string | null) => string;
  onShowMe: (itemId: string) => void;
  onDone: (k: string) => void;
  onIgnore: (k: string) => void;
}) {
  if (!notes.length) return null;
  return (
    <div class="rp-group">
      <div class="rp-group-head">
        <span class="mono-label">{label}</span>
        <span class="rp-count">{notes.length}</span>
      </div>
      {notes.map((pn) => {
        const n = pn.note;
        const badge = BADGE[n.kind] ?? { label: n.kind, cls: 'quiet' };
        const isSelected = Boolean(n.item_id) && n.item_id === selected;
        return (
          <div key={pn.k} class={`rp-note${isSelected ? ' selected' : ''}`}>
            <div class="rp-note-head">
              <span class={`rp-badge ${badge.cls}`}>{badge.label}</span>
              <span class="rp-anchor">{anchorName(n.item_id)}</span>
              <button class="rp-act" title="Done" onClick={() => onDone(pn.k)}><Check size={12} /></button>
              <button class="rp-act" title="Ignore" onClick={() => onIgnore(pn.k)}>⃠</button>
            </div>
            <p class="rp-body">{n.text}</p>
            {n.kind === 'PROOF' && n.was && (
              <p class="rp-fix">
                <s>{n.was}</s> <span class="arrow">→</span> <em>{n.now}</em>
              </p>
            )}
            <div class="rp-note-foot">
              {n.item_id && (
                <button class="btn tiny" onClick={() => onShowMe(n.item_id!)}>Show me</button>
              )}
              {n.archive_ref && (
                <a
                  class="btn tiny"
                  href={`https://weekly.thingelstad.com/archive/${n.archive_ref}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WT{n.archive_ref} ↗
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
