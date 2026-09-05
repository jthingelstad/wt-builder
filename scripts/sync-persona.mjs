/**
 * Vendor Thingy's print persona from the Librarian repo.
 *
 * The canonical charter lives in
 * librarian-thing/apps/librarian/prompts/thingy-persona.md — one wardrobe
 * for every surface that speaks as Thingy. This repo prepends the vendored
 * copy to the three BYLINED drafting prompts (Echoes, Membership CTA,
 * member Thank-you), so the character cannot fork the way three
 * hand-written personas would (the drift that motivated this).
 *
 *   node scripts/sync-persona.mjs           # copy + write sha256
 *   node scripts/sync-persona.mjs --check   # verify vendored copy
 *
 * --check compares the vendored file to its recorded sha (guards local
 * edits) and, when the sibling checkout is present, to the canonical file
 * (surfaces upstream drift). A missing sibling checkout skips only the
 * upstream half, mirroring the archive-page check precedent.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = join(ROOT, '..', 'librarian-thing', 'apps', 'librarian', 'prompts', 'thingy-persona.md');
const VENDORED = join(ROOT, 'prompts', 'thingy-persona.md');
const SHA_FILE = join(ROOT, 'prompts', 'thingy-persona.sha256');

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const check = process.argv.includes('--check');

if (check) {
  const vendored = readFileSync(VENDORED, 'utf8');
  const recorded = readFileSync(SHA_FILE, 'utf8').trim();
  if (sha256(vendored) !== recorded) {
    console.error('persona: vendored copy does not match its sha — edit the canonical file and run persona:sync');
    process.exit(1);
  }
  if (existsSync(CANONICAL)) {
    if (readFileSync(CANONICAL, 'utf8') !== vendored) {
      console.error('persona: canonical charter changed upstream — run persona:sync');
      process.exit(1);
    }
    console.log('persona: vendored copy matches the canonical charter');
  } else {
    console.log('persona: sha ok (sibling checkout absent; upstream check skipped)');
  }
  process.exit(0);
}

const canonical = readFileSync(CANONICAL, 'utf8');
mkdirSync(dirname(VENDORED), { recursive: true });
writeFileSync(VENDORED, canonical);
writeFileSync(SHA_FILE, sha256(canonical) + '\n');
console.log('persona: vendored from the Librarian charter');
