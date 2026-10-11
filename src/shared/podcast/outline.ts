/**
 * The outline as it arrives from the editor: checked into shape, and set
 * beside the outline it replaces to say what changed.
 *
 * The editor saves the whole outline at once (it is small: a few segments
 * of a few cards), and the server narrates the save as events, one per
 * segment touched: a structural change (segments or cards added, removed,
 * reordered) is `structure`, a change of words is `edit`, each anchored to
 * its segment so the timing and the log can say where the time went.
 */

import { newId, segmentName } from './cards.ts';
import { BLOCK_TYPES, SEGMENT_ROLES, type Block, type Card, type Segment } from './types.ts';
import type { EventInput } from '../events.ts';

const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100_000 ? v : undefined;

/** An outline from the wire, made well-formed: unknown fields dropped, ids given where missing. */
export function cleanOutline(input: unknown): Segment[] {
  if (!Array.isArray(input)) throw new Error('segments must be a list');
  const ids = new Set<string>();
  const unique = (id: unknown, prefix: string) => {
    let out = typeof id === 'string' && /^[\w-]{1,64}$/.test(id) ? id : newId(prefix);
    while (ids.has(out)) out = newId(prefix);
    ids.add(out);
    return out;
  };
  // Anything that is not a segment-shaped object is dropped, not made into an empty segment.
  const shaped = input.slice(0, 200).filter((raw) => raw !== null && typeof raw === 'object' && !Array.isArray(raw));
  return shaped.map((raw): Segment => {
    const s = raw as Record<string, unknown>;
    const role = SEGMENT_ROLES.find((r) => r === s.role);
    const minutes = num(s.minutes);
    const cards = (Array.isArray(s.cards) ? s.cards : []).slice(0, 200).map((rc): Card => {
      const c = (rc ?? {}) as Record<string, unknown>;
      const blocks = (Array.isArray(c.blocks) ? c.blocks : []).slice(0, 200).flatMap((rb): Block[] => {
        const b = (rb ?? {}) as Record<string, unknown>;
        const t = BLOCK_TYPES.find((x) => x === b.t) ?? 'line';
        const text = str(b.text).trim();
        return text ? [{ t, text }] : [];
      });
      const seconds = num(c.seconds);
      return {
        id: unique(c.id, 'card'),
        ...(str(c.kicker, 80).trim() ? { kicker: str(c.kicker, 80).trim() } : {}),
        ...(str(c.claim, 400).trim() ? { claim: str(c.claim, 400).trim() } : {}),
        blocks,
        ...(seconds !== undefined ? { seconds } : {}),
      };
    });
    const links = (Array.isArray(s.links) ? s.links : []).slice(0, 50).flatMap((rl) => {
      const l = (rl ?? {}) as Record<string, unknown>;
      const url = str(l.url, 2000).trim();
      return /^https?:\/\/\S+$/.test(url) ? [{ text: str(l.text, 300).trim(), url }] : [];
    });
    return {
      id: unique(s.id, 'seg'),
      title: str(s.title, 300).trim(),
      ...(role ? { role } : {}),
      cards,
      ...(minutes !== undefined ? { minutes } : {}),
      links,
    };
  });
}

const words = (c: Card) => JSON.stringify([c.kicker ?? '', c.claim ?? '', c.blocks, c.seconds ?? null]);

/** What a save changed, as events: one or two per segment touched, and one for the order. */
export function outlineEvents(before: Segment[], after: Segment[]): EventInput[] {
  const out: EventInput[] = [];
  const old = new Map(before.map((s) => [s.id, s]));
  const now = new Set(after.map((s) => s.id));

  for (const seg of after) {
    const prev = old.get(seg.id);
    if (!prev) {
      out.push({ kind: 'structure', summary: `Added segment — ${segmentName(seg)}`, anchor: seg.id, data: { action: 'add-segment' } });
      continue;
    }
    const prevCards = new Map(prev.cards.map((c) => [c.id, c]));
    const added = seg.cards.filter((c) => !prevCards.has(c.id)).length;
    const removed = prev.cards.filter((c) => !seg.cards.some((x) => x.id === c.id)).length;
    const kept = seg.cards.filter((c) => prevCards.has(c.id)).map((c) => c.id);
    const reordered = kept.join() !== prev.cards.filter((c) => kept.includes(c.id)).map((c) => c.id).join();
    if (added || removed || reordered) {
      const parts = [added && `${added} added`, removed && `${removed} removed`, reordered && 'reordered'].filter(Boolean);
      out.push({ kind: 'structure', summary: `Cards ${parts.join(', ')} — ${segmentName(seg)}`, anchor: seg.id, data: { added, removed, reordered } });
    }
    const changedCards = seg.cards.filter((c) => prevCards.has(c.id) && words(prevCards.get(c.id)!) !== words(c)).length;
    const own = prev.title !== seg.title || prev.role !== seg.role || prev.minutes !== seg.minutes;
    const links = JSON.stringify(prev.links) !== JSON.stringify(seg.links);
    if (changedCards || own || links) {
      const what = [own && 'segment', changedCards && `${changedCards} card${changedCards === 1 ? '' : 's'}`, links && 'links'].filter(Boolean);
      out.push({ kind: 'edit', summary: `Edited ${what.join(', ')} — ${segmentName(seg)}`, anchor: seg.id, data: { cards: changedCards, segment: own, links } });
    }
  }
  for (const seg of before) {
    if (!now.has(seg.id)) {
      out.push({ kind: 'structure', summary: `Removed segment — ${segmentName(seg)}`, anchor: seg.id, data: { action: 'remove-segment' } });
    }
  }
  const keptOrder = after.filter((s) => old.has(s.id)).map((s) => s.id).join();
  const oldOrder = before.filter((s) => now.has(s.id)).map((s) => s.id).join();
  if (keptOrder !== oldOrder) out.push({ kind: 'structure', summary: 'Reordered segments', data: { action: 'reorder' } });
  return out;
}
