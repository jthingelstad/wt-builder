/**
 * How long an issue took to make, read from its event log (Jamie, WT351:
 * "did it save me time!"). Pure: the server hands it the events and the
 * document; the Send view and the index show what it returns.
 *
 * Only Jamie's own acts count as work — edits, write-backs, moves, settings,
 * reviews, sends. Automatic events (re-scans, sweeps, verification) happen
 * without him and are not his time. Acts closer together than SESSION_GAP
 * are one sitting; the time between them is the work. Time before an act is
 * given to the part of the issue the act touched, capped at ATTRIBUTE_CAP so
 * a coffee break inside a session does not land on one link.
 */

import type { IssueDoc, Item } from './types.ts';

export interface TimingEvent {
  at: string;
  kind: string;
  summary: string;
  anchor?: string | null;
}

export interface TimingSession {
  start: string;
  end: string;
  ms: number;
  actions: number;
}

export interface IssueTiming {
  /** Sittings before the issue went out. */
  sessions: TimingSession[];
  /** Sum of those sittings. */
  activeMs: number;
  /** Jamie's acts before publishing, and how many were edits of words. */
  actions: number;
  edits: number;
  /** When it went out ("Published"), if it has. */
  publishedAt?: string;
  /** First send started → published. */
  sendMs?: number;
  /** Fixing after it went out: acts, re-sends, and the sittings' time. */
  after: { actions: number; sends: number; ms: number };
  /** Active time by part of the issue, largest first. */
  bySection: { label: string; ms: number }[];
}

export const SESSION_GAP_MS = 30 * 60_000;
const ATTRIBUTE_CAP_MS = 10 * 60_000;
/** Sittings earlier than this before publishing are development, not this issue. */
const BUILD_WINDOW_MS = 8 * 24 * 3_600_000;

// "moved" and "kept" are the re-scan re-filing links by their bookmark tags,
// not Jamie; they were a third of WT350's unattributed time.
const WORK = new Set(['edit', 'structure', 'settings', 'sync', 'held-out', 'review', 'send', 'channels']);
/** Fixing after publishing is the same day's; later sends are other work (WT350's audio rebuild). */
const AFTER_WINDOW_MS = 12 * 3_600_000;

/** Which part of the issue an event belongs to: its item's section, or a named part. */
function sectionOf(e: TimingEvent, doc: IssueDoc, byName: Map<string, string>): string {
  if (e.kind === 'settings') return 'Title & dek';
  if (e.kind === 'send' || e.kind === 'review') return 'Review & send';
  const reordered = /^Reordered (.+?)(?: — |$)/.exec(e.summary);
  if (reordered) return reordered[1]!;
  if (e.summary.startsWith('Photo uploaded')) return 'Photo';
  const id = e.anchor ?? byName.get(e.summary.split(' — ').pop()?.trim() ?? '');
  const node = id ? doc.nodes.find((n) => n.items.includes(id)) : undefined;
  if (node) return node.kind === 'promoted_item' ? 'Journal' : node.label;
  if (/Echo/i.test(e.summary)) return 'Echoes';
  return 'Other';
}

function itemName(item: Item): string {
  const text = (item.title ?? item.label ?? String(item.commentary ?? item.body ?? '')).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 60 ? `${text.slice(0, 59)}…` : text) : '(untitled)';
}

function sittings(acts: TimingEvent[]): TimingSession[] {
  const out: TimingSession[] = [];
  let cur: TimingEvent[] = [];
  const close = () => {
    if (!cur.length) return;
    const ms = Date.parse(cur[cur.length - 1]!.at) - Date.parse(cur[0]!.at);
    out.push({ start: cur[0]!.at, end: cur[cur.length - 1]!.at, ms, actions: cur.length });
    cur = [];
  };
  for (const e of acts) {
    if (cur.length && Date.parse(e.at) - Date.parse(cur[cur.length - 1]!.at) > SESSION_GAP_MS) close();
    cur.push(e);
  }
  close();
  return out;
}

export function issueTiming(events: TimingEvent[], doc: IssueDoc): IssueTiming {
  // The last "Published" is the real one: early development runs published
  // WT350 once on Aug 30, three weeks before it was built.
  const published = [...events].reverse().find((e) => e.kind === 'issue' && e.summary.startsWith('Published'));
  const pubMs = published ? Date.parse(published.at) : Infinity;
  const floor = Number.isFinite(pubMs) ? pubMs - BUILD_WINDOW_MS : -Infinity;

  const work = events.filter((e) => WORK.has(e.kind));
  const before = work.filter((e) => Date.parse(e.at) <= pubMs && Date.parse(e.at) >= floor);
  const after = work.filter((e) => Date.parse(e.at) > pubMs && Date.parse(e.at) <= pubMs + AFTER_WINDOW_MS);

  const sessions = sittings(before);
  const afterSessions = sittings(after);

  const byName = new Map(Object.entries(doc.items).map(([id, item]) => [itemName(item as Item), id]));
  const bySection = new Map<string, number>();
  for (let i = 1; i < before.length; i++) {
    const gap = Date.parse(before[i]!.at) - Date.parse(before[i - 1]!.at);
    if (gap > SESSION_GAP_MS) continue;
    const label = sectionOf(before[i]!, doc, byName);
    bySection.set(label, (bySection.get(label) ?? 0) + Math.min(gap, ATTRIBUTE_CAP_MS));
  }

  const firstSend = before.find((e) => e.kind === 'send' && e.summary.startsWith('Send started'));
  return {
    sessions,
    activeMs: sessions.reduce((n, s) => n + s.ms, 0),
    actions: before.length,
    edits: before.filter((e) => e.kind === 'edit').length,
    publishedAt: published?.at,
    sendMs: firstSend && published ? pubMs - Date.parse(firstSend.at) : undefined,
    after: {
      actions: after.length,
      sends: after.filter((e) => e.kind === 'send' && e.summary.startsWith('Send started')).length,
      ms: afterSessions.reduce((n, s) => n + s.ms, 0),
    },
    bySection: [...bySection].map(([label, ms]) => ({ label, ms })).sort((a, b) => b.ms - a.ms),
  };
}

/** "2 h 25 m", "48 m". */
export function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m` : `${m} m`;
}
