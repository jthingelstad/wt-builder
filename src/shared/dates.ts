/**
 * Date handling for the editions.
 *
 * Timestamps carry their own offset ("2026-05-16T20:35:00-05:00") and are
 * displayed in that local wall clock, never converted to the viewer's zone: a
 * photo taken at 8:35 PM in Minnesota reads 8:35 PM to every reader.
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

// ── issue window ──────────────────────────────────────────────────────────
//
// The window closes Friday at 00:00, so the span ends Thursday and anything
// captured on Friday belongs to the next issue (docs/item-model.md).

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

/** Move a date forward to the next Saturday (publication day). */
export function snapToSaturday(isoDate: string): string {
  return addDays(isoDate, (6 - dayOfWeek(isoDate) + 7) % 7);
}

export interface Window {
  from: string;
  to: string;
}

/**
 * The sweep window for an issue published on `publicationDate` (a Saturday).
 * Ends the preceding Thursday; reaches `windowDays` back from there inclusive.
 */
export function issueWindow(publicationDate: string, windowDays: number): Window {
  const to = addDays(publicationDate, -2);
  return { from: addDays(to, -(windowDays - 1)), to };
}

/** Is a timestamp inside the window? Compared on date alone. */
export function inWindow(iso: string | undefined, w: Window): boolean {
  const c = wallClock(iso);
  if (!c) return false;
  return c.key >= w.from && c.key <= w.to;
}
