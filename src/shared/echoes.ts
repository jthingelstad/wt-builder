/**
 * Composing the Echoes section from selected units.
 *
 * The wand offers up to five self-contained echoes; Jamie selects any
 * subset, so the section's length follows the quality of what the archive
 * offered. Selected echoes compose in the order they were offered — the
 * ask-Thingy door, when present, is offered last, so a selected door
 * closes the section. Each echo becomes its own short paragraph, and the
 * citations pool in the same order, deduped by url.
 */

import type { ArchiveReference, EchoOption } from './types.ts';

export const THINGY_CHAT = 'https://thingy.thingelstad.com/chat/';

/** The clickable question: opens Thingy with it already asked, attributed to the issue. */
export function askThingyUrl(question: string, issueNumber?: number): string {
  const url = new URL(THINGY_CHAT);
  url.searchParams.set('prompt', question.trim());
  url.searchParams.set('from', issueNumber ? `weekly-thing-${issueNumber}` : 'weekly-thing');
  return url.toString();
}

/** One echo as it prints: the thread, then its door into Thingy. */
export function echoBlock(echo: EchoOption, issueNumber?: number): string {
  const text = echo.text.trim();
  const ask = String(echo.ask ?? '').trim();
  if (!text) return '';
  if (!ask) return text;
  return `${text}\n\n_Ask Thingy:_ [${ask}](${askThingyUrl(ask, issueNumber)})`;
}

export function composeEchoes(selected: EchoOption[], issueNumber?: number): {
  body: string;
  archive_references: ArchiveReference[];
} {
  const seen = new Set<string>();
  const refs: ArchiveReference[] = [];
  for (const echo of selected) {
    for (const reference of echo.archive_references ?? []) {
      if (!reference.url || seen.has(reference.url)) continue;
      seen.add(reference.url);
      refs.push(reference);
    }
  }
  return {
    body: selected.map((e) => echoBlock(e, issueNumber)).filter(Boolean).join('\n\n'),
    archive_references: refs,
  };
}
