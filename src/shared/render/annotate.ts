/**
 * The rendered edition with item ids attached.
 *
 * The reviewer should read what a reader reads — the rendered edition, not the
 * raw item tree — and the ids are what let a note point at something
 * (docs/service-contracts.md).
 */

import type { Channel, IssueDoc } from '../types.ts';
import { planEdition } from './plan.ts';
import { nodeBlocks, nodeHeading } from './website.ts';

/** One `<!--item:ID-->` marker before each item's blocks. */
export function renderAnnotated(doc: IssueDoc, channel: Channel = 'website'): string {
  const out: string[] = [`# ${doc.issue.title}`];

  for (const planned of planEdition(doc, channel)) {
    const heading = nodeHeading(planned);
    if (heading) out.push(heading);

    if (planned.groups) {
      for (const group of planned.groups) {
        if (group.weekday) out.push(`### ${group.weekday}`);
        for (const entry of group.items) {
          out.push(`<!--item:${entry.id}-->`);
          out.push(...blocksForItem(planned, entry.id));
        }
      }
      continue;
    }

    for (const entry of planned.items) {
      out.push(`<!--item:${entry.id}-->`);
      out.push(...blocksForItem(planned, entry.id));
    }
  }

  return out.filter((b) => b.trim().length > 0).join('\n\n') + '\n';
}

/** Render one item by planning a node that contains only it. */
function blocksForItem(planned: Parameters<typeof nodeBlocks>[0], itemId: string): string[] {
  const entry = planned.items.find((i) => i.id === itemId);
  if (!entry) return [];
  const solo = {
    node: { ...planned.node, publishes_heading: false },
    items: [entry],
  };
  return nodeBlocks(solo);
}
