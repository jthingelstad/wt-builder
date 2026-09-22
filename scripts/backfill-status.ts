/**
 * Where the back catalogue is. One command a fresh session runs to attach
 * to a job that has been going for weeks without it:
 *
 *   npm run backfill:status
 *
 * Reads what the website checkout says is done, what the daily job wrote
 * last (state, log, report), what launchd says about the job, and what the
 * live feed carries. Changes nothing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ARCHIVE_DIR, hasCurrentAudio, legacyIssues } from '../src/server/backfill.ts';

const root = new URL('..', import.meta.url);
const path = (p: string) => fileURLToPath(new URL(p, root));
const LOG = `${process.env.HOME}/Library/Logs/wt-builder/backfill.log`;
const ERR = `${process.env.HOME}/Library/Logs/wt-builder/backfill.err`;
const LABEL = 'com.thingelstad.wt-backfill';

const all = legacyIssues();
const remaining = all.filter((n) => !hasCurrentAudio(readFileSync(`${ARCHIVE_DIR}${n}.md`, 'utf8')));
const done = all.length - remaining.length;
console.log(`Back catalogue: ${done} of ${all.length} issues have a current audio edition; ${remaining.length} remaining.`);
console.log(`Next ten: ${remaining.slice(0, 10).join(' ') || '(none — complete)'}`);
if (remaining.length) console.log(`At ten a day: about ${Math.ceil(remaining.length / 10)} more days.`);

const stateFile = path('data/backfill-state.json');
if (existsSync(stateFile)) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { published: Record<string, string>; lastRun?: string };
  const days = new Map<string, number>();
  for (const d of Object.values(state.published)) days.set(d, (days.get(d) ?? 0) + 1);
  console.log(`Daily job last ran ${state.lastRun ?? 'never'}; published by day: ${[...days.entries()].sort().map(([d, n]) => `${d}:${n}`).join(' ')}`);
} else {
  console.log('Daily job has not run yet (no data/backfill-state.json).');
}

try {
  const out = execFileSync('launchctl', ['print', `gui/${process.getuid?.() ?? 501}/${LABEL}`], { encoding: 'utf8' });
  const state = /state = ([^\n]+)/.exec(out)?.[1]?.trim() ?? '?';
  const exit = /last exit code = ([^\n]+)/.exec(out)?.[1]?.trim();
  console.log(`launchd ${LABEL}: loaded, ${state}${exit ? `, last exit code ${exit}` : ''}; fires 02:15 daily.`);
} catch {
  console.log(`launchd ${LABEL}: NOT LOADED — launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${LABEL}.plist`);
}

const reportsDir = path('tmp/backfill/reports/');
const reports = existsSync(reportsDir) ? readdirSync(reportsDir).filter((f) => f.endsWith('.md')).sort() : [];
if (reports.length) {
  console.log(`\n--- latest report: tmp/backfill/reports/${reports[reports.length - 1]} ---`);
  console.log(readFileSync(`${reportsDir}${reports[reports.length - 1]}`, 'utf8').trim());
}
for (const [name, file] of [['log', LOG], ['errors', ERR]] as const) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines.length) continue;
  console.log(`\n--- ${name}: last ${Math.min(5, lines.length)} of ${lines.length} lines (${file}) ---`);
  console.log(lines.slice(-5).join('\n'));
}

try {
  const feed = await (await fetch('https://weekly.thingelstad.com/podcast.xml', { signal: AbortSignal.timeout(30_000) })).text();
  const items = (feed.match(/<item>/g) ?? []).length;
  const current = (feed.match(/weekly-thing-\d+-[0-9a-f]{8}\.mp3/g) ?? []).length;
  console.log(`\nLive feed: ${items} episodes, ${current} of them content-named renders from this assembler.`);
} catch (err) {
  console.log(`\nLive feed: unreadable (${(err as Error).message.slice(0, 80)})`);
}
