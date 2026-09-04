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

export function composeEchoes(selected: EchoOption[]): {
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
    body: selected.map((e) => e.text.trim()).filter(Boolean).join('\n\n'),
    archive_references: refs,
  };
}
