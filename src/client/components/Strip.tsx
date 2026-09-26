/**
 * The progress strip — 36px under the header.
 *
 * One tick per readiness unit. Clicking a tick scrolls the canvas to that
 * unit's anchor — scroll only, nothing is selected and no panel opens — so the
 * strip is navigation and not just a readout.
 *
 * The strip is a `div`, not a button, because the ticks have to be real buttons
 * — a button inside a button is invalid and the inner one stops being
 * focusable.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { Readiness } from '../api.ts';
import type { IssueDoc, Item } from '../../shared/types.ts';
import { audioScript } from '../../shared/render/audio.ts';
import { bodyLines } from '../../shared/render/plan.ts';
import { burstAt, celebrateStrip } from '../celebrate.ts';
import { CircleCheck } from '../icons.tsx';

interface Props {
  number: number;
  readiness: Readiness | null;
  onJump: (anchor: string) => void;
  /** The issue itself — for what each tick is, and what it says. */
  doc?: IssueDoc;
}

/**
 * What a tick is, so a finished strip reads as a map of the issue: links
 * green, Journal blue, Thingy terracotta, the photo amber, and Jamie's own
 * framing words (title, intro, Currently, outro, haiku) ink.
 */
type Hue = 'link' | 'journal' | 'thingy' | 'photo' | 'words';
function hueOf(doc: IssueDoc | undefined, anchor: string, kind: string): Hue {
  if (kind === 'thingy') return 'thingy';
  const item = doc?.items[anchor] as Item | undefined;
  const type = item?.type ?? doc?.nodes.find((n) => n.id === anchor)?.type;
  if (item?.authorship === 'Thingy' || type === 'echo' || type === 'echoes' || type === 'membership') return 'thingy';
  if (type === 'pinboard_link') return 'link';
  if (type === 'journal_post' || type === 'journal') return 'journal';
  if (type === 'photo') return 'photo';
  return 'words';
}

/** The first words of what a tick holds, for its tooltip once it is done. */
function glimpse(doc: IssueDoc | undefined, anchor: string): string {
  if (!doc) return '';
  if (anchor === 'issue') return doc.issue.dek ?? '';
  const item = doc.items[anchor] as Item | undefined;
  const text = item ? bodyLines(item.commentary || item.body || item.media?.caption || '').join(' ') : '';
  const plain = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[*_`>#]/g, '').trim();
  return plain.length > 96 ? `${plain.slice(0, 95).trimEnd()}…` : plain;
}

/** Back-to-back ticks: each within this long of the one before keeps the streak. */
const STREAK_MS = 4 * 60_000;

export function Strip({ number, readiness, onJump, doc }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Click-away and Escape, so the popover never traps the page.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const units = readiness?.units ?? [];
  const done = readiness?.done ?? 0;
  const partial = readiness?.partial ?? 0;
  const total = readiness?.total ?? 0;
  const complete = total > 0 && done === total;
  const STATE = { done: 'done', partial: 'in progress', todo: 'not yet' } as const;

  // A tick that just turned green bursts; the last one takes the strip with
  // it. Keyed by anchor+title so a reorder does not read as progress, and the
  // first render seeds silently — opening a half-done issue is not a win.
  const ticks = useRef<HTMLDivElement>(null);
  const seen = useRef<Map<string, boolean> | null>(null);
  const streak = useRef<{ n: number; at: number }>({ n: 0, at: 0 });
  const [flash, setFlash] = useState<string | null>(null);
  const [wave, setWave] = useState(false);
  useEffect(() => {
    const now = new Map(units.map((u) => [`${u.anchor}|${u.title}`, u.done]));
    const prev = seen.current;
    seen.current = now;
    if (!prev || !ticks.current) return;
    const buttons = ticks.current.querySelectorAll<HTMLElement>('.tick');
    const newlyDone = units
      .map((u, i) => ({ u, i }))
      .filter(({ u }) => u.done && prev.get(`${u.anchor}|${u.title}`) === false);
    if (!newlyDone.length) return;
    if (complete) {
      void celebrateStrip(ticks.current.getBoundingClientRect());
      return;
    }
    // Momentum: finishing things back to back builds a streak.
    const t = Date.now();
    streak.current = { n: t - streak.current.at < STREAK_MS ? streak.current.n + newlyDone.length : newlyDone.length, at: t };
    const run = streak.current.n;
    for (const { i } of newlyDone) {
      const r = buttons[i]?.getBoundingClientRect();
      if (r) void burstAt(r.left + r.width / 2, r.top + r.height / 2, run);
    }
    // Crossing the halfway line sends a shimmer down the finished ticks.
    const wasDone = [...prev.values()].filter(Boolean).length;
    const half = Math.ceil(total / 2);
    if (wasDone < half && done >= half) {
      setWave(true);
      setFlash('Halfway');
      setTimeout(() => setWave(false), 1600);
    } else if (run >= 3) {
      setFlash(`${run} in a row`);
    }
    const clear = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(clear);
  }, [units, complete]);

  // How long the issue runs aloud as it stands — it grows as the words do.
  const aloud = useMemo(() => {
    if (!doc) return '';
    const chars = audioScript(doc).reduce((n, b) => n + b.text.length, 0);
    const min = Math.round(chars / 15 / 60);
    return min >= 1 ? `~${min} min aloud` : '';
  }, [doc]);

  const outstanding = units.filter((u) => !u.done);

  return (
    <div class={`strip${complete ? ' complete' : ''}`} ref={box}>
      <button
        class="strip-label"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {complete ? 'READY' : `WT${number}`}
      </button>

      <div class="ticks" ref={ticks}>
        {units.map((unit, i) => {
          const hue = hueOf(doc, unit.anchor, unit.kind);
          const said = unit.done ? glimpse(doc, unit.anchor) : '';
          return (
            <span class="tick-wrap" key={`${unit.anchor}-${i}`} style={wave ? { '--wave-delay': `${i * 28}ms` } : undefined}>
              <button
                class={`tick ${unit.state} hue-${hue}${wave && unit.done ? ' wave' : ''}`}
                aria-label={`${unit.title} — ${STATE[unit.state]}`}
                onClick={() => onJump(unit.anchor)}
              />
              {/*
                Edge-aware: a centred tooltip on the leftmost tick renders off
                screen, so the first four anchor left and the last four right.
              */}
              <span class={`tip ${i < 4 ? 'left' : i >= units.length - 4 ? 'right' : 'mid'}`}>
                <span class={`tip-dot ${unit.state} hue-${hue}`} />
                <span class="tip-text">
                  {unit.title}
                  {said && <span class="tip-said">{said}</span>}
                </span>
                <span class={`tip-state ${unit.state}`}>{STATE[unit.state]}</span>
              </span>
            </span>
          );
        })}
      </div>

      <button
        class={`strip-readout${complete ? ' complete' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {flash
          ? <span class="strip-flash">{flash}</span>
          : complete ? 'Ready to send' : `${done} of ${total} done${partial ? ` · ${partial} in progress` : ''}`}
        {aloud && !flash && <span class="strip-aloud"> · {aloud}</span>}
      </button>
      {complete && <CircleCheck />}

      {open && (
        <div class="checklist" role="dialog" aria-label="Before this issue is ready to send">
          <div class="cl-head">BEFORE WT{number} IS READY TO SEND</div>
          {outstanding.length === 0 ? (
            <p class="cl-clear">Everything on this list is done.</p>
          ) : (
            outstanding.map((unit, i) => (
              <button
                class="cl-row"
                key={`${unit.anchor}-${i}`}
                onClick={() => { onJump(unit.anchor); setOpen(false); }}
              >
                <span class={`cl-dot ${unit.kind}${unit.state === 'partial' ? ' partial' : ''}`} />
                <span class="cl-main">
                  <span class="cl-title">
                    {unit.title}
                    {unit.state === 'partial' && <span class="cl-state">IN PROGRESS</span>}
                  </span>
                  {unit.context && <span class="cl-context">{unit.context}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
