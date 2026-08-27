/**
 * The Buttondown edition.
 *
 * The email is the website edition plus subscriber branching, not a different
 * document. Only this renderer knows about Liquid; the item carries one body.
 */

import type { IssueDoc, Item } from '../types.ts';
import type { Block } from './website.ts';
import { byline, nodeBlocks, nodeHeading } from './website.ts';
import type { PlannedNode } from './plan.ts';
import { bodyLines, planEdition } from './plan.ts';

export const PREMIUM_CONDITION = "subscriber.subscriber_type == 'premium'";

/** Appended for subscribers who are already Supporting Members. */
export const MEMBER_THANKS = 'Thank you for being one.';

/**
 * Membership, wrapped in subscriber branching. The byline sits outside the
 * branch so attribution survives either path.
 */
export function membershipBlocks(item: Item): Block[] {
  const body = bodyLines(item.body).join(' ');
  if (!body) return [byline(item)];

  const thanks = `${body} ${MEMBER_THANKS}`;
  return [
    byline(item),
    `{% if ${PREMIUM_CONDITION} %}`,
    thanks,
    '{% else %}',
    body,
    '{% endif %}',
  ];
}

function emailNodeBlocks(planned: PlannedNode): Block[] {
  if (planned.node.type !== 'membership') return nodeBlocks(planned);

  const out: Block[] = [];
  const heading = nodeHeading(planned);
  if (heading) out.push(heading);
  for (const entry of planned.items) out.push(...membershipBlocks(entry.item));
  return out;
}

export function renderEmail(doc: IssueDoc): string {
  const blocks: Block[] = [`# ${doc.issue.title}`];
  for (const planned of planEdition(doc, 'email')) {
    blocks.push(...emailNodeBlocks(planned));
  }
  return blocks.filter((b) => b.trim().length > 0).join('\n\n') + '\n';
}
