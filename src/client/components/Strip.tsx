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

import type { Readiness } from '../api.ts';
import { CircleCheck } from '../icons.tsx';

interface Props {
  number: number;
  readiness: Readiness | null;
  onJump: (anchor: string) => void;
}

export function Strip({ number, readiness, onJump }: Props) {
  const units = readiness?.units ?? [];
  const done = readiness?.done ?? 0;
  const total = readiness?.total ?? 0;
  const complete = total > 0 && done === total;

  return (
    <div class={`strip${complete ? ' complete' : ''}`}>
      <span class="strip-label">{complete ? 'READY' : `WT${number}`}</span>

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

      <span class={`strip-readout${complete ? ' complete' : ''}`}>
        {complete ? 'Ready to send' : `${done} of ${total} done`}
      </span>
      {complete && <CircleCheck />}
    </div>
  );
}
