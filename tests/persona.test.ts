/**
 * The vendored Thingy print persona: one wardrobe, no forks.
 *
 * The canonical charter lives in the Librarian repo; this repo carries a
 * verbatim vendored copy plus its sha. These tests hold the vendoring
 * honest the same way the docs freshness gate holds paths honest.
 */

import { describe, expect, it } from 'vitest';
import { stripSignOff } from '../src/server/editorial.ts';
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

describe('no sign-off inside the frame', () => {
  it('strips a trailing "— Thingy" in its dash and spacing variants, and nothing else', () => {
    expect(stripSignOff('The newsletter stays free either way. — Thingy')).toBe('The newsletter stays free either way.');
    expect(stripSignOff('Thank you for making that part of the list.\n\n—Thingy')).toBe('Thank you for making that part of the list.');
    expect(stripSignOff('…either way. - Thingy.')).toBe('…either way.');
    expect(stripSignOff('Ask Thingy how the tournament grew.')).toBe('Ask Thingy how the tournament grew.');
  });

  it('strips the Markdown variants too: emphasis, a hard break, an escaped or doubled dash', () => {
    const said = 'The newsletter stays free either way.';
    for (const tail of [
      '\n\n— *Thingy*', '\n\n*— Thingy*', ' _— Thingy._', '\n\n**— Thingy**', '  \n— _Thingy_',
      ' -- Thingy', '\n\n\\— Thingy', ' &ndash; Thingy', '\n\n— Thingy  ', '\n\n— Thingy\\',
    ]) {
      expect(stripSignOff(`${said}${tail}`), JSON.stringify(tail)).toBe(said);
    }
    // A sentence that ends on Thingy's name is not a sign-off.
    expect(stripSignOff('Say hello to *Thingy*')).toBe('Say hello to *Thingy*');
    expect(stripSignOff('Questions go to _Thingy_.')).toBe('Questions go to _Thingy_.');
    expect(stripSignOff('Every answer here is non-Thingy')).toBe('Every answer here is non-Thingy');
  });
});
