/**
 * The episode document: Another Thing, the podcast, as WT Builder holds it.
 *
 * A second product beside the newsletter, not a kind of issue
 * (docs/decisions.md, *Another Thing is a second product, not an item
 * type*). It shares the service's machinery (the event log, revisions, the
 * send guards, the commit client, the deploy) and none of the issue's
 * model: no items, no sections, no sweep, no editions. Nothing under
 * src/shared/podcast/ imports the issue's types, and nothing in the issue's
 * code reads an episode.
 *
 * One JSON document per episode, like an issue. It carries two texts on
 * purpose: the OUTLINE (segments of cards, what Jamie records from) and the
 * SHOW NOTES (what a listener reads). Conflating them is how an outline ends
 * up published or show notes end up read on air.
 *
 * Ported from AT Builder (retired 2026-10-11), which never sent an episode:
 * the card contract, the pace model and the Another contract carry over;
 * its wands, prospecting and hooks do not.
 */

import type { SendState, Verification } from '../types.ts';

export const EPISODE_SCHEMA_VERSION = 1;

/**
 * A block: one thing on the card, typed by what Jamie does with it while
 * recording. Glance versus say is the whole idea: he does not need a
 * script, he needs to know which three words to look at and which one
 * sentence to nail exactly.
 *
 *   line      a talking point, read at a glance, said in his own words
 *   trigger   a word or two, glance only (gold)
 *   verbatim  say this close to word-for-word (orange italic)
 *   bridge    the transition that keeps three points from being three
 *             rants; load-bearing in a solo read (teal dashed)
 *   cuttable  an optional riff, droppable when behind pace (grey pill)
 */
export type BlockType = 'line' | 'trigger' | 'verbatim' | 'bridge' | 'cuttable';

export const BLOCK_TYPES: readonly BlockType[] = ['line', 'trigger', 'verbatim', 'bridge', 'cuttable'];

export interface Block {
  t: BlockType;
  text: string;
}

/** A card: one beat, one screen. Never scroll mid-thought. */
export interface Card {
  id: string;
  /** Small label above the claim: "POINT 2", "STORY", "LANDING". */
  kicker?: string;
  /** The one thing this beat says, in a sentence. The heading on screen. */
  claim?: string;
  blocks: Block[];
  /** Planned seconds for this beat. Absent: an even share of the segment. */
  seconds?: number;
}

/** What a segment is for in the arc. Advisory: the editor never enforces a shape. */
export type SegmentRole = 'intro' | 'point' | 'bridge' | 'outro';

export const SEGMENT_ROLES: readonly SegmentRole[] = ['intro', 'point', 'bridge', 'outro'];

/** A segment: the outline's editorial unit. */
export interface Segment {
  id: string;
  title: string;
  role?: SegmentRole;
  /** The beats Jamie records from, in order. Never a script. */
  cards: Card[];
  /** Planned minutes, the timing help's whole input. Optional per segment. */
  minutes?: number;
  /** Links to reference on air; they also make "Mentioned in this episode". */
  links: { text: string; url: string }[];
}

/** A mark made while recording, pinned to the moment and the segment on screen. */
export interface TakeNote {
  at: string;
  /** Seconds into the recording session when the note was taken. */
  elapsed?: number;
  segmentId?: string;
  text: string;
}

/** A split: the moment a segment was entered, seconds into the session. */
export interface Split {
  segmentId: string;
  entered: number;
}

export interface RecordingSession {
  started_at: string;
  splits: Split[];
  /** Seconds into the session when the clock stopped, once it has. */
  ended?: number;
}

export type EpisodeStatus = 'draft' | 'published';

export interface EpisodeMeta {
  /** `at<N>` for life, like an issue's `wt<N>`. */
  id: string;
  number: number;
  title: string;
  /** Permalink slug, no number prefix: subscriber-facing, frozen once sent. */
  slug: string;
  summary: string;
  /**
   * ISO 8601 with an offset, stamped when the recording is mastered. Another
   * computes the permalink and GUID from this date's UTC calendar day: a
   * 7 PM Central date rolls to the next UTC day (contract.ts).
   */
  date?: string;
  /** Derived, never clicked: published once the send has ever succeeded. */
  status: EpisodeStatus;
  explicit?: boolean;
  /** Target length for the whole episode, minutes. Advisory. */
  target_minutes?: number;
}

/** The mastered mp3, as it stands on disk until the send commits it. */
export interface AudioState {
  /** What Jamie dropped: the edited recording out of his audio tools. */
  source_filename: string;
  duration_seconds: number;
  bytes: number;
  mastered_at: string;
}

export interface EpisodeDoc {
  schema_version: number;
  episode: EpisodeMeta;
  /** The outline, ordered. */
  segments: Segment[];
  /** Recording-session marks. Working material; never published. */
  notes: TakeNote[];
  /**
   * The most recent recording session, for "where the time went". A new
   * session replaces it, and nothing here publishes.
   */
  session?: RecordingSession;
  /** Reader-facing episode notes, Markdown: the published body. */
  show_notes?: string;
  /** Plain text, blank-line paragraphs: Another's transcript contract. */
  transcript?: string;
  /**
   * The recording was mastered again after the transcript was written: it
   * may describe the old take. Cleared by a new draft or an edit to it.
   */
  transcript_stale?: boolean;
  audio?: AudioState;
  /** One leg: the commit to another.thingelstad.com. */
  sends?: { another?: SendState };
  /** Whether the feed carries the episode and its enclosure resolves. */
  verify?: { another?: Verification };
}
