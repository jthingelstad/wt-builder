/**
 * Resolving an issue document into an ordered edition for one channel.
 *
 * All three renderers plan from here so ordering, channel filtering, and
 * Journal date grouping cannot drift between the editions.
 */

import type { Channel, IssueDoc, IssueNode, Item } from '../types.ts';
import { inChannel } from '../types.ts';
import { wallClock, weekday } from '../dates.ts';

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

  for (const node of orderedNodes(doc)) {
    const items: PlannedItem[] = [];
    for (const id of node.items) {
      const item = doc.items[id];
      if (!item) continue;
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

/** Collapse a body to a single line for spoken output. */
export function flatten(body: string | undefined): string {
  return bodyLines(body).join(' ');
}
