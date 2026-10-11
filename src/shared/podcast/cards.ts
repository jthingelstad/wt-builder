/**
 * Cards and blocks: the one line-markup the outline speaks, and the small
 * derivations everything else asks for.
 *
 * The editor edits a card's blocks as text, one block per line, typed by a
 * leading mark:
 *
 *   plain text      line      say it your own way
 *   ! word          trigger   glance only
 *   " sentence      verbatim  say it close to word-for-word
 *   > sentence      bridge    the transition into the next beat
 *   ? riff          cuttable  drop it when behind
 *
 * Inside any line, `*a few words*` are glance words and render gold.
 * Parse and serialize round-trip exactly, so an edit survives a re-render.
 */

import type { Block, BlockType, Card, Segment } from './types.ts';

const MARKS: Record<string, BlockType> = { '!': 'trigger', '"': 'verbatim', '>': 'bridge', '?': 'cuttable' };
const MARK_OF: Record<BlockType, string> = { line: '', trigger: '! ', verbatim: '" ', bridge: '> ', cuttable: '? ' };

export function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const mark = MARKS[line[0]!];
    // A mark needs a space after it: "?!" or "!important" is a plain line.
    const t: BlockType = mark && /^\S\s/.test(line) ? mark : 'line';
    const body = t === 'line' ? line : line.slice(1).trim();
    if (body) out.push({ t, text: body });
  }
  return out;
}

export function serializeBlocks(blocks: Block[]): string {
  return blocks.map((b) => `${MARK_OF[b.t]}${b.text}`).join('\n');
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Does the card have anything to record from? */
export function cardHasContent(card: Card): boolean {
  return Boolean(card.claim?.trim()) || card.blocks.some((b) => b.text.trim());
}

export function segmentHasContent(seg: Segment): boolean {
  return seg.cards.some(cardHasContent);
}

/** A segment as one line for a log entry: its title, or its first words. */
export function segmentName(seg: Segment): string {
  const text = seg.title.trim() || seg.cards.map((c) => c.claim ?? c.blocks[0]?.text ?? '').find(Boolean) || '(untitled)';
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * The plan's seconds for one card: its own, or an even share of what its
 * segment's minutes leave. Null when the segment is unbudgeted: a partial
 * plan would lie, and the card says nothing rather than something wrong.
 */
export function cardSeconds(seg: Segment, card: Card): number | null {
  if (card.seconds !== undefined && card.seconds !== null) return card.seconds;
  if (seg.minutes === undefined || seg.minutes === null) return null;
  const own = seg.cards.filter((c) => c.seconds !== undefined && c.seconds !== null);
  const spoken = own.reduce((sum, c) => sum + c.seconds!, 0);
  const rest = seg.cards.length - own.length;
  if (rest <= 0) return 0;
  return Math.max(0, seg.minutes * 60 - spoken) / rest;
}

/**
 * Inline glance words: `*predictability*` inside a line renders gold, so a
 * few words of a sentence can be the glance without becoming their own
 * block. A pure split, so the client renders spans without innerHTML. An
 * unmatched `*` is just an asterisk.
 */
export function inlineRuns(text: string): { text: string; glance: boolean }[] {
  const out: { text: string; glance: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/\*([^*\n]+)\*/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), glance: false });
    out.push({ text: m[1]!, glance: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), glance: false });
  return out;
}
