/**
 * The Buttondown edition.
 *
 * The email is the website edition plus subscriber branching, not a different
 * document. Only this renderer knows about Liquid; the item carries one body.
 */

import type { IssueDoc, Item } from '../types.ts';
import { markdownToSafeHtml } from '../markdown.ts';
import type { Block } from './website.ts';
import { THINGY_LABEL, THINGY_ROLE, THINGY_URL, byline, nodeBlocks, nodeHeading } from './website.ts';
import type { PlannedNode } from './plan.ts';
import { bodyLines, planEdition, postBlocks, withRehostedImages } from './plan.ts';

export const PREMIUM_CONDITION = "subscriber.subscriber_type == 'premium'";

/** Appended for subscribers who are already Supporting Members. */
export const MEMBER_THANKS = 'Thank you for being one.';

/**
 * Thingy's frame for email: one HTML block with inline styles (mail clients
 * keep those and little else) and the body rendered to HTML inside it, so no
 * mail-side Markdown parser has to look inside a div. Liquid passes through
 * untouched — Buttondown resolves it before the HTML is sent.
 */
const FRAME_STYLE = [
  'margin:0 0 1.6em', 'padding:14px 18px', 'border-left:3px solid #2f7d4f',
  'background:#f5f8f6', 'border-radius:0 8px 8px 0',
  "font-family:Georgia,'Source Serif 4','Times New Roman',serif", 'color:#1a1a1a',
].join(';');
const LABEL_STYLE = [
  "font-family:ui-monospace,Menlo,Consolas,monospace", 'font-size:12px', 'letter-spacing:.05em',
  'text-transform:uppercase', 'color:#5f6b63', 'margin:0 0 8px',
].join(';');
const LINK_STYLE = 'color:#2f7d4f;text-decoration:none;font-weight:600';

export function thingyEmailFrame(inner: string[]): Block {
  return [
    `<div class="from-thingy" style="${FRAME_STYLE}">`,
    `<p style="${LABEL_STYLE}"><a href="${THINGY_URL}" style="${LINK_STYLE}">${THINGY_LABEL}</a>, ${THINGY_ROLE}</p>`,
    ...inner,
    '</div>',
  ].join('\n');
}

const html = (markdown: string | undefined) => markdownToSafeHtml(postBlocks(markdown).join('\n\n'));

/**
 * Membership, wrapped in subscriber branching inside Thingy's frame, so the
 * attribution survives either path.
 */
export function membershipBlocks(item: Item): Block[] {
  const body = bodyLines(item.body).join(' ');
  if (!body) return [];

  // A drafted thank-you stands alone for existing members; without one,
  // the historical form - the invitation with the static line appended.
  const thanks = String(item.member_thanks ?? '').trim() || `${body} ${MEMBER_THANKS}`;
  const branch = [
    `{% if ${PREMIUM_CONDITION} %}`,
    html(thanks),
    '{% else %}',
    html(item.body),
    '{% endif %}',
  ];
  return item.authorship === 'Thingy' ? [thingyEmailFrame(branch)] : [byline(item), ...branch];
}

/** Echoes in email: the same frame, no branch. */
export function echoesBlocks(item: Item): Block[] {
  const body = bodyLines(item.body).join(' ');
  if (!body) return [];
  return item.authorship === 'Thingy' ? [thingyEmailFrame([html(item.body)])] : [byline(item), ...postBlocks(item.body)];
}

function emailNodeBlocks(planned: PlannedNode): Block[] {
  if (planned.node.type !== 'membership' && planned.node.type !== 'echoes') return nodeBlocks(planned);

  const body: Block[] = [];
  for (const entry of planned.items) {
    body.push(...(planned.node.type === 'membership' ? membershipBlocks(entry.item) : echoesBlocks(entry.item)));
  }
  if (!body.some((b) => b.trim())) return [];
  const heading = nodeHeading(planned);
  return heading ? [heading, ...body] : body;
}

/**
 * The email's shape, matched to the issues Jamie sent before the builder
 * (WT349 compared side by side, 2026-09-20): no title in the body — the
 * subject carries it and Buttondown prints it — and a rule between sections.
 */
export function renderEmail(doc: IssueDoc): string {
  const sections: string[] = [];
  for (const planned of planEdition(doc, 'email')) {
    const blocks = emailNodeBlocks(planned).filter((b) => b.trim().length > 0);
    if (blocks.length) sections.push(blocks.join('\n\n'));
  }
  return withRehostedImages(doc, sections.join('\n\n---\n\n') + '\n');
}
