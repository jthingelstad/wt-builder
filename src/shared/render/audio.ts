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
import { speakable } from './speech.ts';

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
  const t = speakable(text).trim();
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
  const commentary = terminate(speakable(flatten(item.commentary)));
  const spoken = [`Link ${index} of ${total}.`, title, commentary]
    .filter((p) => p.length > 0)
    .join(' ');
  return spoken;
}

function itemBlocks(item: Item, planned: PlannedNode, index: number, total: number): SpokenBlock[] {
  switch (item.type) {
    case 'currently': {
      // A label with no value is a half-written entry, not a spoken line.
      const value = speakable(flatten(item.body));
      return value ? [`${item.label}: ${value}`] : [];
    }
    case 'haiku':
      // One line per block, so the pauses fall where the line breaks are.
      return bodyLines(item.body).map(speakable).filter(Boolean);
    case 'pinboard_link':
      return isLinkSection(planned.node)
        ? [linkBlock(item, index, total)]
        : [terminate(flatten(item.commentary) || String(item.title ?? ''))];
    default:
      return [speakable(flatten(item.body))].filter(Boolean);
  }
}

/**
 * One block of the script, tagged with what it is.
 *
 * The Audio lens renders these rather than re-deriving the script, so what
 * Jamie reads on screen is the text that will actually be synthesized. A lens
 * that built its own version of the script could drift from the mp3.
 */
export interface ScriptBlock {
  kind: 'open' | 'transition' | 'cue' | 'close';
  text: string;
  /** The node this block came from, for the lens's anchors. */
  nodeId?: string;
  itemId?: string;
}

export function audioScript(doc: IssueDoc): ScriptBlock[] {
  const script: ScriptBlock[] = [
    { kind: 'open', text: opening(doc.issue.number) },
  ];

  for (const planned of planEdition(doc, 'audio')) {
    const total = planned.items.length;
    const spoken: ScriptBlock[] = [];

    if (planned.groups) {
      for (const group of planned.groups) {
        const groupBlocks: ScriptBlock[] = [];
        for (const entry of group.items) {
          for (const text of itemBlocks(entry.item, planned, 0, total)) {
            groupBlocks.push({ kind: 'cue', text, nodeId: planned.node.id, itemId: entry.id });
          }
        }
        if (!groupBlocks.length) continue;
        if (group.weekday) {
          spoken.push({ kind: 'cue', text: terminate(group.weekday), nodeId: planned.node.id });
        }
        spoken.push(...groupBlocks);
      }
    } else {
      planned.items.forEach((entry, i) => {
        for (const text of itemBlocks(entry.item, planned, i + 1, total)) {
          spoken.push({ kind: 'cue', text, nodeId: planned.node.id, itemId: entry.id });
        }
      });
    }

    if (!spoken.length) continue;

    const transition = transitionFor(planned);
    if (transition) script.push({ kind: 'transition', text: transition, nodeId: planned.node.id });
    script.push(...spoken);
  }

  script.push({ kind: 'close', text: CLOSING });
  return script.filter((b) => b.text.trim().length > 0);
}

export function renderAudio(doc: IssueDoc): string {
  const blocks: SpokenBlock[] = [opening(doc.issue.number)];

  for (const planned of planEdition(doc, 'audio')) {
    const total = planned.items.length;
    const spoken: SpokenBlock[] = [];

    if (planned.groups) {
      for (const group of planned.groups) {
        // Journal groups speak the weekday alone, matching print.
        const groupBlocks: SpokenBlock[] = [];
        for (const entry of group.items) {
          groupBlocks.push(...itemBlocks(entry.item, planned, 0, total));
        }
        if (!groupBlocks.length) continue;
        if (group.weekday) spoken.push(terminate(group.weekday));
        spoken.push(...groupBlocks);
      }
    } else {
      planned.items.forEach((entry, i) => {
        spoken.push(...itemBlocks(entry.item, planned, i + 1, total));
      });
    }

    // A section transition announces content. With nothing behind it, the
    // listener is promised a section that never arrives.
    if (!spoken.length) continue;

    const transition = transitionFor(planned);
    if (transition) blocks.push(transition);
    blocks.push(...spoken);
  }

  blocks.push(CLOSING);
  return blocks.filter((b) => b.trim().length > 0).join('\n\n') + '\n';
}

/** Spoken date form, used by the podcast description rather than the script. */
export function spokenDate(iso: string): string {
  const w = wallClock(iso);
  return w ? `${weekday(w)}` : '';
}
