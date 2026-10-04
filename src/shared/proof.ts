/**
 * Applying a PROOF note: Review → Apply (Jamie, 2026-10-04 — "preferably I
 * could just hit an Apply button and have it changed").
 *
 * The note carries `was`, the exact words, and `now`, the fix; `nth` says
 * which occurrence when the words appear more than once (1 is the first).
 * This finds the one place `was` sits, field by field, so the fix edits a
 * single field and nothing else. The server applies it (POST
 * /api/issues/:id/proof); the client runs the same matcher to show Apply
 * only where the server would take it. Shared so the two cannot disagree.
 *
 * It refuses rather than guess: the words gone, there more than once with
 * nothing saying which, running across two fields, or only inside an
 * `<img>`/`<video>` tag in a body. A refusal is a plain sentence, and the
 * note's Show me still works.
 */

import { anchorText } from './anchor.ts';
import { mediaSpans } from './body.ts';
import type { IssueDoc, Item } from './types.ts';

export type ItemField =
  | 'title' | 'body' | 'commentary' | 'label'
  | 'media.caption' | 'media.alt' | 'media.location'
  | 'ask' | 'member_thanks';
export type HeadField = 'issue.title' | 'issue.dek';
export type ProofField = ItemField | HeadField;

/** The fields anchorText joins, in its order: `nth` counts across them in this order. */
export const ITEM_FIELDS: readonly ItemField[] = [
  'title', 'body', 'commentary', 'label',
  'media.caption', 'media.alt', 'media.location',
  'ask', 'member_thanks',
];
const HEAD_FIELDS: readonly HeadField[] = ['issue.title', 'issue.dek'];

/** What the matcher reads off a review note. */
export interface ProofNote {
  item_id: string | null;
  was?: string;
  now?: string;
  nth?: number;
}

/** One place in the issue: an item's field (or the issue's title or dek) and an offset in it. */
export interface ProofSpot {
  item_id: string | null;
  field: ProofField;
  offset: number;
}

/** `done`: every place the words sit already reads as the fix (a `now` that contains `was`). */
export type ProofWhy = 'gone' | 'twice' | 'span' | 'tag' | 'nth' | 'done';

export type ProofFind =
  | { ok: true; spot: ProofSpot }
  | { ok: false; why: ProofWhy; say: string };

function quote(words: string): string {
  const flat = words.replace(/\s+/g, ' ');
  return `"${flat.length > 48 ? `${flat.slice(0, 47)}…` : flat}"`;
}

export function itemFieldText(item: Item, field: ItemField): string {
  switch (field) {
    case 'media.caption': return item.media?.caption ?? '';
    case 'media.alt': return item.media?.alt ?? '';
    case 'media.location': return item.media?.location ?? '';
    default: return String(item[field] ?? '');
  }
}

/** The text a spot points into, or null when its item is gone. */
export function spotText(doc: IssueDoc, spot: ProofSpot): string | null {
  if (spot.item_id === null) {
    if (spot.field === 'issue.title') return doc.issue.title ?? '';
    if (spot.field === 'issue.dek') return doc.issue.dek ?? '';
    return null;
  }
  const item = Object.hasOwn(doc.items, spot.item_id) ? doc.items[spot.item_id] : undefined;
  if (!item || !(ITEM_FIELDS as readonly string[]).includes(spot.field)) return null;
  return itemFieldText(item, spot.field as ItemField);
}

interface Segment {
  item_id: string | null;
  field: ProofField;
  text: string;
  /** Spans a match may not touch: the media tags in a body. */
  mask: [number, number][];
}

function itemSegments(itemId: string, item: Item): Segment[] {
  return ITEM_FIELDS
    .map((field) => ({ item_id: itemId, field, text: itemFieldText(item, field), mask: field === 'body' ? mediaSpans(item.body) : [] }))
    .filter((s) => s.text);
}

function headSegments(doc: IssueDoc): Segment[] {
  return HEAD_FIELDS
    .map((field) => ({ item_id: null, field, text: (field === 'issue.title' ? doc.issue.title : doc.issue.dek) ?? '', mask: [] }))
    .filter((s) => s.text);
}

const touches = (at: number, len: number, mask: [number, number][]) =>
  mask.some(([s, e]) => at < e && at + len > s);

/**
 * True when the words at `at` are already part of the fix: a `now` that
 * contains `was` ("Pinboard" → "Pinboard's") still holds `was` once
 * applied, and applying it again would make "Pinboard's's".
 */
function alreadyFixed(text: string, at: number, words: string, fix?: string): boolean {
  if (!fix || fix === words) return false;
  for (let rel = fix.indexOf(words); rel !== -1; rel = fix.indexOf(words, rel + 1)) {
    if (at - rel >= 0 && text.slice(at - rel, at - rel + fix.length) === fix) return true;
  }
  return false;
}

/**
 * The one place `words` sits among the segments. Every occurrence counts,
 * overlapping ones included ("the the the" holds "the the" twice), so a
 * doubtful case is refused rather than taken. An occurrence that already
 * reads as `fix` is not one to change.
 */
function pick(segments: Segment[], words: string, nth?: number, fix?: string): ProofFind {
  const hits: ProofSpot[] = [];
  let masked = 0;
  let fixed = 0;
  for (const seg of segments) {
    for (let at = seg.text.indexOf(words); at !== -1; at = seg.text.indexOf(words, at + 1)) {
      if (touches(at, words.length, seg.mask)) masked++;
      else if (alreadyFixed(seg.text, at, words, fix)) fixed++;
      else hits.push({ item_id: seg.item_id, field: seg.field, offset: at });
    }
  }
  if (!hits.length) {
    if (fixed) return { ok: false, why: 'done', say: `it already reads ${quote(fix!)} — nothing changed` };
    return masked
      ? { ok: false, why: 'tag', say: `${quote(words)} is only inside an image or video tag — nothing changed; fix it by hand` }
      : { ok: false, why: 'gone', say: `${quote(words)} is no longer there — nothing changed` };
  }
  if (nth !== undefined && Number.isInteger(nth) && nth >= 1) {
    if (nth > hits.length) {
      return { ok: false, why: 'nth', say: `the note means occurrence ${nth} of ${quote(words)}, and there ${hits.length === 1 ? 'is one' : `are ${hits.length}`} — nothing changed; fix it by hand` };
    }
    return { ok: true, spot: hits[nth - 1]! };
  }
  if (hits.length > 1) {
    return { ok: false, why: 'twice', say: `${quote(words)} appears ${hits.length} times and the note does not say which — nothing changed; fix it by hand` };
  }
  return { ok: true, spot: hits[0]! };
}

const span = (words: string): ProofFind =>
  ({ ok: false, why: 'span', say: `${quote(words)} runs across two fields — nothing changed; fix it by hand` });

/**
 * Where a note's `was` sits, or why it cannot be applied. An item's note
 * reads that item; a note on the whole issue (item_id null) reads the
 * title and dek, then the items, as the MCP's still_applies does — and
 * applies only when a single item holds the words.
 */
export function findProof(doc: IssueDoc, note: ProofNote): ProofFind {
  const words = note.was ?? '';
  if (!words) return { ok: false, why: 'gone', say: 'the note names no words to change' };
  if (note.item_id !== null) {
    const item = Object.hasOwn(doc.items, note.item_id) ? doc.items[note.item_id] : undefined;
    if (!item) return { ok: false, why: 'gone', say: 'the item the note is about is gone — nothing changed' };
    const found = pick(itemSegments(note.item_id, item), words, note.nth, note.now);
    if (!found.ok && found.why === 'gone' && anchorText(item).includes(words)) return span(words);
    return found;
  }
  const head = pick(headSegments(doc), words, note.nth, note.now);
  if (head.ok || head.why !== 'gone') return head;
  if (`${doc.issue.title ?? ''}\n${doc.issue.dek ?? ''}`.includes(words)) return span(words);
  const holders = Object.keys(doc.items).filter((id) => anchorText(doc.items[id]!).includes(words));
  if (holders.length > 1) {
    return { ok: false, why: 'twice', say: `${quote(words)} appears in ${holders.length} items and the note does not say which — nothing changed; fix it by hand` };
  }
  if (!holders.length) return head;
  return findProof(doc, { ...note, item_id: holders[0]! });
}

/**
 * Whether a note's words are still in the issue — what keeps the note on
 * screen. Gone once fixed; and where the fix contains the words, gone once
 * every place they sit reads as the fix.
 */
export function proofStillThere(doc: IssueDoc, note: ProofNote): boolean {
  const words = note.was;
  if (!words) return true;
  const there = note.item_id !== null
    ? Object.hasOwn(doc.items, note.item_id) && anchorText(doc.items[note.item_id]!).includes(words)
    : [doc.issue.title ?? '', doc.issue.dek ?? '', ...Object.values(doc.items).map(anchorText)]
        .some((text) => text.includes(words));
  if (!there || !note.now?.includes(words)) return there;
  const found = findProof(doc, note);
  return found.ok || found.why !== 'done';
}

/** True when `words` sit at the spot, clear of any media tag. */
export function spotHolds(doc: IssueDoc, spot: ProofSpot, words: string): boolean {
  const text = spotText(doc, spot);
  if (text === null || !words || !Number.isInteger(spot.offset) || spot.offset < 0) return false;
  if (text.slice(spot.offset, spot.offset + words.length) !== words) return false;
  if (spot.field === 'body' && spot.item_id !== null) {
    return !touches(spot.offset, words.length, mediaSpans(doc.items[spot.item_id]!.body));
  }
  return true;
}

/**
 * Where to put a fix back (Undo): the spot the Apply answered with, if
 * `now` still sits there; otherwise the only place `now` sits in that item
 * (or the title and dek). The same refusals as the forward fix.
 */
export function findUndo(doc: IssueDoc, note: ProofNote, spot: ProofSpot): ProofFind {
  const words = note.now ?? '';
  if (!words) return { ok: false, why: 'gone', say: 'the note names no fix to take back' };
  if (note.item_id !== null && spot.item_id !== note.item_id) {
    return { ok: false, why: 'gone', say: 'that fix was not made to this note\'s item — nothing changed' };
  }
  if (spotHolds(doc, spot, words)) return { ok: true, spot };
  if (spot.item_id === null) return pick(headSegments(doc), words);
  const item = Object.hasOwn(doc.items, spot.item_id) ? doc.items[spot.item_id] : undefined;
  if (!item) return { ok: false, why: 'gone', say: 'the item the fix was made to is gone — nothing changed' };
  return pick(itemSegments(spot.item_id, item), words);
}

/** A spot as the client sent it back, or null when it is not one. */
export function asSpot(raw: unknown): ProofSpot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const itemId = r.item_id === null ? null : typeof r.item_id === 'string' ? r.item_id : undefined;
  if (itemId === undefined || typeof r.field !== 'string' || !Number.isInteger(r.offset) || (r.offset as number) < 0) return null;
  const fields: readonly string[] = itemId === null ? HEAD_FIELDS : ITEM_FIELDS;
  if (!fields.includes(r.field)) return null;
  return { item_id: itemId, field: r.field as ProofField, offset: r.offset as number };
}

export interface ProofEdit {
  /** For an item's field: the patch, whole `media` included. */
  item?: { id: string; patch: Partial<Item> };
  /** For the issue's title or dek. */
  head?: { title?: string; dek?: string };
  /** Where the new words now sit. */
  spot: ProofSpot;
}

/** Replace `from` at the spot with `to`. The caller has checked the spot holds `from`. */
export function editAt(doc: IssueDoc, spot: ProofSpot, from: string, to: string): ProofEdit {
  const text = spotText(doc, spot) ?? '';
  const next = text.slice(0, spot.offset) + to + text.slice(spot.offset + from.length);
  if (spot.item_id === null) {
    return { head: spot.field === 'issue.title' ? { title: next } : { dek: next }, spot };
  }
  const item = doc.items[spot.item_id]!;
  const patch: Partial<Item> = spot.field.startsWith('media.')
    ? { media: { ...item.media, [spot.field.slice('media.'.length)]: next } }
    : { [spot.field]: next };
  return { item: { id: spot.item_id, patch }, spot };
}

/**
 * The change in a few words, for the Apply button: only the words that
 * differ, so "I had never heard of TLA." → "I had never heard of TLA+."
 * reads `TLA. → TLA+.`. A fix that only removes words is `cut "were"`;
 * one that only adds is `add "to"`.
 */
export function changeLabel(was: string, now: string, max = 24): string {
  const a = was.split(/\s+/).filter(Boolean);
  const b = now.split(/\s+/).filter(Boolean);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const cut = (s: string) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  const from = cut(a.slice(head, a.length - tail).join(' '));
  const to = cut(b.slice(head, b.length - tail).join(' '));
  if (!from && !to) return `${cut(was)} → ${cut(now)}`; // only spacing differs
  if (!to) return `cut "${from}"`;
  if (!from) return `add "${to}"`;
  return `${from} → ${to}`;
}
