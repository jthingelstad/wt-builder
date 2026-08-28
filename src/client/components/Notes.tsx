/**
 * Editorial notes in the right margin.
 *
 * These are a **measured absolute overlay**, not grid cells, and the design
 * records why both alternatives fail: in flow a tall note grows its row and —
 * since the card is painted per row — tears the card into horizontal bands;
 * out of flow with `height: 0` they collide with the next rows' controls.
 *
 * So each note is positioned against its anchor row after render, and notes
 * that would overlap slide down instead. `left` is measured from the tracks
 * (76 + 680 = 756px) rather than `right: 0`, which resolves against the host
 * box and lands notes on top of the structural controls.
 */

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

import { Ban, Check } from '../icons.tsx';

export type NoteKind = 'PROOF' | 'BALANCE' | 'REPETITION' | 'LENGTH';

export interface Note {
  kind: NoteKind;
  item_id: string | null;
  text: string;
  was?: string;
  now?: string;
  archive_ref?: number;
}

/** The gap held between a note's bottom and the next note's top. */
const STACK_GAP = 10;

interface Props {
  notes: Note[];
  /** The `position: relative` host wrapping the rows. */
  host: RefObject<HTMLDivElement>;
  onDone: (index: number) => void;
  onIgnore: (index: number) => void;
  onShowMe: (anchor: string) => void;
  selected: string | null;
}

/** PROOF is its own colour; an archive citation is blue; the rest are quiet. */
function badgeOf(note: Note): { label: string; cls: string } {
  if (note.kind === 'PROOF') return { label: 'PROOF', cls: 'proof' };
  if (note.archive_ref) return { label: 'ARCHIVE', cls: 'archive' };
  if (note.kind === 'LENGTH') return { label: 'LENGTH', cls: 'quiet' };
  return { label: 'RHYTHM', cls: 'quiet' };
}

export function Notes({ notes, host, onDone, onIgnore, onShowMe, selected }: Props) {
  const [tops, setTops] = useState<number[]>([]);
  const els = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    const hostEl = host.current;
    if (!hostEl) return;

    const hostTop = hostEl.getBoundingClientRect().top;
    const next: number[] = [];

    /*
     * Measure every anchor first, then walk in *document* order — the order the
     * anchors appear on the page, not the order the notes came back in.
     *
     * The model returns notes grouped by kind, so a note about the head can
     * follow a note about the last link. Stacking in array order then reads
     * that head note as "below the previous one" and pushes it past the bottom
     * of the page, thousands of pixels from what it is about.
     */
    const placed = notes
      .map((note, i) => {
        const anchorId = note.item_id ?? 'issue';
        const anchor = hostEl.querySelector(`[data-anchor="${CSS.escape(anchorId)}"]`);
        return {
          i,
          anchorTop: anchor ? anchor.getBoundingClientRect().top - hostTop : null,
          height: els.current[i]?.offsetHeight ?? 0,
        };
      })
      .filter((p) => p.anchorTop !== null)
      .sort((a, b) => a.anchorTop! - b.anchorTop! || a.i - b.i);

    let previousBottom = -Infinity;
    for (const { i, anchorTop, height } of placed) {
      // A note starts at its anchor, or below the one before it, whichever is
      // lower — so notes slide down rather than overlapping.
      const top = Math.max(anchorTop!, previousBottom + STACK_GAP);
      next[i] = top;
      previousBottom = top + height;
    }

    // An unresolvable anchor keeps whatever it had rather than snapping to 0,
    // which would pile orphaned notes on top of the first one.
    notes.forEach((_, i) => { if (next[i] === undefined) next[i] = tops[i] ?? 0; });

    // Write state only when a position actually changed. Without this the
    // layout effect re-runs on its own output and never settles; with it the
    // pass converges in two frames.
    const changed = next.length !== tops.length || next.some((t, i) => t !== tops[i]);
    if (changed) setTops(next);
  });

  return (
    <>
      {notes.map((note, i) => {
        const badge = badgeOf(note);
        const anchorId = note.item_id ?? 'issue';
        return (
          <div
            key={`${anchorId}-${i}-${note.text.slice(0, 24)}`}
            ref={(el) => { els.current[i] = el as HTMLDivElement | null; }}
            class={`note note-${badge.cls}${selected === anchorId ? ' selected' : ''}`}
            style={{ top: `${tops[i] ?? 0}px` }}
          >
            <span class="note-dot" />
            <span class="note-leader" />
            <div class="note-inner">
              <div class="note-head">
                <span class={`note-badge ${badge.cls}`}>{badge.label}</span>
                <span class="note-spacer" />
                <button class="note-act done" title="Done" aria-label="Mark this note done"
                  onClick={() => onDone(i)}>
                  <Check size={11} />
                </button>
                <button class="note-act ignore" title="Ignore" aria-label="Ignore this note"
                  onClick={() => onIgnore(i)}>
                  <Ban size={11} />
                </button>
              </div>

              <p class="note-body">{note.text}</p>

              {note.was && (
                <div class="note-fix">
                  <s>{note.was}</s>
                  <span class="arrow"> → </span>
                  <ins>{note.now}</ins>
                </div>
              )}

              <div class="note-foot">
                <button class="note-link" onClick={() => onShowMe(anchorId)}>Show me</button>
                {note.archive_ref && (
                  <a
                    class="note-link"
                    href={`https://weekly.thingelstad.com/issues/${note.archive_ref}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WT{note.archive_ref} ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
