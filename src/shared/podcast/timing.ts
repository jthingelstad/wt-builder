/**
 * How long an episode took to make, read from its event log: the issue
 * timing's rule (only Jamie's acts count; acts closer than SESSION_GAP are
 * one sitting) with one difference. A take runs longer than the gap with
 * no act inside it, so a recording's finish never starts a new sitting:
 * from "Recording started" to "Recording finished" is one stretch of work,
 * however long it ran.
 *
 * Time between two acts in a sitting goes to the stage of the later one
 * (outline, record, publish), capped at ATTRIBUTE_CAP so a break inside a
 * sitting is not counted as work; a recording's finish is credited with
 * the take's own length instead. Active time is the sum of those stretches.
 */

import { SESSION_GAP_MS, type TimingEvent } from '../timing.ts';

export type EpisodeStageName = 'outline' | 'record' | 'publish';

export interface EpisodeTiming {
  activeMs: number;
  sittings: number;
  /** Jamie's acts before the episode was published. */
  actions: number;
  byStage: Record<EpisodeStageName, number>;
  /** Seconds at the card, summed over every finished recording. */
  recordedSeconds: number;
  takes: number;
  publishedAt?: string;
}

const ATTRIBUTE_CAP_MS = 10 * 60_000;

/** Anchors an episode's publish-stage edits carry (routes.ts). */
const PUBLISH_ANCHORS = new Set(['summary', 'show_notes', 'transcript', 'audio', 'send']);

export function stageOf(e: TimingEvent): EpisodeStageName {
  if (e.kind === 'recording') return 'record';
  if (e.kind === 'audio' || e.kind === 'send' || e.kind === 'verify') return 'publish';
  if (e.anchor && PUBLISH_ANCHORS.has(e.anchor)) return 'publish';
  return 'outline';
}

const isFinish = (e: TimingEvent) => e.kind === 'recording' && e.data?.action === 'finished';

export function episodeTiming(events: TimingEvent[]): EpisodeTiming {
  const published = events.find((e) => e.kind === 'episode' && e.data?.action === 'published');
  const until = published ? Date.parse(published.at) : Infinity;
  const acts = events.filter((e) => e.actor === 'jamie' && Date.parse(e.at) <= until);

  const byStage: Record<EpisodeStageName, number> = { outline: 0, record: 0, publish: 0 };
  let activeMs = 0;
  let sittings = 0;
  let prev: TimingEvent | undefined;
  for (const e of acts) {
    const gap = prev ? Date.parse(e.at) - Date.parse(prev.at) : Infinity;
    if (!prev || (gap > SESSION_GAP_MS && !isFinish(e))) {
      sittings++;
    } else {
      const take = isFinish(e) ? Number(e.data?.seconds ?? 0) * 1000 : 0;
      const ms = take ? Math.min(gap, take + 60_000) : Math.min(gap, ATTRIBUTE_CAP_MS);
      activeMs += ms;
      byStage[stageOf(e)] += ms;
    }
    prev = e;
  }

  const finishes = events.filter(isFinish);
  return {
    activeMs,
    sittings,
    actions: acts.length,
    byStage,
    recordedSeconds: finishes.reduce((sum, e) => sum + Number(e.data?.seconds ?? 0), 0),
    takes: finishes.length,
    ...(published ? { publishedAt: published.at } : {}),
  };
}
