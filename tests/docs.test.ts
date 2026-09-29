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

  it('nothing describes write-back as last-writer-wins without saying it is compare-and-set', () => {
    // Write-back has been compare-and-set since 2026-08-30, yet nine
    // documents and three comments still called it last-writer-wins a month
    // later (review 2026-09-27, §7). A settled document keeps its old words
    // and adds a dated revisit beside them, so the phrase may stand where the
    // same paragraph says what is true now. decisions.md carries its revisit
    // as a section of its own and is the record, so it is left out.
    const sources = (dir: string): string[] =>
      readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
        .map((e) => `${e.parentPath.slice(root.length).replace(/^\/+/, '')}/${e.name}`);
    const files = [...DOCS.filter((d) => d !== 'docs/decisions.md'), '.env.example', ...sources('src')];
    const stale: string[] = [];
    for (const file of files) {
      for (const para of read(file).split(/\n\s*\n/)) {
        if (/last[ -]writer[ -]wins/i.test(para) && !/compare-and-set/i.test(para)) {
          stale.push(`${file}: ${para.trim().split('\n')[0]}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it('no document claims a test count', () => {
    // "npm test # 193 tests" was stale twice in three days. The suite's size
    // is the suite's business; a number in prose only ever decays.
    for (const doc of DOCS) {
      expect(read(doc), `${doc} claims a test count`).not.toMatch(/#?\s*\d+\s+tests\b/);
    }
  });
});
