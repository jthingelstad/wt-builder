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
/**
 * The one thing a reader can do about membership: the button, as every issue
 * before the builder had it. It goes to the members page with the reader's
 * email filled in and the issue as the ref; that page offers the year at $48
 * and nothing else is offered here (Jamie, 2026-09-20).
 */
export function membershipButton(issueNumber: number): string {
  return [
    '<p style="text-align:center; padding:10px 0; font-size: 16px; font-weight: bold;">',
    `<buttondown-button href="https://weekly.thingelstad.com/members/?email={{ subscriber.email | urlencode }}&ref=WT${issueNumber}">Become a Supporting Member</buttondown-button>`,
    '</p>',
  ].join('\n');
}

export function membershipBlocks(item: Item, issueNumber: number): Block[] {
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
    membershipButton(issueNumber),
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

function emailNodeBlocks(planned: PlannedNode, issueNumber: number): Block[] {
  if (planned.node.type !== 'membership' && planned.node.type !== 'echoes') return nodeBlocks(planned);

  const body: Block[] = [];
  for (const entry of planned.items) {
    body.push(...(planned.node.type === 'membership' ? membershipBlocks(entry.item, issueNumber) : echoesBlocks(entry.item)));
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
/**
 * The two other ways to take the issue, right under the intro: the page, and
 * the episode when the podcast has been sent (the podcast page otherwise).
 */
export function otherWaysLine(doc: IssueDoc): string {
  const n = doc.issue.number;
  const read = `[Read this issue online](https://weekly.thingelstad.com/archive/${n}/)`;
  const audio = doc.sends?.podcast?.status === 'sent' ? doc.sends.podcast.url : undefined;
  const listen = audio
    ? `[Listen to it](${audio})`
    : '[Listen to it](https://weekly.thingelstad.com/podcast/)';
  return `_${read} · ${listen}_`;
}

export function renderEmail(doc: IssueDoc): string {
  const sections: string[] = [];
  let ways = false;
  for (const planned of planEdition(doc, 'email')) {
    const blocks = emailNodeBlocks(planned, doc.issue.number).filter((b) => b.trim().length > 0);
    if (!blocks.length) continue;
    if (!ways && planned.node.type === 'intro') {
      blocks.push(otherWaysLine(doc));
      ways = true;
    }
    sections.push(blocks.join('\n\n'));
  }
  // An issue with no intro still offers the other ways, up top.
  if (!ways) sections.unshift(otherWaysLine(doc));
  return withRehostedImages(doc, sections.join('\n\n---\n\n') + '\n\n' + openPixel(doc) + '\n');
}

/**
 * The open count, as every issue before the builder carried it: Tinylytics'
 * anonymous 1×1 named for the issue (`/email/<N>/`), never for the reader —
 * the email medium only, so the Buttondown web archive does not fire it.
 * Restored 2026-09-20 ("I want the pixel in there like we had before").
 */
export const TINYLYTICS_SITE = 'a2YQr3ZMqkySNYSwz4uF';
export function openPixel(doc: IssueDoc): string {
  return [
    "{% if medium == 'email' %}",
    `<img src="https://tinylytics.app/pixel/${TINYLYTICS_SITE}.gif?path=/email/${doc.issue.number}/" alt="tinylytics" style="width:1px;height:1px;border:0;" />`,
    '{% endif %}',
  ].join('\n');
}
