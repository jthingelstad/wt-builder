/**
 * Where an episode stands: one unit per thing the episode needs, in the
 * order it is made (outline, record, publish). Derived from the document on
 * every read and never stored, like an issue's readiness. Advisory: nothing
 * here gates anything; the send refuses only what `validate` blocks.
 */

import { segmentHasContent } from './cards.ts';
import { lastSent } from '../sends.ts';
import { plannedTotal } from './pace.ts';
import type { EpisodeDoc } from './types.ts';

export type EpisodeStage = 'outline' | 'record' | 'publish';

export interface EpisodeUnit {
  key: string;
  title: string;
  stage: EpisodeStage;
  done: boolean;
  /** One line on what finishing it means, when it is not done. */
  hint?: string;
}

export interface EpisodeReadiness {
  units: EpisodeUnit[];
  done: number;
  total: number;
  pct: number;
}

export function episodeReadiness(doc: EpisodeDoc): EpisodeReadiness {
  const e = doc.episode;
  const filled = doc.segments.filter(segmentHasContent);
  const units: EpisodeUnit[] = [
    { key: 'title', stage: 'outline', title: 'Title', done: Boolean(e.title.trim()), hint: 'Name the episode.' },
    {
      key: 'outline', stage: 'outline', title: 'Outline', done: filled.length > 0,
      hint: 'Add a segment and write its cards.',
    },
    {
      key: 'budget', stage: 'outline', title: 'Timing', done: doc.segments.length > 0 && plannedTotal(doc.segments) !== null,
      hint: 'Give every segment its minutes, so the card can keep pace.',
    },
    {
      key: 'recorded', stage: 'record', title: 'Recorded', done: Boolean(doc.session?.ended !== undefined || doc.audio),
      hint: 'Record from the card, or drop the recording.',
    },
    { key: 'audio', stage: 'publish', title: 'Audio', done: Boolean(doc.audio), hint: 'Drop the edited recording to master it.' },
    { key: 'transcript', stage: 'publish', title: 'Transcript', done: Boolean(doc.transcript?.trim()) && !doc.transcript_stale, hint: doc.transcript_stale ? 'Written before the new master: transcribe again or read it through.' : 'Transcribe the mastered audio, then read it through.' },
    { key: 'summary', stage: 'publish', title: 'Summary', done: Boolean(e.summary.trim()), hint: 'One line for the feed.' },
    { key: 'notes', stage: 'publish', title: 'Show notes', done: Boolean(doc.show_notes?.trim()), hint: 'What a listener reads on the episode page.' },
    { key: 'sent', stage: 'publish', title: 'Sent', done: Boolean(lastSent(doc.sends?.another)), hint: 'Send it to another.thingelstad.com.' },
  ];
  const done = units.filter((u) => u.done).length;
  return { units, done, total: units.length, pct: Math.round((done / units.length) * 100) };
}
