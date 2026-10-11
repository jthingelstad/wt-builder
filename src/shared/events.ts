/**
 * The event log: one record of everything that happens to an issue, or to an
 * Another Thing episode (its events carry the episode's `at<N>` where an
 * issue's carry `wt<N>`),
 * read by the Log sheet, the issue timing, the MCP's `changes` and
 * `list_events`, an item's history, and `npm run watch` (docs/event-log.md).
 *
 * Each event says what happened (`kind`), who made it happen (`actor`), the
 * item or section it touched (`anchor`), one sentence for a person
 * (`summary`), and the facts behind the sentence for a program (`data`).
 * Code reads `kind`, `actor`, `anchor` and `data`, never the sentence.
 */

export type EventKind =
  /** Started, published, put to bed, woken. */
  | 'issue'
  /** A re-scan that changed something: the counts. Its entries follow it. */
  | 'sweep'
  | 'swept-in'
  | 'refreshed'
  | 'conflict'
  | 'gone'
  | 'dropped'
  | 'kept'
  | 'held-out'
  | 'put-back'
  | 'moved'
  /** Jamie's words: an edit, a proof fix, a pick from a wand. */
  | 'edit'
  /** The outline: sections, items, order, promotion. */
  | 'structure'
  | 'channels'
  /** The issue's own fields: title, dek, window, date. */
  | 'settings'
  /** A decision about an item's source: fork, rejoin, keep mine, take theirs, move the bookmark. */
  | 'source'
  /** A write-back to Pinboard or Micro.blog, and how it came out. */
  | 'write'
  /** The link check, the blocklist check, and Jamie's answers to them. */
  | 'links'
  /** The editorial review and the audio script read. */
  | 'review'
  /** A wand's draft: offered, or failed. A pick from it is an `edit` with `via: 'wand'`. */
  | 'wand'
  | 'send'
  /** A leg's verification, when its status moves. */
  | 'verify'
  /** Draft share, LinkedIn, the blog post. */
  | 'share'
  /** An Another Thing episode's own life: started, published, deleted. */
  | 'episode'
  /** A recording session at the card: started, finished, a take note. */
  | 'recording'
  /** An episode's audio: a recording dropped, mastered, transcribed. */
  | 'audio';

/**
 * Who made it happen. `jamie` is an act in the editor, and only those count
 * as his time. `wt-builder` is the service on its own (a write-back's
 * outcome, a verification, a scan's bookkeeping). `source` is a change made
 * at Pinboard or Micro.blog that a scan brought in.
 */
export type EventActor = 'jamie' | 'wt-builder' | 'source';

/** What a route hands the store; `at` and `id` are the store's. */
export interface EventInput {
  kind: EventKind;
  summary: string;
  /** The item (or section, for a section-wide act) the event touched. */
  anchor?: string;
  /** Defaults to the kind's usual actor (ACTOR_OF). */
  actor?: EventActor;
  data?: Record<string, unknown>;
}

export interface IssueEvent {
  id: number;
  at: string;
  kind: EventKind;
  actor: EventActor;
  summary: string;
  anchor?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Who usually makes each kind happen. Every kind is listed, so a new kind
 * cannot land without deciding whose it is; a call site passes `actor` when
 * this one is wrong for it (a send that finished is the service's, a drop
 * because the bookmark was deleted is the source's).
 */
export const ACTOR_OF: Record<EventKind, EventActor> = {
  issue: 'jamie',
  sweep: 'wt-builder',
  'swept-in': 'source',
  refreshed: 'source',
  conflict: 'source',
  gone: 'source',
  dropped: 'wt-builder',
  kept: 'wt-builder',
  'held-out': 'source',
  'put-back': 'source',
  moved: 'source',
  edit: 'jamie',
  structure: 'jamie',
  channels: 'jamie',
  settings: 'jamie',
  source: 'jamie',
  write: 'wt-builder',
  links: 'jamie',
  review: 'jamie',
  wand: 'jamie',
  send: 'jamie',
  verify: 'wt-builder',
  share: 'jamie',
  episode: 'jamie',
  recording: 'jamie',
  audio: 'jamie',
};

export const EVENT_KINDS = Object.keys(ACTOR_OF) as EventKind[];

/** The actor an event will be stored with. */
export const actorOf = (e: Pick<EventInput, 'kind' | 'actor'>): EventActor => e.actor ?? ACTOR_OF[e.kind];

/** "4.2 s", "850 ms", "2 m 10 s": a duration in a summary. */
export function took(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  const whole = Math.round(s);
  if (whole < 60) return `${whole} s`;
  return `${Math.floor(whole / 60)} m ${String(whole % 60).padStart(2, '0')} s`;
}
