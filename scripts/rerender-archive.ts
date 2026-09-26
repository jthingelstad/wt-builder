/**
 * Re-render back-catalogue pages (WT1–WT349) on the website from their
 * canonical text, the archive's data/issues/{N}/archive.md.
 *
 *   npm run rerender:archive                   # dry run, every page
 *   npm run rerender:archive -- 294 290-299    # dry run, some pages
 *   npm run rerender:archive -- --commit       # commit as one commit; CI deploys
 *
 * Historical repairs land in the canonical text and rebuild the Librarian's
 * corpus, but nothing else re-renders a page WT Builder did not author — the
 * website leg re-sends only issues it wrote (WT350 on). This does, as a merge
 * (src/server/backfill.ts): the body and editorial front matter come from the
 * canonical text; layout, permalink, tags and the audio record stay. Both
 * writers of these pages go through editTree, so this and the daily audio
 * backfill cannot commit over each other.
 *
 * The dry run checks every change against that contract and writes a diff per
 * page to tmp/rerender/. A page's own keys changing, or its editorial front
 * matter differing from the canonical text, is a bug: it is reported, the run
 * exits 1, and --commit refuses.
 *
 * It does not regenerate the audio scripts in backfill/scripts/:
 * backfill/transform/regenerate.py reads these pages, and changing its input is
 * a separate decision.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { OWNED_KEY, backCatalogue, frontMatter, pageKeys, planRerender, publishRerender, type Rerender } from '../src/server/backfill.ts';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const all = backCatalogue();
const names = args.filter((a) => !a.startsWith('--')).flatMap((a) => {
  const range = /^(\d+)-(\d+)$/.exec(a);
  const wanted = range ? all.filter((n) => /^\d+$/.test(n) && +n >= +range[1]! && +n <= +range[2]!) : [a];
  for (const n of wanted) if (!all.includes(n)) throw new Error(`${n}: not a back-catalogue page (1–349, 140-special)`);
  return wanted;
});
const selected = names.length ? [...new Set(names)] : all;

const out = fileURLToPath(new URL('../tmp/rerender/', import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** What the change is, and anything in it the contract forbids. */
function classify(r: Rerender): { front: boolean; body: boolean; notice: boolean; problems: string[] } {
  const problems: string[] = [];
  const before = pageKeys(r.before, r.canonical);
  const after = pageKeys(r.after, r.canonical);
  const canonical = pageKeys(r.canonical, r.canonical).editorial;
  if (JSON.stringify(before.owned) !== JSON.stringify(after.owned)) problems.push('the page\u2019s own keys changed');
  for (const { key } of before.owned) if (!OWNED_KEY.test(key)) problems.push(`kept "${key}", which the canonical text lacks and WT Builder does not own`);
  if (JSON.stringify(after.editorial) !== JSON.stringify(canonical)) problems.push('editorial front matter differs from the canonical text');
  const [noticeBefore, ...bodyBefore] = frontMatter(r.before).body.split('\n');
  const [noticeAfter, ...bodyAfter] = frontMatter(r.after).body.split('\n');
  if (!noticeBefore!.startsWith('<!--')) problems.push('the page had no generated-by line');
  const front = JSON.stringify(before.editorial) !== JSON.stringify(after.editorial);
  return { front, body: bodyBefore.join('\n') !== bodyAfter.join('\n'), notice: noticeBefore !== noticeAfter, problems };
}

const plan = await planRerender(selected);
const changed = plan.filter((r) => r.after !== r.before);
let bodies = 0;
const fronts: string[] = [];
let noticeOnly = 0;
const bad: string[] = [];
const bodyNames: string[] = [];
for (const r of changed) {
  const c = classify(r);
  if (c.front) fronts.push(r.name);
  if (c.body) {
    bodies++;
    bodyNames.push(r.name);
  } else if (c.notice) noticeOnly++;
  if (c.problems.length) bad.push(`WT${r.name}: ${c.problems.join('; ')}`);
  writeFileSync(`${out}${r.name}.before.md`, r.before);
  writeFileSync(`${out}${r.name}.after.md`, r.after);
  const diff = spawnSync('diff', ['-u', `${r.name}.before.md`, `${r.name}.after.md`], { cwd: out, encoding: 'utf8' });
  writeFileSync(`${out}${r.name}.diff`, diff.stdout);
}

console.log(`${plan.length} pages read, ${changed.length} would change: ${bodies} body text, ${noticeOnly} generated-by line only; ${plan.length - changed.length} unchanged`);
console.log(`editorial front matter changes: ${fronts.length ? fronts.map((n) => `WT${n}`).join(' ') : 'none'}`);
console.log(`body changes: ${bodyNames.map((n) => `WT${n}`).join(' ')}`);
console.log(`diffs in ${out}`);
if (bad.length) {
  console.log(`\n${bad.length} page(s) break the contract:\n${bad.join('\n')}`);
  process.exit(1);
}
if (!commit) process.exit(0);
if (!changed.length) {
  console.log('nothing to commit');
  process.exit(0);
}

const push = await publishRerender(changed);
console.log(
  push.committed
    ? `committed ${push.changed.length} pages: https://github.com/jthingelstad/weekly.thingelstad.com/commit/${push.sha}`
    : 'nothing changed on GitHub; no commit',
);
