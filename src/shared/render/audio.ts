/**
 * The audio edition.
 *
 * Every word in the script is spoken. Section transitions are script lines, not
 * markers — a line that appears here and is not read aloud is a bug
 * (docs/rendering-contracts.md, Audio).
 */

import type { IssueDoc, Item } from '../types.ts';
import { wallClock, weekday } from '../dates.ts';
import type { PlannedNode } from './plan.ts';
import { bodyLines, flatten, isLinkSection, planEdition } from './plan.ts';

/** One spoken block. Blocks are separated by a blank line, which is a pause. */
export type SpokenBlock = string;

export function opening(issueNumber: number): SpokenBlock {
  return `You're listening to an AI-generated audio version of The Weekly Thing, issue ${issueNumber}.`;
}

export const CLOSING = 'That brings us to the end of The Weekly Thing.';

export const HAIKU_TRANSITION = "And to close, this week's haiku.";

/** Membership is spoken, introduced as Thingy's words before the words themselves. */
export const MEMBERSHIP_TRANSITION =
  'Next, a word about membership. This part was written by Thingy, the assistant that helps with the Weekly Thing.';

/** Add a full stop unless the text already ends in terminal punctuation. */
export function terminate(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * The spoken transition into a node, or null where the content carries itself.
 * Intro, Outro, and Markdown blocks simply continue.
 */
export function transitionFor(planned: PlannedNode): SpokenBlock | null {
  const { node, items } = planned;

  if (node.type === 'haiku') return HAIKU_TRANSITION;
  if (node.type === 'membership') return MEMBERSHIP_TRANSITION;

  if (node.kind === 'promoted_item') {
    const title = items[0]?.item.title ?? node.label;
    return terminate(title);
  }

  if (node.publishes_heading) return `Now, the ${node.label} section.`;
  return null;
}

/** "Link 1 of 5. Title. Commentary." — the count is of items in this edition. */
export function linkBlock(item: Item, index: number, total: number): SpokenBlock {
  const title = terminate(String(item.title ?? ''));
  const commentary = terminate(flatten(item.commentary));
  const spoken = [`Link ${index} of ${total}.`, title, commentary]
    .filter((p) => p.length > 0)
    .join(' ');
  return spoken;
}

function itemBlocks(item: Item, planned: PlannedNode, index: number, total: number): SpokenBlock[] {
  switch (item.type) {
    case 'currently':
      return [`${item.label}: ${flatten(item.body)}`];
    case 'haiku':
      // One line per block, so the pauses fall where the line breaks are.
      return bodyLines(item.body);
    case 'pinboard_link':
      return isLinkSection(planned.node)
        ? [linkBlock(item, index, total)]
        : [terminate(flatten(item.commentary) || String(item.title ?? ''))];
    case 'quote':
      return [flatten(item.body)];
    default:
      return [flatten(item.body)];
  }
}

export function renderAudio(doc: IssueDoc): string {
  const blocks: SpokenBlock[] = [opening(doc.issue.number)];

  for (const planned of planEdition(doc, 'audio')) {
    const transition = transitionFor(planned);
    if (transition) blocks.push(transition);

    const total = planned.items.length;

    if (planned.groups) {
      for (const group of planned.groups) {
        // Journal groups speak the weekday alone, matching print.
        if (group.weekday) blocks.push(terminate(group.weekday));
        for (const entry of group.items) {
          blocks.push(...itemBlocks(entry.item, planned, 0, total));
        }
      }
      continue;
    }

    planned.items.forEach((entry, i) => {
      blocks.push(...itemBlocks(entry.item, planned, i + 1, total));
    });
  }

  blocks.push(CLOSING);
  return blocks.filter((b) => b.trim().length > 0).join('\n\n') + '\n';
}

/** Spoken date form, used by the podcast description rather than the script. */
export function spokenDate(iso: string): string {
  const w = wallClock(iso);
  return w ? `${weekday(w)}` : '';
}
