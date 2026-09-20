/**
 * How one echo prints.
 *
 * An echo is an item with a fixed shape — the thread (`body`), its citations
 * (`archive_references`), and a question for Thingy (`ask`). The renderers
 * print each one as its thread, then the ask as a link that opens Thingy
 * with the question already asked. This used to be composed into one body
 * at pick time; WT350 shipped that way, and no echo could be reordered,
 * removed, or redrafted on its own (Jamie, 2026-09-20). Now the item holds
 * the parts and the edition assembles them.
 */

import type { Item } from './types.ts';

export const THINGY_CHAT = 'https://thingy.thingelstad.com/chat/';

/** The clickable question: opens Thingy with it already asked, attributed to the issue. */
export function askThingyUrl(question: string, issueNumber?: number): string {
  const url = new URL(THINGY_CHAT);
  url.searchParams.set('prompt', question.trim());
  url.searchParams.set('from', issueNumber ? `weekly-thing-${issueNumber}` : 'weekly-thing');
  return url.toString();
}

/** `_Ask Thingy:_ [question](…)`, or nothing when the echo carries no question. */
export function askThingyLine(ask: string | undefined, issueNumber?: number): string {
  const question = String(ask ?? '').trim();
  if (!question) return '';
  return `_Ask Thingy:_ [${question}](${askThingyUrl(question, issueNumber)})`;
}

/** One echo as blocks: the thread, then its door into Thingy. Empty when unwritten. */
export function echoBlocks(echo: Pick<Item, 'body' | 'ask'>, issueNumber?: number): string[] {
  const thread = String(echo.body ?? '').trim();
  if (!thread) return [];
  return [thread, askThingyLine(echo.ask, issueNumber)].filter(Boolean);
}

/** The same, as one Markdown string — what the email and the audio start from. */
export function echoBlock(echo: Pick<Item, 'body' | 'ask'>, issueNumber?: number): string {
  return echoBlocks(echo, issueNumber).join('\n\n');
}
