/**
 * Resolving an issue document into an ordered edition for one channel.
 *
 * All three renderers plan from here so ordering, channel filtering, and
 * Journal date grouping cannot drift between the editions.
 */

import type { Channel, IssueDoc, IssueNode, Item } from '../types.ts';
import { CHANNELS, inChannel } from '../types.ts';
import { type Window, inWindow, issueWindow, wallClock, weekday } from '../dates.ts';

export interface PlannedItem {
  id: string;
  item: Item;
}

export interface JournalGroup {
  /** YYYY-MM-DD, the boundary the group was cut on. */
  key: string;
  /** The group prints the weekday alone — the date is established by the issue. */
  weekday: string;
  items: PlannedItem[];
}

export interface PlannedNode {
  node: IssueNode;
  items: PlannedItem[];
  /** Present only for Journal sections. */
  groups?: JournalGroup[];
}

// ── inclusion ─────────────────────────────────────────────────────────────
//
// `included` is derived, never stored: an item is in the issue when at least
// one channel is on *and* it falls inside the window (docs/interface-spec.md
// § Item, and 0022). Deriving it on read is what makes changing the publish
// date or the window length re-derive every item for free — a stored flag
// would need a sweep, and the sweep is what goes stale.

/** The source window this document currently describes. */
export function windowOf(doc: IssueDoc): Window {
  return issueWindow(doc.issue.publication_date, doc.issue.window_days);
}

/**
 * Did this item fall outside the window?
 *
 * Only syndicated items are subject to it. Jamie's own writing — the intro, a
 * haiku, a Currently line — is composed for this issue and carries no capture
 * timestamp, so it is always in. A syndicated item with no timestamp is kept
 * rather than dropped: an unjudgeable item is a data problem, and silently
 * deleting it would hide it.
 */
export function outOfWindow(item: Item, w: Window): boolean {
  if (item.authorship !== 'syndicated') return false;
  if (!item.published_at) return false;
  return !inWindow(item.published_at, w);
}

/** No channel on — held out by the editorial act of exclusion. */
export function heldOut(item: Item): boolean {
  return !CHANNELS.some((c) => item.channels[c]);
}

/** Derived: at least one channel on, and inside the window. */
export function isIncluded(item: Item, w: Window): boolean {
  return !heldOut(item) && !outOfWindow(item, w);
}

/**
 * The items the window still admits, as `[id, item]` pairs. Every editor-side
 * count and check reads through this so the instruments agree with the
 * editions: an item that fell out when the window shrank is not counted, not
 * asked for commentary, and not fed to the wand.
 */
export function itemsInWindow(doc: IssueDoc): [string, Item][] {
  const w = windowOf(doc);
  return Object.entries(doc.items).filter(([, item]) => !outOfWindow(item, w));
}

/** Exactly one channel on — an edition-only item, which the canvas says out loud. */
export function editionOnly(item: Item): boolean {
  return CHANNELS.filter((c) => item.channels[c]).length === 1;
}

export interface Fallout {
  /** How many of the node's items fell outside the window. */
  count: number;
  /**
   * Every item fell out. The canvas dims the heading to `opacity: .45` and
   * prints ALL n FELL OUTSIDE THE WINDOW rather than letting the section
   * vanish — a section that disappears silently reads as data loss.
   */
  all: boolean;
}

/** What the window took out of one node. Editor-only; editions just drop them. */
export function falloutOf(doc: IssueDoc, node: IssueNode, w: Window): Fallout {
  const items = node.items
    .map((id) => doc.items[id])
    .filter((i): i is Item => Boolean(i));
  const count = items.filter((i) => outOfWindow(i, w)).length;
  return { count, all: items.length > 0 && count === items.length };
}

/** Sections whose items are announced with a spoken "Link N of M" signpost. */
const LINK_SECTIONS = new Set(['notable', 'briefly', 'featured']);

export function isLinkSection(node: IssueNode): boolean {
  return LINK_SECTIONS.has(String(node.type));
}

/**
 * Order the nodes: `output_order` when the document carries one, otherwise the
 * node array's own order. A node pinned `fixed_position: 'last'` (Echoes) is
 * moved to the end regardless of where the order puts it.
 */
export function orderedNodes(doc: IssueDoc): IssueNode[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const order = doc.issue.output_order;

  let nodes: IssueNode[];
  if (order && order.length) {
    const seen = new Set<string>();
    nodes = [];
    for (const id of order) {
      const n = byId.get(id);
      if (n && !seen.has(id)) {
        nodes.push(n);
        seen.add(id);
      }
    }
    // Anything not named in output_order keeps its document position.
    for (const n of doc.nodes) if (!seen.has(n.id)) nodes.push(n);
  } else {
    nodes = [...doc.nodes];
  }

  const pinned = nodes.filter((n) => n.fixed_position === 'last');
  if (!pinned.length) return nodes;
  return [...nodes.filter((n) => n.fixed_position !== 'last'), ...pinned];
}

/**
 * Group Journal items on publication-date boundaries, preserving item order.
 * A group is cut whenever the date changes, so a section that revisits a date
 * later produces a second group rather than silently merging.
 */
export function groupJournal(items: PlannedItem[]): JournalGroup[] {
  const groups: JournalGroup[] = [];
  for (const entry of items) {
    const w = wallClock(entry.item.published_at);
    const key = w ? w.key : '';
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(entry);
    } else {
      groups.push({ key, weekday: w ? weekday(w) : '', items: [entry] });
    }
  }
  return groups;
}

/**
 * The ordered, channel-filtered edition. Nodes with no visible items are
 * dropped: a section that is empty in this channel does not print its heading.
 */
export function planEdition(doc: IssueDoc, channel: Channel): PlannedNode[] {
  const planned: PlannedNode[] = [];
  const w = windowOf(doc);

  for (const node of orderedNodes(doc)) {
    const items: PlannedItem[] = [];
    for (const id of node.items) {
      const item = doc.items[id];
      if (!item) continue;
      if (outOfWindow(item, w)) continue;
      if (!inChannel(item, channel)) continue;
      items.push({ id, item });
    }
    if (!items.length) continue;

    const entry: PlannedNode = { node, items };
    if (node.type === 'journal' && node.kind === 'section') {
      entry.groups = groupJournal(items);
    }
    planned.push(entry);
  }

  return planned;
}

/**
 * Split a body into lines, tolerating a literal backslash-n that survived a
 * round trip through JSON encoding. Haiku depends on this: each line is its own
 * spoken block, and a haiku collapsed to one line reads as prose.
 */
export function bodyLines(body: string | undefined): string[] {
  return String(body ?? '')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * A long post's Markdown, one block per paragraph, heading, list, or quote.
 *
 * A Journal moment is a sentence or two and flattens to one line; a promoted
 * post is an article, and flattening it welds every paragraph into one. The
 * blank-line boundaries are the structure, so they are kept. Headings are
 * shifted so the shallowest sits one level under the post's own `##` heading
 * — a post written with `##` must not print as a sibling of the section it is.
 */
export function postBlocks(body: string | undefined): string[] {
  const blocks = String(body ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const levels = blocks
    .map((b) => /^(#{1,6})\s/.exec(b)?.[1]?.length ?? 0)
    .filter((n) => n > 0);
  const shift = levels.length ? Math.max(0, 3 - Math.min(...levels)) : 0;
  if (!shift) return blocks;
  return blocks.map((b) =>
    b.replace(/^(#{1,6})(\s)/, (_all, hashes: string, sp: string) =>
      '#'.repeat(Math.min(6, hashes.length + shift)) + sp));
}

/**
 * Point an edition's image references at the CDN copies the rehost made
 * (doc.image_map). The map lives on the document and is applied here, on
 * output, so the items — the source mirror — keep the source's own URLs.
 */
export function withRehostedImages(doc: IssueDoc, text: string): string {
  const map = doc.image_map;
  if (!map) return text;
  let out = text;
  for (const [from, to] of Object.entries(map)) if (from && to) out = out.split(from).join(to);
  return out;
}

/**
 * Drop the size a blog post's `<img>` tags carry. Micro.blog stores its
 * photos as `<img src width height alt>`, and the item mirrors that exactly
 * so write-back can hand it back. In an edition the size is wrong: the
 * email template and the site's stylesheet own image layout, and a fixed
 * width/height made WT350's Journal photos overflow in Mail (Jamie,
 * 2026-09-20). Every issue before the builder shipped `<img src alt>` only.
 * Applied on output, like the rehost map, so the source mirror is untouched.
 */
export function withPlainImages(text: string): string {
  // Walk the attributes in order so a quoted value that happens to contain
  // `height=` is never mistaken for the attribute.
  const attr = /\s+([A-Za-z][\w:-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  return text.replace(/<img\b([^>]*?)(\s*\/?)>/gi, (_tag, attrs: string, close: string) =>
    `<img${attrs.replace(attr, (whole, name: string) =>
      name.toLowerCase() === 'width' || name.toLowerCase() === 'height' ? '' : whole)}${close}>`);
}

/** What every edition does to its text on the way out: the CDN copies, the plain tags. */
export function finishEdition(doc: IssueDoc, text: string): string {
  return withPlainImages(withRehostedImages(doc, text));
}

/** Collapse a body to a single line for spoken output. */
export function flatten(body: string | undefined): string {
  return bodyLines(body).join(' ');
}
