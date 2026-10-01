/**
 * The website edition.
 *
 * Rendered per item type from the canonical tree — never by converting one
 * flattened Markdown document (AGENTS.md, Guardrails).
 */

import type { IssueDoc, IssueNode, Item } from '../types.ts';
import { clockTime, shortDate, wallClock } from '../dates.ts';
import { splitBody } from '../body.ts';
import { echoBlocks } from '../echoes.ts';
import { linkUrl } from '../links.ts';
import type { PlannedItem, PlannedNode } from './plan.ts';
import { bodyLines, planEdition, postBlocks, finishEdition, quoteMarkdown } from './plan.ts';

/** Blocks are joined by a blank line; a block is one Markdown paragraph. */
export type Block = string;

/**
 * Text that came from somewhere else — a bookmark's title, a photo's alt
 * text and place — printed as the words it is, never as markup.
 * "Styling the <textarea> element" opened a text box that swallowed the rest
 * of the issue, on the site and in the email, and an unbalanced `]` ends a
 * link early (review 2026-09-27 §3). The Markdown link and emphasis
 * characters are backslash-escaped and `<` `>` become entities. Jamie's own
 * commentary and bodies are Markdown he wrote, and never pass through here.
 */
export function escapeExternal(text: string): string {
  return text
    .replace(/[\\[\]*_`]/g, (c) => `\\${c}`)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

  if (media.url) out.push(`![${escapeAlt(media.alt ?? '')}](${media.url})`);
  if (media.caption) out.push(media.caption);

  const parts: string[] = [];
  // The date, not the time of day: the photo is placed in the week, not the hour (2026-09-20).
  const w = wallClock(media.timestamp);
  if (w) parts.push(shortDate(w));
  if (media.location) {
    // The place name links to the exact coordinates when the camera knew them.
    const map = osmUrl(media.coordinates);
    const place = escapeExternal(media.location);
    parts.push(map ? `[${place}](${map})` : place);
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

/**
 * Alt text, inside `![…]`. markdown-it writes an image's alt from its plain
 * text only and drops every escape and entity, so escaping the way
 * `escapeExternal` does turned "snake_case" into "snakecase" and removed a
 * `<` outright. Only what would end the label early is escaped: a bracket
 * with no partner, and a backslash (which markdown-it drops from alt either
 * way, escaped or not). Line breaks fold to spaces, so a blank line cannot
 * split the image into a paragraph of raw text. A `<b>` stays as written —
 * inside an image it can only ever be alt text — and emphasis marks read as
 * emphasis.
 */
export function escapeAlt(raw: string): string {
  const text = raw.replace(/\s+/g, ' ');
  const unmatched = new Set<number>();
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') open.push(i);
    else if (text[i] === ']') {
      if (open.length) open.pop();
      else unmatched.add(i);
    }
  }
  for (const i of open) unmatched.add(i);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    out += c === BACKSLASH || unmatched.has(i) ? BACKSLASH + c : c;
  }
  return out;
}

const BACKSLASH = String.fromCharCode(92);

/** "Description → **[linked title]**" (docs/rendering-contracts.md, Briefly). */
export function brieflyBlock(item: Item): Block {
  const link = `**[${escapeExternal(item.title ?? linkUrl(item) ?? '')}](${linkUrl(item)})**`;
  const commentary = String(item.commentary ?? '').trim();
  return commentary ? `${commentary} → ${link}` : link;
}

/** A Notable/Featured link: a linked heading, then commentary if there is any. */
export function linkBlocks(item: Item): Block[] {
  const out: Block[] = [`### [${escapeExternal(item.title ?? linkUrl(item) ?? '')}](${linkUrl(item)})`];
  const commentary = String(item.commentary ?? '').trim();
  if (commentary) out.push(commentary);
  return out;
}

/** What opens a quote, a list, a heading, or a fence. */
const OPENS_STRUCTURE = /^\s*(?:>|[-*+]\s|\d{1,9}[.)]\s|#{1,6}\s|```|~~~)/;
/**
 * The same, part way down a paragraph. CommonMark lets a numbered list
 * interrupt a paragraph only when it starts at 1, so "2026. What a year"
 * on its second line is still prose.
 */
const INTERRUPTS_PROSE = /^\s*(?:>|[-*+]\s|1[.)]\s|#{1,6}\s|```|~~~)/;

/** Prose and nothing else: the only kind of block a lead can be welded onto. */
function plainProse(block: string): boolean {
  const [first = '', ...rest] = block.split('\n');
  return !OPENS_STRUCTURE.test(first) && !rest.some((line) => INTERRUPTS_PROSE.test(line));
}

/**
 * An ordinary Journal entry: a linked lead, then the post, then its photos.
 * The lead is the post's title when it has one — a titled post that stays in
 * the Journal keeps its name (2026-09-20) — and the time of day otherwise.
 *
 * A Journal moment is a sentence or two and flattens to one line. A post with
 * more structure than that — a list, several paragraphs, a quote — keeps it:
 * the lead carries the first paragraph and the rest prints as written
 * (WT351's "Podcast Improvements" post, 2026-09-21, whose bullets had been
 * welded onto one line as "- one - two - three").
 *
 * The lead is welded onto the first block only when that block is plain
 * prose. A post that opens with a quote, a list, a heading, or a lead-in line
 * with its list straight under it gets the lead on a line of its own, then
 * the post as written; one with no words at all gets no dash ("10:54 AM — >
 * quote", review 2026-09-27 §3). Its headings sit below the day's `###`.
 *
 * A Micro.blog photo post is prose then its `<img>` tags. Each image prints
 * as a block of its own, the way nine years of archive issues lay them out.
 * Welding the tags onto the sentence (WT350) put the pictures inside the
 * paragraph, where they lost their left edge.
 */
export function journalEntryBlocks(item: Item): Block[] {
  const w = wallClock(item.published_at);
  const title = String(item.title ?? '').trim();
  const { prose, tail } = splitBody(item.body);
  const blocks = postBlocks(prose, 4);
  const weld = blocks.length > 0 && plainProse(blocks[0]!);
  const [first = '', ...rest] = weld ? blocks : ['', ...blocks];
  const body = bodyLines(first).join(' ');
  const images = tail.match(/<img\b[^>]*>/gi) ?? [];
  const link = (() => {
    if (!item.source_url) return '';
    // A title is bold, like a Briefly title; a time of day is not.
    if (title) return `**[${escapeExternal(title)}](${item.source_url})**`;
    return w ? `[${clockTime(w)}](${item.source_url})` : '';
  })();
  const lead = link && body ? `${link} — ${body}` : link || body;
  return [lead, ...rest, ...images].filter(Boolean);
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

function itemBlocks(entry: PlannedItem, node?: IssueNode, issueNumber?: number): Block[] {
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
        : journalEntryBlocks(item);
    case 'membership':
    case 'echoes':
      // Attribution with no words under it is an unwritten item, not a credit.
      return attributed(item, postBlocks(item.body));
    case 'echo':
      // On its own (outside an Echoes node) an echo still carries its frame.
      return attributed(item, echoBlocks(item, issueNumber));
    case 'quote':
      return [quoteMarkdown(item)];
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
    // A blank title is a missing one: '' is not null, and a cleared Title
    // printed a bare "## " (review 2026-09-27 round 2).
    const title = items[0]?.item.title;
    return `## ${title?.trim() ? escapeExternal(title) : node.label}`;
  }
  return `## ${node.label}`;
}

/**
 * The inside of Echoes: each echo as its thread and its door, or — for an
 * issue from before echoes were items (WT350 and earlier) — the one body as
 * it was written. Both shapes render; nothing was migrated.
 */
export function echoesInner(planned: PlannedNode, issueNumber?: number): Block[] {
  return planned.items.flatMap(({ item }) =>
    item.type === 'echo' ? echoBlocks(item, issueNumber) : postBlocks(item.body));
}

/**
 * Echoes is one frame around every echo — the section is Thingy's, not each
 * line — so the items are gathered first and attributed once.
 */
function echoesBlocks(planned: PlannedNode, issueNumber?: number): Block[] {
  const inner = echoesInner(planned, issueNumber).filter((b) => b.trim());
  const first = planned.items[0]?.item;
  if (!inner.length || !first) return [];
  return attributed(first, inner);
}

/**
 * Blocks for one node, used by the website and email editions alike. The
 * issue number is what the echoes' Ask-Thingy links attribute themselves to.
 */
export function nodeBlocks(planned: PlannedNode, issueNumber?: number): Block[] {
  const body: Block[] = [];
  const { node } = planned;

  if (planned.groups) {
    for (const group of planned.groups) {
      const items = group.items.flatMap((entry) => itemBlocks(entry, node)).filter((b) => b.trim());
      if (!items.length) continue;
      if (group.weekday) body.push(`### ${group.weekday}`);
      body.push(...items);
    }
  } else if (node.type === 'echoes') {
    body.push(...echoesBlocks(planned, issueNumber));
  } else {
    for (const entry of planned.items) body.push(...itemBlocks(entry, node, issueNumber));
  }

  // A heading over nothing is an unwritten section, not a section: an empty
  // Echoes printed "## Echoes" and stopped (WT350 dry run, 2026-09-20).
  if (!body.some((b) => b.trim())) return [];
  const heading = nodeHeading(planned);
  return heading ? [heading, ...body] : body;
}

export function renderWebsite(doc: IssueDoc): string {
  const blocks: Block[] = [`# ${doc.issue.title}`];
  for (const planned of planEdition(doc, 'website')) {
    blocks.push(...nodeBlocks(planned, doc.issue.number));
  }
  return finishEdition(doc, blocks.filter((b) => b.trim().length > 0).join('\n\n') + '\n');
}
