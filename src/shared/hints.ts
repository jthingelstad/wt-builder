/**
 * Row hints: what a row should say about itself that its pill does not.
 *
 * Warn, don't block: a hint never touches readiness, a send, or the words.
 * The pill stays done. Pure, and on both sides: the editor marks the row and
 * the MCP reports the same list, so Jamie and an agent riding along see one
 * thing (docs/mcp-ride-along-plan.md, Part B; notes 2 and 12 of the WT352
 * ride-along).
 *
 * - `link`: an open link finding on the item (dead, moved to another page,
 *   or a gift link; `actionOf` in link-findings.ts), which until now showed
 *   only in the inspector and the Send card. Jamie expected one on WT352's
 *   expired Verge gift link (B1). Since 2026-10-04 links are checked as they
 *   arrive, so this is where a finding is seen: while writing.
 * - `mail`: what in the email a filter holds against it, on the row that
 *   prints it: a domain on a spam blocklist, a plain-http link, link text
 *   naming another site, a bare address, a download; and the subject's
 *   warnings on the title's row (`issue`). `key` is the finding's, for Keep.
 *   The email's size is the whole issue's, and is said only on the Send
 *   view's line (`openChecks`).
 * - `unfinished`: Jamie's own words ending mid-sentence, or a Currently line
 *   of a few words. WT352's dots commentary ended "…Dots feels more" and was
 *   done by word count (B2). Every line Jamie published in WT350 and WT351
 *   ends in a full stop, an ellipsis, or an emoji, so this stays quiet on
 *   finished text. The editor hides it while the row has the caret.
 * - `title`: a syndicated title that still ends with the site's name, or runs
 *   long (B3). Most of WT350's and WT351's titles kept their suffix, so it is
 *   the quietest mark, and it goes once Jamie has edited the title
 *   (`title_edited`, set by updateItem): he has looked at it. Never rewrites: the title is his to trim.
 * - `haiku`: a haiku that is not three lines of 5, 7 and 5 syllables. WT352's
 *   generated haiku was not, and nearly went out (Jamie: "i don't want to
 *   have a non-haiku sent"). The count is a heuristic (src/shared/syllables.ts),
 *   so the hint says what it counted ("5-6-5") for Jamie to judge by ear.
 */

import type { IssueDoc, Item } from './types.ts';
import { actionOf, giftLine, linkFindings, type LinkFinding } from './link-findings.ts';
import { anchorFor, deliverabilityFindings, type DeliverabilityFindings, type FindingKind } from './deliverability.ts';
import { MD_TARGET } from './links.ts';
import { orderedNodes } from './render/plan.ts';
import { haikuForm } from './syllables.ts';

export type HintKind = 'link' | 'mail' | 'unfinished' | 'title' | 'haiku';

export interface Hint {
  kind: HintKind;
  text: string;
  /** A few words for the Send view's line: "dead link". Link and mail hints only. */
  short?: string;
  /** A content finding's key in deliverability.ts, for Keep on the row. */
  key?: string;
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

/** A haiku that is not 5-7-5, with what was counted. Nothing for an empty one: its pill says that. */
export function haikuHint(item: Item): string | undefined {
  if (item.type !== 'haiku' || !String(item.body ?? '').trim()) return undefined;
  const form = haikuForm(item.body!);
  if (form.ok) return undefined;
  const guess = 'The count is a guess from spelling, so trust your ear.';
  return form.counts.length === 3
    ? `Counted ${form.shape} syllables, not 5-7-5. ${guess}`
    : `A haiku is three lines; this is ${form.counts.length}, counted ${form.shape}. ${guess}`;
}

function linkHint(f: LinkFinding): Hint {
  const status = f.result?.status ? ` (${f.result.status})` : '';
  switch (actionOf(f)) {
    case 'gift': return { kind: 'link', text: giftLine(f.gift!), short: f.gift!.expired ? 'expired gift link' : 'gift link' };
    case 'dead': return { kind: 'link', text: `A dead link${status}${f.result?.note ? `, ${f.result.note}` : ''}: ${f.url}`, short: 'dead link' };
    default:
      return f.result?.https === 'fails'
        ? { kind: 'link', text: `Its https:// address fails; the http:// one works: ${f.url}`, short: 'https fails' }
        : { kind: 'link', text: `A link that has moved to ${f.result?.suggestion}: ${f.url}`, short: 'moved link' };
  }
}

const MAIL_SHORT: Record<FindingKind, string> = {
  http: 'plain-http link', mismatch: 'link text names another site', address: 'link to a bare address',
  file: 'download link', subject: 'subject warning', size: "close to Gmail's clip",
};

/** The rows that print any of these URLs, in reading order; the issue's own frame is none. */
function rowsPrinting(doc: IssueDoc, urls: string[]): string[] {
  return [...new Set(urls.map((u) => anchorFor(doc, u)).filter((a) => a !== 'issue'))];
}

function listedText(d: DeliverabilityFindings['unaccepted'][number]): string {
  return `${d.domain} is on a spam blocklist (${(d.result?.lists ?? []).join('; ')}): filters may send the whole issue to spam. Change the link, or the email asks before it goes.`;
}

/**
 * Every row's hints, by item id, for the items that print. Link and mail
 * findings follow one rule: something to act on, and not kept by Jamie.
 */
export function rowHints(doc: IssueDoc, now = Date.now(), mail: DeliverabilityFindings = deliverabilityFindings(doc)): Map<string, Hint[]> {
  const out = new Map<string, Hint[]>();
  const add = (id: string, hint: Hint) => out.set(id, [...(out.get(id) ?? []), hint]);
  for (const f of linkFindings(doc, now).open) {
    for (const id of f.items) add(id, linkHint(f));
  }
  for (const d of mail.unaccepted) {
    for (const id of rowsPrinting(doc, d.urls)) add(id, { kind: 'mail', text: listedText(d), short: 'domain on a spam blocklist' });
  }
  for (const f of mail.open) {
    // The size is the whole email's: the Send view's line says it.
    if (f.kind === 'size') continue;
    add(f.anchor, { kind: 'mail', text: f.message, short: MAIL_SHORT[f.kind], key: f.key });
  }
  for (const node of doc.nodes) {
    for (const id of node.items) {
      const item = doc.items[id];
      if (!item) continue;
      const unfinished = unfinishedHint(item);
      if (unfinished) add(id, { kind: 'unfinished', text: unfinished });
      const title = titleHint(item);
      if (title) add(id, { kind: 'title', text: title });
      const haiku = haikuHint(item);
      if (haiku) add(id, { kind: 'haiku', text: haiku });
    }
  }
  return out;
}

/** A row's name for a line that points at it: the title, or the first words. */
export function rowName(doc: IssueDoc, anchor: string): string {
  if (anchor === 'issue') return 'The title';
  const node = doc.nodes.find((n) => n.id === anchor);
  if (node) return node.label;
  const item = doc.items[anchor];
  if (!item) return anchor;
  const raw = item.title ?? item.label ?? String(item.commentary ?? item.body ?? '');
  const text = raw
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(new RegExp(String.raw`!\[[^\]]*\]${MD_TARGET}`, 'g'), ' ')
    .replace(new RegExp(String.raw`\[([^\]]+)\]${MD_TARGET}`, 'g'), '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '(untitled)';
  return text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text;
}

export interface OpenCheck {
  anchor: string;
  name: string;
  /** What is open on it, a few words each: "dead link", "subject warning". */
  what: string[];
}

/**
 * The Send view's one line (2026-10-04): every row with a link or mail
 * finding to act on, in reading order, and what is the whole email's (its
 * size, a listed domain no row prints). Nothing in either is clear.
 */
export function openChecks(doc: IssueDoc, now = Date.now()): { rows: OpenCheck[]; issue: string[] } {
  const mail = deliverabilityFindings(doc);
  const hints = rowHints(doc, now, mail);
  const order = ['issue', ...orderedNodes(doc).flatMap((n) => [n.id, ...n.items])];
  const rows: OpenCheck[] = [];
  for (const anchor of [...new Set(order)]) {
    const what = [...new Set((hints.get(anchor) ?? [])
      .filter((h) => h.kind === 'link' || h.kind === 'mail')
      .map((h) => h.short!))];
    if (what.length) rows.push({ anchor, name: rowName(doc, anchor), what });
  }
  const issue = [
    ...mail.open.filter((f) => f.kind === 'size').map((f) => f.message),
    ...mail.unaccepted.filter((d) => !rowsPrinting(doc, d.urls).length).map(listedText),
  ];
  return { rows, issue };
}
