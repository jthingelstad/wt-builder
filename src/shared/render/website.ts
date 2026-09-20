/**
 * The website edition.
 *
 * Rendered per item type from the canonical tree — never by converting one
 * flattened Markdown document (AGENTS.md, Guardrails).
 */

import type { IssueDoc, IssueNode, Item } from '../types.ts';
import { clockTime, shortDate, wallClock } from '../dates.ts';
import type { PlannedItem, PlannedNode } from './plan.ts';
import { bodyLines, planEdition, postBlocks } from './plan.ts';

/** Blocks are joined by a blank line; a block is one Markdown paragraph. */
export type Block = string;

export function byline(item: Item): string {
  return `_By ${item.attribution ?? item.authorship}_`;
}

// ── Thingy's frame ────────────────────────────────────────────────────────
//
// Thingy is Jamie's sidekick, showing up in the content from time to time.
// It identifies itself the same way everywhere and differently per channel:
// a labelled block set in the site's serif on the web, an inline-styled
// block in email, its own voice in audio (docs/rendering-contracts.md,
// Thingy attribution; Jamie, 2026-09-20). The label links to Thingy's own
// site, and the byline reads "From Thingy, my agentic librarian".

export const THINGY_URL = 'https://thingy.thingelstad.com';
export const THINGY_LABEL = 'From Thingy';
export const THINGY_ROLE = 'my agentic librarian';

/**
 * The website frame: an HTML block the site styles (`.from-thingy` in
 * weekly.thingelstad.com's stylesheet), with Markdown inside. Each piece is
 * its own block so the blank lines between them let markdown-it treat the
 * div and label as raw HTML and the body as Markdown.
 */
export function thingyFrame(body: Block[]): Block[] {
  if (!body.length) return [];
  return [
    '<div class="from-thingy">',
    `<p class="from-thingy-label"><a href="${THINGY_URL}">${THINGY_LABEL}</a>, ${THINGY_ROLE}</p>`,
    ...body,
    '</div>',
  ];
}

/** Attribution for a Membership or Echoes body: Thingy's frame, or a plain byline. */
export function attributed(item: Item, body: Block[]): Block[] {
  if (!body.length) return [];
  return item.authorship === 'Thingy' ? thingyFrame(body) : [byline(item), ...body];
}

/**
 * The exact spot on OpenStreetMap, or null when the string is not "lat, lon".
 * OSM is where the place name came from (integrations/geocode.ts), so it is
 * also where the name links back to.
 */
export function osmUrl(coordinates: string | undefined): string | null {
  const m = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(String(coordinates ?? '').trim());
  if (!m) return null;
  return `https://www.openstreetmap.org/?mlat=${m[1]}&mlon=${m[2]}#map=16/${m[1]}/${m[2]}`;
}

/** "![alt](url)", caption, and the metadata line, in that order. */
export function photoBlocks(item: Item): Block[] {
  const out: Block[] = [];
  const media = item.media;
  if (!media) return out;

  if (media.url) out.push(`![${media.alt ?? ''}](${media.url})`);
  if (media.caption) out.push(media.caption);

  const parts: string[] = [];
  // The date, not the time of day: the photo is placed in the week, not the hour (2026-09-20).
  const w = wallClock(media.timestamp);
  if (w) parts.push(shortDate(w));
  if (media.location) {
    // The place name links to the exact coordinates when the camera knew them.
    const map = osmUrl(media.coordinates);
    parts.push(map ? `[${media.location}](${map})` : media.location);
  }
  if (parts.length) out.push(`_${parts.join(' · ')}_`);

  return out;
}

/** Haiku prints as one bold block with Markdown hard breaks between lines. */
export function haikuBlock(item: Item): Block {
  const lines = bodyLines(item.body);
  // An unwritten haiku would otherwise publish a bare "****".
  if (!lines.length) return '';
  return `**${lines.join('  \n')}**`;
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

/**
 * An ordinary Journal entry: a linked lead, then the post. The lead is the
 * post's title when it has one — a titled post that stays in the Journal
 * keeps its name (2026-09-20) — and the time of day otherwise.
 */
export function journalEntryBlock(item: Item): Block {
  const w = wallClock(item.published_at);
  const title = String(item.title ?? '').trim();
  const body = bodyLines(item.body).join(' ');
  if (!item.source_url) return body;
  // A title is bold, like a Briefly title; a time of day is not.
  if (title) return `**[${title}](${item.source_url})** — ${body}`;
  return w ? `[${clockTime(w)}](${item.source_url}) — ${body}` : body;
}

/**
 * A promoted post is a section of its own: its title is the heading and its
 * body prints whole. It carries no clock — the time belongs to the Journal
 * moment it stopped being.
 */
export function promotedBlocks(item: Item): Block[] {
  return postBlocks(item.body);
}

/**
 * Which section an item renders as. Placement wins over the tag the item was
 * captured with: a Pinboard link filed under Briefly renders as Briefly even
 * if it was tagged for Notable, or tagged not at all.
 */
function sectionOf(item: Item, node?: IssueNode): string {
  return (node?.label ?? item.section ?? '').toLowerCase();
}

function itemBlocks(entry: PlannedItem, node?: IssueNode): Block[] {
  const { item } = entry;
  switch (item.type) {
    case 'currently': {
      const value = bodyLines(item.body).join(' ');
      return value ? [`**${item.label}:** ${value}`] : [];
    }
    case 'photo':
      return photoBlocks(item);
    case 'haiku':
      return [haikuBlock(item)];
    case 'pinboard_link':
      return sectionOf(item, node) === 'briefly' ? [brieflyBlock(item)] : linkBlocks(item);
    case 'journal_post':
      return item.presentation === 'promoted'
        ? promotedBlocks(item)
        : [journalEntryBlock(item)];
    case 'membership':
    case 'echoes':
      // Attribution with no words under it is an unwritten item, not a credit.
      return attributed(item, postBlocks(item.body));
    case 'quote':
      return bodyLines(item.body).map((l) => `> ${l}`);
    default:
      // Intro, outro, Markdown blocks: prose keeps its paragraphs.
      return postBlocks(item.body);
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
  const { node } = planned;
  const heading = nodeHeading(planned);
  if (heading) out.push(heading);

  if (planned.groups) {
    for (const group of planned.groups) {
      if (group.weekday) out.push(`### ${group.weekday}`);
      for (const entry of group.items) out.push(...itemBlocks(entry, node));
    }
    return out;
  }

  for (const entry of planned.items) out.push(...itemBlocks(entry, node));
  return out;
}

export function renderWebsite(doc: IssueDoc): string {
  const blocks: Block[] = [`# ${doc.issue.title}`];
  for (const planned of planEdition(doc, 'website')) {
    blocks.push(...nodeBlocks(planned));
  }
  return blocks.filter((b) => b.trim().length > 0).join('\n\n') + '\n';
}
