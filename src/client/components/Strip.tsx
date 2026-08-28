/**
 * The progress strip — 36px under the header.
 *
 * One tick per readiness unit. Clicking a tick jumps the canvas to that unit's
 * anchor and selects it, so the strip is navigation and not just a readout.
 *
 * The strip is a `div`, not a button, because the ticks have to be real buttons
 * — a button inside a button is invalid and the inner one stops being
 * focusable.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import type { Readiness } from '../api.ts';
import { CircleCheck } from '../icons.tsx';

interface Props {
  number: number;
  readiness: Readiness | null;
  onJump: (anchor: string) => void;
}

export function Strip({ number, readiness, onJump }: Props) {
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
  const total = readiness?.total ?? 0;
  const complete = total > 0 && done === total;

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

      <div class="ticks">
        {units.map((unit, i) => (
          <span class="tick-wrap" key={`${unit.anchor}-${i}`}>
            <button
              class={`tick${unit.done ? ' done' : ''}`}
              aria-label={`${unit.title} — ${unit.done ? 'done' : 'not yet'}`}
              onClick={() => onJump(unit.anchor)}
            />
            {/*
              Edge-aware: a centred tooltip on the leftmost tick renders off
              screen, so the first four anchor left and the last four right.
            */}
            <span class={`tip ${i < 4 ? 'left' : i >= units.length - 4 ? 'right' : 'mid'}`}>
              <span class={`tip-dot${unit.done ? ' done' : ''}`} />
              <span class="tip-text">{unit.title}</span>
              <span class={`tip-state${unit.done ? ' done' : ''}`}>
                {unit.done ? 'done' : 'not yet'}
              </span>
            </span>
          </span>
        ))}
      </div>

      <button
        class={`strip-readout${complete ? ' complete' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {complete ? 'Ready to send' : `${done} of ${total} done`}
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
                <span class={`cl-dot ${unit.kind}`} />
                <span class="cl-main">
                  <span class="cl-title">{unit.title}</span>
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
