/**
 * The text a review note can anchor to in one item.
 *
 * A PROOF note carries the exact substring it is about, and a note whose
 * substring is gone is stale: the server prunes it (editorial.ts,
 * pruneStale) and the notes panel drops it live (Editor.tsx). The two
 * kept separate copies of this list, and both left out the photo's
 * caption, alt and place and the echo's Ask question, so a typo there was
 * reported and then pruned before anyone saw it; it shipped, and was
 * spoken (review 2026-09-27, §5). One list, here, for both sides.
 */

import type { Item } from './types.ts';

export function anchorText(item: Item): string {
  return [
    item.title,
    item.body,
    item.commentary,
    item.label,
    item.media?.caption,
    item.media?.alt,
    item.media?.location,
    item.ask,
    item.member_thanks,
  ]
    .filter(Boolean)
    .join('\n');
}
