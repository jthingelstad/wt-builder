/**
 * The Source lens.
 *
 * Not an edition — the structural view of the tree, showing what each item is,
 * where it came from, and which editions carry it. This is the lens that makes
 * per-channel inclusion legible.
 */

import type { Channel, IssueDoc, Item } from '../types.ts';
import { CHANNELS } from '../types.ts';
import { orderedNodes } from './plan.ts';

export interface SourceRow {
  itemId: string;
  nodeId: string;
  nodeLabel: string;
  type: string;
  authorship: string;
  source: string;
  channels: Record<Channel, boolean>;
  locked: Partial<Record<Channel, string>>;
  title: string;
  sync_state?: string;
  source_url?: string;
}

function displayTitle(item: Item): string {
  if (item.title) return item.title;
  if (item.label) return item.label;
  const body = String(item.body ?? '').replace(/\\n/g, ' ').trim();
  if (body) return body.length > 72 ? `${body.slice(0, 71)}…` : body;
  if (item.media?.caption) return item.media.caption;
  return '(empty)';
}

/** Every item in document order, including items in no edition at all. */
export function sourceRows(doc: IssueDoc): SourceRow[] {
  const rows: SourceRow[] = [];
  for (const node of orderedNodes(doc)) {
    for (const id of node.items) {
      const item = doc.items[id];
      if (!item) continue;
      rows.push({
        itemId: id,
        nodeId: node.id,
        nodeLabel: node.label,
        type: item.type,
        authorship: item.authorship,
        source: item.source,
        channels: { ...item.channels },
        locked: { ...(item.channel_locks ?? {}) },
        title: displayTitle(item),
        sync_state: item.sync_state,
        source_url: item.source_url,
      });
    }
  }
  return rows;
}

/** A plain-text rendering of the Source lens, for diffing and for tests. */
export function renderSource(doc: IssueDoc): string {
  const lines: string[] = [`# ${doc.issue.title} — source`, ''];
  let currentNode = '';
  for (const row of sourceRows(doc)) {
    if (row.nodeId !== currentNode) {
      currentNode = row.nodeId;
      lines.push(`## ${row.nodeLabel}  [${row.nodeId}]`);
    }
    const flags = CHANNELS.map((c) => {
      if (row.locked[c] !== undefined) return `${c[0]!.toUpperCase()}·locked`;
      return row.channels[c] ? c[0]!.toUpperCase() : '–';
    }).join(' ');
    lines.push(`- ${row.itemId} · ${row.type} · ${row.authorship}/${row.source} · [${flags}] · ${row.title}`);
  }
  return lines.join('\n') + '\n';
}
