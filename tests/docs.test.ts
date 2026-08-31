/**
 * Docs freshness, enforced.
 *
 * This repo's recurring failure class is documentation describing a state the
 * code contradicts: the send dispatch was severed for a day while three
 * documents said it worked, and status.md carried an audio-lens feature as
 * unbuilt for two days after it shipped. A doc-only guarantee decays in under
 * 24 hours here; these checks make two kinds of drift fail the build instead.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const DOCS = [
  'README.md',
  'AGENTS.md',
  ...readdirSync(new URL('../docs', import.meta.url))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];

describe('the documents stay honest', () => {
  it('every file path the docs cite exists', () => {
    // A doc pointing at a deleted or renamed file is the exact rot that made
    // PHASE docs "actively wrong" in sibling repos. Historical mentions are
    // fine as prose; a concrete path is a claim.
    const pat = /\b((?:src|scripts|tests|fixtures|docs)\/[A-Za-z0-9_\-./]+\.(?:ts|tsx|md|json|mjs|js|css))\b/g;
    const dead: string[] = [];
    for (const doc of DOCS) {
      for (const m of new Set(read(doc).match(pat) ?? [])) {
        if (!existsSync(`${root}/${m}`)) dead.push(`${doc} → ${m}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('no document claims a test count', () => {
    // "npm test # 193 tests" was stale twice in three days. The suite's size
    // is the suite's business; a number in prose only ever decays.
    for (const doc of DOCS) {
      expect(read(doc), `${doc} claims a test count`).not.toMatch(/#?\s*\d+\s+tests\b/);
    }
  });
});
