/**
 * The website edition.
 *
 * Rendered per item type from the canonical tree — never by converting one
 * flattened Markdown document (AGENTS.md, Guardrails).
 */

import type { IssueDoc, Item } from '../types.ts';
import { clockTime, shortDate, wallClock, weekday } from '../dates.ts';
import type { PlannedItem, PlannedNode } from './plan.ts';
import { bodyLines, planEdition } from './plan.ts';

/** Blocks are joined by a blank line; a block is one Markdown paragraph. */
export type Block = string;

export function byline(item: Item): string {
  return `_By ${item.attribution ?? item.authorship}_`;
}

/** "![alt](url)", caption, and the metadata line, in that order. */
export function photoBlocks(item: Item): Block[] {
  const out: Block[] = [];
  const media = item.media;
  if (!media) return out;

  if (media.url) out.push(`![${media.alt ?? ''}](${media.url})`);
  if (media.caption) out.push(media.caption);

  const parts: string[] = [];
  const w = wallClock(media.timestamp);
  if (w) {
    parts.push(shortDate(w));
    parts.push(clockTime(w));
  }
  if (media.location) parts.push(media.location);
  if (parts.length) out.push(`_${parts.join(' · ')}_`);

  return out;
}

/** Haiku prints as one bold block with Markdown hard breaks between lines. */
export function haikuBlock(item: Item): Block {
  return `**${bodyLines(item.body).join('  \n')}**`;
}

/** "Description → **[linked title]**" (docs/rendering-contracts.md, Briefly). */
export function brieflyBlock(item: Item): Block {
  const link = `**[${item.title ?? item.source_url}](${item.source_url})**`;
  const commentary = String(item.commentary ?? '').trim();
  return commentary ? `${commentary} → ${link}` : link;
}

/** A Notable/Featured link: a linked heading, then commentary if there is any. */
export function linkBlocks(item: Item): Block[] {
  const out: Block[] = [`### [${item.title ?? item.source_url}](${item.source_url})`];
  const commentary = String(item.commentary ?? '').trim();
  if (commentary) out.push(commentary);
  return out;
}

/** An ordinary Journal entry: a linked timestamp, then the post. */
export function journalEntryBlock(item: Item): Block {
  const w = wallClock(item.published_at);
  const time = w ? clockTime(w) : '';
  const body = bodyLines(item.body).join(' ');
  if (!time || !item.source_url) return body;
  return `[${time}](${item.source_url}) — ${body}`;
}

/** A promoted post prints its weekday and time beneath its own heading. */
export function promotedBlocks(item: Item): Block[] {
  const out: Block[] = [];
  const w = wallClock(item.published_at);
  if (w) out.push(`_${weekday(w)} · ${clockTime(w)}_`);
  const body = bodyLines(item.body).join(' ');
  if (body) out.push(body);
  return out;
}

function itemBlocks(entry: PlannedItem): Block[] {
  const { item } = entry;
  switch (item.type) {
    case 'currently':
      return [`**${item.label}:** ${bodyLines(item.body).join(' ')}`];
    case 'photo':
      return photoBlocks(item);
    case 'haiku':
      return [haikuBlock(item)];
    case 'pinboard_link':
      return item.section?.toLowerCase() === 'briefly'
        ? [brieflyBlock(item)]
        : linkBlocks(item);
    case 'journal_post':
      return item.presentation === 'promoted'
        ? promotedBlocks(item)
        : [journalEntryBlock(item)];
    case 'membership':
    case 'echoes':
      return [byline(item), bodyLines(item.body).join(' ')];
    case 'quote':
      return bodyLines(item.body).map((l) => `> ${l}`);
    default:
      return [bodyLines(item.body).join(' ')];
  }
}

/**
 * The heading a node prints, if it prints one. Photo, Haiku, and Membership
 * carry themselves; their names live in the builder's gutter, not the page.
 */
export function nodeHeading(planned: PlannedNode): string | null {
  const { node, items } = planned;
  if (!node.publishes_heading) return null;
  if (node.kind === 'promoted_item') {
    const title = items[0]?.item.title ?? node.label;
    return `## ${title}`;
  }
  return `## ${node.label}`;
}

/** Blocks for one node, used by the website and email editions alike. */
export function nodeBlocks(planned: PlannedNode): Block[] {
  const out: Block[] = [];
  const heading = nodeHeading(planned);
  if (heading) out.push(heading);

  if (planned.groups) {
    for (const group of planned.groups) {
      if (group.weekday) out.push(`### ${group.weekday}`);
      for (const entry of group.items) out.push(...itemBlocks(entry));
    }
    return out;
  }

  for (const entry of planned.items) out.push(...itemBlocks(entry));
  return out;
}

export function renderWebsite(doc: IssueDoc): string {
  const blocks: Block[] = [`# ${doc.issue.title}`];
  for (const planned of planEdition(doc, 'website')) {
    blocks.push(...nodeBlocks(planned));
  }
  return blocks.filter((b) => b.trim().length > 0).join('\n\n') + '\n';
}
