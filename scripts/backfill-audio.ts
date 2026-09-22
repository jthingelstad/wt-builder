/**
 * The audio edition for one or more issues that were never authored here.
 *
 *   npm run backfill:audio -- --plan <issue> ... | --all
 *   npm run backfill:audio -- --dry <issue> ...
 *   npm run backfill:audio -- --publish <issue> ...
 *
 *   --plan     parse and count; no synthesis, no upload, no cost
 *   --dry      synthesize (pieces go to the store) but write the three files
 *              to tmp/backfill/<issue>/ instead of the CDN — the calibration
 *              listen; reads the page from the local checkout
 *   --publish  render to the CDN against the page on GitHub, verify, and
 *              commit the pages with their audio fields as one commit; the
 *              website's CI deploys them
 *
 * The daily job (scripts/backfill-daily.ts) is --publish for the next ten.
 */

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { ARCHIVE_DIR, legacyIssues, prepare, publishPages, renderIssue, type BackfillOutcome } from '../src/server/backfill.ts';

const root = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const names = args.filter((a) => !a.startsWith('--'));
if (flag('--all')) names.push(...legacyIssues());
const mode = flag('--plan') ? 'plan' : flag('--dry') ? 'dry' : flag('--publish') ? 'publish' : null;
if (!names.length || !mode) {
  console.error('usage: backfill-audio (--plan | --dry | --publish) <issue> ... | --all');
  process.exit(2);
}
names.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b));

if (mode === 'plan') {
  for (const name of names) {
    const p = prepare(name, readFileSync(`${ARCHIVE_DIR}${name}.md`, 'utf8'));
    console.log(`${name}: ${p.blocks.length} blocks, ${p.chapters.length} chapters [${p.chapters.join(', ')}]; "${p.episode.title}", ${p.episode.date}, cover ${p.episode.coverSource ? 'from page' : 'show art'}`);
  }
  process.exit(0);
}

const outcomes: BackfillOutcome[] = [];
const failed: string[] = [];
for (const name of names) {
  try {
    let localOut: string | undefined;
    if (mode === 'dry') {
      localOut = fileURLToPath(new URL(`tmp/backfill/${name}/`, root));
      mkdirSync(localOut, { recursive: true });
    }
    const o = await renderIssue(name, { localOut });
    outcomes.push(o);
    const r = o.result;
    console.log(`${name}: ${(r.durationSeconds / 60).toFixed(1)} min, ${r.pieces} pieces (${r.synthesized} new), cover ${r.coverSource}, ${o.seconds} s → ${localOut ?? r.url}`);
    for (const p of o.problems) console.error(`${name}: PROBLEM ${p}`);
  } catch (err) {
    failed.push(name);
    console.error(`${name}: FAILED ${(err as Error).message.slice(0, 300)}`);
  }
}
if (mode === 'publish') {
  const push = await publishPages(outcomes);
  if (push?.committed) console.log(`website: committed ${push.changed.length} page(s) as ${push.sha.slice(0, 8)}`);
  else console.log('website: nothing to commit');
}
const withProblems = outcomes.filter((o) => o.problems.length).map((o) => o.name);
if (failed.length || withProblems.length) {
  console.error(`not clean: ${[...failed, ...withProblems].join(' ')}`);
  process.exit(1);
}
