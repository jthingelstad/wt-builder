/**
 * The vendored Thingy print persona: one wardrobe, no forks.
 *
 * The canonical charter lives in the Librarian repo; this repo carries a
 * verbatim vendored copy plus its sha. These tests hold the vendoring
 * honest the same way the docs freshness gate holds paths honest.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { THINGY_PERSONA } from '../src/server/editorial.ts';

const root = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');

describe('the vendored Thingy persona', () => {
  it('matches its recorded sha — local edits belong in the canonical charter', () => {
    const vendored = read('prompts/thingy-persona.md');
    const recorded = read('prompts/thingy-persona.sha256').trim();
    expect(createHash('sha256').update(vendored).digest('hex')).toBe(recorded);
  });

  it('matches the canonical charter when the sibling checkout is present', () => {
    const canonical = new URL('../librarian-thing/apps/librarian/prompts/thingy-persona.md', root);
    if (!existsSync(fileURLToPath(canonical))) return; // CI has no sibling checkout
    expect(readFileSync(fileURLToPath(canonical), 'utf8')).toBe(read('prompts/thingy-persona.md'));
  });

  it('is what the bylined prompts actually load', () => {
    expect(THINGY_PERSONA).toBe(read('prompts/thingy-persona.md'));
    expect(THINGY_PERSONA).toContain('Archive librarian');
    expect(THINGY_PERSONA).toContain('Community giving');
  });
});
