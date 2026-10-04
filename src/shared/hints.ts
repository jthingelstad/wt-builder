/**
 * Row hints: what a row should say about itself that its pill does not.
 *
 * Warn, don't block: a hint never touches readiness, a send, or the words.
 * The pill stays done. Pure, and on both sides: the editor marks the row and
 * the MCP reports the same list, so Jamie and an agent riding along see one
 * thing (docs/mcp-ride-along-plan.md, Part B; notes 2 and 12 of the WT352
 * ride-along).
 *
 * - `link`: an open link finding on the item (dead, moved, or a gift link),
 *   which until now showed only in the inspector and the Send card. Jamie
 *   expected one on WT352's expired Verge gift link (B1).
 * - `unfinished`: Jamie's own words ending mid-sentence, or a Currently line
 *   of a few words. WT352's dots commentary ended "…Dots feels more" and was
 *   done by word count (B2). Every line Jamie published in WT350 and WT351
 *   ends in a full stop, an ellipsis, or an emoji, so this stays quiet on
 *   finished text. The editor hides it while the row has the caret.
 * - `title`: a syndicated title that still ends with the site's name, or runs
 *   long (B3). Most of WT350's and WT351's titles kept their suffix, so it is
 *   the quietest mark, and it goes once Jamie has edited the title
 *   (`title_edited`, set by updateItem): he has looked at it. Never rewrites: the title is his to trim.
 */

import type { IssueDoc, Item } from './types.ts';
import { giftLine, linkFindings, type LinkFinding } from './link-findings.ts';
import { MD_TARGET } from './links.ts';

export type HintKind = 'link' | 'unfinished' | 'title';

export interface Hint {
  kind: HintKind;
  text: string;
}

/** A Currently line shorter than this reads as a note to self. Published ones run 40+ words. */
export const SHORT_CURRENTLY = 6;

/** A title longer than this is probably the page's headline and dek together. */
export const LONG_TITLE = 90;

/** The words Jamie writes on an item, or undefined for items that are not his prose. */
function ownWords(item: Item): string | undefined {
  if (item.authorship === 'Thingy') return undefined;
  switch (item.type) {
    case 'pinboard_link': return item.commentary;
    case 'intro':
    case 'outro':
    case 'currently': return item.body;
    default: return undefined;
  }
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/**
 * The last few words, when the text stops where a sentence cannot: on a
 * letter, a digit, a comma, a semicolon, or a dash. A closing quote, bracket
 * or emphasis mark is looked through; a list, a heading, a quote block, a
 * code fence, or a closing URL is not a sentence and is left alone.
 */
export function unfinishedTail(text: string): string | undefined {
  const lines = text.replace(/<img\b[^>]*>/gi, ' ').trimEnd().split('\n');
  const last = lines.at(-1)?.trim() ?? '';
  if (!last || /^([-*+>#|]|\d+[.)]\s|```)/.test(last)) return undefined;
  const plain = last
    .replace(new RegExp(String.raw`!\[[^\]]*\]${MD_TARGET}`, 'g'), ' ')
    .replace(new RegExp(String.raw`\[([^\]]*)\]${MD_TARGET}`, 'g'), '$1')
    .trimEnd();
  if (/https?:\/\/\S+$/.test(plain)) return undefined;
  const bare = plain.replace(/[)\]}"'”’»*_~`]+$/u, '');
  if (!/[\p{L}\p{N},;\-–—]$/u.test(bare)) return undefined;
  const tail = words(plain).slice(-5).join(' ');
  return tail;
}

/** "| The Verge", " - MacStories": a short run after a separator, at the end. */
const SITE_SUFFIX = /\s+([|·•]|[-–—])\s+([^|·•–—]{1,40})$/u;

export function titleHint(item: Item): string | undefined {
  if (item.type !== 'pinboard_link' || item.authorship !== 'syndicated') return undefined;
  const title = (item.title ?? '').trim();
  if (!title) return undefined;
  // Edited here, it has been looked at; what is left is Jamie's choice.
  if (item.title_edited) return undefined;
  const m = SITE_SUFFIX.exec(title);
  if (m && words(m[2]!).length <= 5 && words(title.slice(0, m.index)).length >= 2) {
    return `The page's own title still ends with “${m[1]} ${m[2]!.trim()}”: trim it if that is the site's name.`;
  }
  if (title.length > LONG_TITLE) return `The page's own title runs ${title.length} characters: trim it if it carries the headline's dek.`;
  return undefined;
}

export function unfinishedHint(item: Item): string | undefined {
  const text = ownWords(item)?.trim();
  if (!text) return undefined;
  if (item.type === 'currently') {
    const n = words(text).length;
    if (n < SHORT_CURRENTLY) return `A short Currently line, ${n} word${n === 1 ? '' : 's'}: “${text}”.`;
  }
  const tail = unfinishedTail(text);
  return tail ? `Looks unfinished: it ends “…${tail}” with no full stop.` : undefined;
}

function linkHint(f: LinkFinding): string {
  if (f.gift) return giftLine(f.gift);
  const status = f.result?.status ? ` (${f.result.status})` : '';
  if (f.result?.verdict === 'dead') return `A dead link${status}: ${f.url}`;
  return `A link that has moved${f.result?.suggestion ? ` to ${f.result.suggestion}` : ''}: ${f.url}`;
}

/**
 * Every row's hints, by item id, for the items that print. Link findings
 * follow the inspector's rule: not fine, and not kept by Jamie.
 */
export function rowHints(doc: IssueDoc, now = Date.now()): Map<string, Hint[]> {
  const out = new Map<string, Hint[]>();
  const add = (id: string, hint: Hint) => out.set(id, [...(out.get(id) ?? []), hint]);
  const kept = new Set(doc.link_check?.accepted ?? []);
  for (const f of linkFindings(doc, now).links) {
    if (kept.has(f.url) || !(f.gift || f.result?.verdict === 'dead' || f.result?.verdict === 'moved')) continue;
    for (const id of f.items) add(id, { kind: 'link', text: linkHint(f) });
  }
  for (const node of doc.nodes) {
    for (const id of node.items) {
      const item = doc.items[id];
      if (!item) continue;
      const unfinished = unfinishedHint(item);
      if (unfinished) add(id, { kind: 'unfinished', text: unfinished });
      const title = titleHint(item);
      if (title) add(id, { kind: 'title', text: title });
    }
  }
  return out;
}
