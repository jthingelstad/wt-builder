/**
 * Pace for a solo recorder: the card's clock and "where the time went".
 *
 * The outline carries the plan: each segment may budget minutes, each card
 * may take its own seconds. While recording, the card shows how the beat on
 * screen is running against its planned window, and "sync to here"
 * re-anchors the plan when card and speech have drifted apart. Afterwards,
 * the session's splits sit beside the budgets, which is how the next
 * outline's budgets get honest.
 *
 * Everything degrades quietly: no budgets, no signals. The card never
 * scolds a plan that was never made.
 */

import { cardSeconds } from './cards.ts';
import type { Card, Segment, Split } from './types.ts';

/** "4:05". */
export function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Planned seconds for the whole outline, when every segment is budgeted. */
export function plannedTotal(segments: Segment[]): number | null {
  let total = 0;
  for (const seg of segments) {
    if (seg.minutes === undefined || seg.minutes === null) return null;
    total += seg.minutes * 60;
  }
  return total;
}

/**
 * Where the time actually went: each segment's duration from the session's
 * splits, beside its budget. The last segment entered runs to the session's
 * end when it has one.
 */
export function splitReport(
  segments: Segment[],
  splits: Split[],
  endedAt?: number,
): { segment: Segment; actual: number | null; budget: number | null }[] {
  return segments.map((segment) => {
    const at = splits.findIndex((s) => s.segmentId === segment.id);
    let actual: number | null = null;
    if (at >= 0) {
      const next = splits[at + 1];
      const end = next ? next.entered : endedAt;
      if (end !== undefined) actual = end - splits[at]!.entered;
    }
    return {
      segment,
      actual,
      budget: segment.minutes !== undefined && segment.minutes !== null ? segment.minutes * 60 : null,
    };
  });
}

// ── beats: the card's unit ────────────────────────────────────────────────

export interface Beat {
  seg: Segment;
  segIndex: number;
  /** Null for a segment with no cards: the title alone is the beat. */
  card: Card | null;
  cardIndex: number;
  /**
   * Planned seconds into the episode when this beat should begin and end.
   * Null once any earlier beat is unbudgeted: a partial plan would lie.
   */
  start: number | null;
  end: number | null;
}

/** Segments flattened into beats, one per card, with the cumulative plan. */
export function beats(segments: Segment[]): Beat[] {
  const out: Beat[] = [];
  let cursor: number | null = 0;
  segments.forEach((seg, segIndex) => {
    const cards = seg.cards.length ? seg.cards : [null];
    cards.forEach((card, cardIndex) => {
      const secs = card
        ? cardSeconds(seg, card)
        : seg.minutes !== undefined && seg.minutes !== null ? seg.minutes * 60 : null;
      const start = cursor;
      const end = cursor !== null && secs !== null ? cursor + secs : null;
      out.push({ seg, segIndex, card, cardIndex, start, end });
      cursor = end;
    });
  });
  return out;
}

export interface BeatPace {
  /** Seconds behind (positive) or ahead (negative) of the beat's window. */
  delta: number;
  label: string;
  tone: 'ok' | 'ahead' | 'behind';
}

/** Grace at each seam of a beat's window, so a beat entered on time is not "behind" for a breath. */
const SEAM_GRACE = 5;

/**
 * Live pace against the beat on screen: inside its planned window is ON
 * PACE, past the window's end is BEHIND by that much, before its start is
 * AHEAD. `shift` is "sync to here": the plan re-anchored so the current beat
 * began when Jamie pressed it. It follows the beat he is on, not the clock
 * alone: a slow card shows as behind only once it has used its time.
 */
export function beatPace(beat: Beat, elapsed: number, shift = 0): BeatPace | null {
  if (beat.start === null || beat.end === null) return null;
  const start = beat.start + shift;
  const end = beat.end + shift;
  if (elapsed < start - SEAM_GRACE) {
    const d = start - elapsed;
    return { delta: -d, label: `${fmt(d)} AHEAD`, tone: 'ahead' };
  }
  if (elapsed > end + SEAM_GRACE) {
    const d = elapsed - end;
    return { delta: d, label: `+${fmt(d)} BEHIND`, tone: 'behind' };
  }
  return { delta: 0, label: 'ON PACE', tone: 'ok' };
}
