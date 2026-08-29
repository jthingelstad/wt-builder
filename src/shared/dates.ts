/**
 * Date handling for the editions.
 *
 * Timestamps carry their own offset ("2026-05-16T20:35:00-05:00") and are
 * displayed in that local wall clock, never converted to the viewer's zone: a
 * photo taken at 8:35 PM in Minnesota reads 8:35 PM to every reader.
 *
 * The issue window is the exception. It is a real instant boundary in Central
 * time, so window arithmetic converts to epoch milliseconds rather than
 * comparing date strings — see § issue window.
 */

const MONTH = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MON = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const DAY = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday',
  'Thursday', 'Friday', 'Saturday',
] as const;

/** The newsletter's editorial zone. The window is defined in this clock. */
export const ZONE = 'America/Chicago';

export interface WallClock {
  y: number;
  mo: number;
  d: number;
  hh: number;
  mm: number;
  /** YYYY-MM-DD, the grouping key for Journal date boundaries. */
  key: string;
}

/**
 * Read the wall clock out of an ISO timestamp without applying the offset.
 * Returns null for anything unparseable so callers can degrade rather than throw.
 */
export function wallClock(iso: string | undefined | null): WallClock | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso ?? '');
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    hh: Number(m[4] ?? 0),
    mm: Number(m[5] ?? 0),
    key: `${m[1]}-${m[2]}-${m[3]}`,
  };
}

export function weekdayIndex(w: WallClock): number {
  return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay();
}

/** "Saturday" — Journal groups print the weekday alone. */
export function weekday(w: WallClock): string {
  return DAY[weekdayIndex(w)]!;
}

/** "May 16, 2026" */
export function shortDate(w: WallClock): string {
  return `${MON[w.mo - 1]} ${w.d}, ${w.y}`;
}

/** "8:35 PM" */
export function clockTime(w: WallClock): string {
  const h = w.hh % 12 === 0 ? 12 : w.hh % 12;
  const suffix = w.hh < 12 ? 'AM' : 'PM';
  return `${h}:${String(w.mm).padStart(2, '0')} ${suffix}`;
}

/** "Monday, May 18" */
export function longDate(w: WallClock): string {
  return `${weekday(w)}, ${MONTH[w.mo - 1]} ${w.d}`;
}

/** Day-of-month as a spoken ordinal — "twenty-ninth". Index 1–31. */
const ORDINAL = [
  '', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth',
  'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth',
  'nineteenth', 'twentieth', 'twenty-first', 'twenty-second', 'twenty-third',
  'twenty-fourth', 'twenty-fifth', 'twenty-sixth', 'twenty-seventh',
  'twenty-eighth', 'twenty-ninth', 'thirtieth', 'thirty-first',
] as const;

/**
 * "Saturday, August twenty-ninth" — dates are spoken long in the audio
 * edition (docs/interface-spec.md, Audio lens). "August 29" read by a
 * synthesizer comes out as "August two nine" often enough to matter.
 */
export function spokenLongDate(w: WallClock): string {
  return `${weekday(w)}, ${MONTH[w.mo - 1]} ${ORDINAL[w.d] ?? String(w.d)}`;
}

/** "Fri, Aug 28" — the window boundary format on the canvas kicker. */
export function boundaryDate(isoDate: string): string {
  const c = wallClock(isoDate);
  if (!c) return isoDate;
  return `${DAY[weekdayIndex(c)]!.slice(0, 3)}, ${MON[c.mo - 1]} ${c.d}`;
}

// ── plain date arithmetic ─────────────────────────────────────────────────

export function addDays(isoDate: string, n: number): string {
  const [y, mo, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

export function dayOfWeek(isoDate: string): number {
  const [y, mo, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function isSaturday(isoDate: string): boolean {
  return dayOfWeek(isoDate) === 6;
}

/** Move a date forward to the next Saturday (the publication target). */
export function snapToSaturday(isoDate: string): string {
  return addDays(isoDate, (6 - dayOfWeek(isoDate) + 7) % 7);
}

/**
 * The Saturday an issue is dated. "No matter when I send it, the send date
 * is that Saturday" — the date is the issue's identity, not the send
 * timestamp. A Sunday or Monday send belongs to the Saturday just past, so
 * those snap BACK; earlier weekdays are a typo and snap forward to the
 * Saturday target. (The archive's 67 Sunday dates are the old workflow's
 * send timestamps; WT Builder dates the Saturday.)
 */
export function issueSaturday(isoDate: string): string {
  const d = dayOfWeek(isoDate);
  if (d === 6) return isoDate;
  if (d === 0) return addDays(isoDate, -1);
  if (d === 1) return addDays(isoDate, -2);
  return snapToSaturday(isoDate);
}

// ── zone conversion ───────────────────────────────────────────────────────

const ZONE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** How far Central time sits from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(utcMs: number): number {
  const p: Record<string, number> = {};
  for (const part of ZONE_PARTS.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  // Intl renders midnight as hour 24 in some ICU builds.
  const asIfUTC = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return asIfUTC - utcMs;
}

/**
 * The instant at which a wall-clock time occurs in Central time.
 *
 * Resolved in two passes because the offset depends on the instant we are
 * solving for: the first pass picks an offset from an approximate instant, the
 * second re-reads it at the corrected one. That matters twice a year — without
 * it, a window boundary on a DST changeover weekend lands an hour off.
 */
export function zonedMs(y: number, mo: number, d: number, hh = 0, mm = 0): number {
  const naive = Date.UTC(y, mo - 1, d, hh, mm);
  const first = naive - zoneOffsetMs(naive);
  return naive - zoneOffsetMs(first);
}

/**
 * An ISO timestamp as an instant.
 *
 * A timestamp carrying an offset is authoritative. A bare date or a local
 * timestamp without one is read as Central wall clock, which is what Pinboard
 * and Micro.blog effectively mean by a local date.
 */
export function instantOf(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const c = wallClock(iso);
  if (!c) return null;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso.trim())
    ? Date.parse(iso)
    : zonedMs(c.y, c.mo, c.d, c.hh, c.mm);
}

// ── issue window ──────────────────────────────────────────────────────────
//
// The content cutoff runs Friday 00:00 CT to Friday 00:00 CT — a half-open
// interval [from, to). An item captured Thursday at 11:58 PM Central is in;
// one captured Friday at 12:02 AM belongs to the next issue. See
// docs/decisions.md.
//
// This is an instant comparison, not a date comparison. A Thursday 11 PM CT
// bookmark is stored as Friday 04:00 UTC, and comparing the date part alone
// pushes it into the following week.

export interface Window {
  /** YYYY-MM-DD of the opening Friday. Inclusive, at 00:00 CT. */
  from: string;
  /** YYYY-MM-DD of the closing Friday. Exclusive, at 00:00 CT. */
  to: string;
  /** The same boundaries as instants. */
  fromMs: number;
  toMs: number;
}

/** The Friday strictly before a date. */
function previousFriday(isoDate: string): string {
  const back = (dayOfWeek(isoDate) - 5 + 7) % 7;
  return addDays(isoDate, -(back === 0 ? 7 : back));
}

/**
 * The sweep window for an issue published on `publicationDate` (a Saturday).
 * Closes at 00:00 CT on the preceding Friday and opens `windowDays` earlier.
 */
export function issueWindow(publicationDate: string, windowDays: number): Window {
  const to = previousFriday(publicationDate);
  const from = addDays(to, -windowDays);
  const at = (date: string) => {
    const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
    return zonedMs(y, mo, d);
  };
  return { from, to, fromMs: at(from), toMs: at(to) };
}

/** Is a timestamp inside the window? Half-open: [from, to). */
export function inWindow(iso: string | undefined, w: Window): boolean {
  const ms = instantOf(iso);
  if (ms === null) return false;
  return ms >= w.fromMs && ms < w.toMs;
}

/** "Fri, Aug 28 → Fri, Sep 4" */
export function windowLabel(w: Window): string {
  return `${boundaryDate(w.from)} → ${boundaryDate(w.to)}`;
}

// ── chrome formats ────────────────────────────────────────────────────────

/** "SAT, SEP 5, 2026" — the head block's mono kicker. */
export function kickerDate(isoDate: string): string {
  const c = wallClock(isoDate);
  if (!c) return isoDate;
  return `${DAY[weekdayIndex(c)]!.slice(0, 3)}, ${MON[c.mo - 1]} ${c.d}, ${c.y}`.toUpperCase();
}

/** "SAT, SEP 5" — the header identity line. */
export function shortKicker(isoDate: string): string {
  const c = wallClock(isoDate);
  if (!c) return isoDate;
  return `${DAY[weekdayIndex(c)]!.slice(0, 3)}, ${MON[c.mo - 1]} ${c.d}`.toUpperCase();
}

/**
 * "SOURCES AUG 28–SEP 4" — the header's window meta, which is the first thing
 * allowed to truncate when the header runs out of room.
 */
export function sourcesLabel(w: Window): string {
  const a = wallClock(w.from);
  const b = wallClock(w.to);
  if (!a || !b) return '';
  const month = (c: WallClock) => MON[c.mo - 1]!.toUpperCase();
  return `SOURCES ${month(a)} ${a.d}–${month(b)} ${b.d}`;
}

/** "AUG 28–SEP 4", for the left panel's Sources line. */
export function spanLabel(w: Window): string {
  return sourcesLabel(w).replace(/^SOURCES /, '');
}

// ── the deadline ──────────────────────────────────────────────────────────

export interface Countdown {
  label: string;
  /** How the chip reads: quiet, close, or past. */
  tone: 'grey' | 'amber' | 'terracotta';
}

/**
 * How long there is until an issue publishes.
 *
 * The Weekly Thing has a standing Saturday deadline, so this is a fact about
 * the issue rather than a detail — it is the reason the dashboard says
 * "TOMORROW" rather than a date the reader has to subtract from today.
 *
 * Measured in whole days in Central, so "TODAY" means the publication date has
 * arrived on Jamie's clock, not on UTC's.
 */
export function countdown(publicationDate: string, now = new Date()): Countdown {
  const today = wallClock(
    new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(now),
  );
  const target = wallClock(publicationDate);
  if (!today || !target) return { label: '', tone: 'grey' };

  const day = 86_400_000;
  const days = Math.round(
    (Date.UTC(target.y, target.mo - 1, target.d) - Date.UTC(today.y, today.mo - 1, today.d)) / day,
  );

  if (days < 0) {
    const late = Math.abs(days);
    return { label: `${late} DAY${late === 1 ? '' : 'S'} LATE`, tone: 'terracotta' };
  }
  if (days === 0) return { label: 'TODAY', tone: 'terracotta' };
  if (days === 1) return { label: 'TOMORROW', tone: 'amber' };
  // Inside three days the deadline stops being background information.
  return { label: `IN ${days} DAYS`, tone: days <= 3 ? 'amber' : 'grey' };
}
