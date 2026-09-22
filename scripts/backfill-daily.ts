/**
 * The day's ten: the newest back-catalogue issues without a current audio
 * edition, rendered, verified, committed to the website, and listened to.
 *
 *   npm run backfill:daily            # render the next ten and publish them
 *   npm run backfill:daily -- --pick  # only say which ten are next
 *   WT_BACKFILL_COUNT=5 npm run backfill:daily
 *
 * Runs from launchd every morning (com.thingelstad.wt-backfill). Each run:
 *
 * 1. brings the sibling website checkout up to date, which is where "done" is
 *    read from (a page whose audio_voice is this assembler's voice is done);
 * 2. renders the next N against the live page on GitHub, verifies the three
 *    files on the CDN and the length against the script, and commits the
 *    pages as one commit — the site's CI deploys them;
 * 3. checks that yesterday's issues are in the live podcast feed;
 * 4. transcribes each new render with whisper and writes an assessment
 *    beside it (backfill/assess.py), so a bad read is on record;
 * 5. writes tmp/backfill/reports/<date>.md and one line to the log.
 *
 * Nothing here retries a whole issue: a failed issue is named in the report
 * and is simply next again tomorrow, because it still has no current audio.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ARCHIVE_DIR, hasCurrentAudio, legacyIssues, publishPages, renderIssue, type BackfillOutcome } from '../src/server/backfill.ts';

const root = new URL('..', import.meta.url);
const path = (p: string) => fileURLToPath(new URL(p, root));
const COUNT = Math.max(1, Number(process.env.WT_BACKFILL_COUNT) || 10);
const FEED = 'https://weekly.thingelstad.com/podcast.xml';
const today = new Date().toISOString().slice(0, 10);
const reportsDir = path('tmp/backfill/reports/');
mkdirSync(reportsDir, { recursive: true });
const stateFile = path('data/backfill-state.json');
const state: { published: Record<string, string>; lastRun?: string } = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { published: {} };

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

// 1. The checkout says what is done.
const site = path('../weekly.thingelstad.com/');
const pull = spawnSync('git', ['-C', site, 'pull', '--ff-only', '--quiet', 'origin', 'main'], { encoding: 'utf8' });
if (pull.status !== 0) log(`website checkout not updated: ${pull.stderr.trim().slice(0, 200)} — choosing from what is here`);
const next = legacyIssues().filter((n) => !hasCurrentAudio(readFileSync(`${ARCHIVE_DIR}${n}.md`, 'utf8'))).slice(0, COUNT);
const remaining = legacyIssues().filter((n) => !hasCurrentAudio(readFileSync(`${ARCHIVE_DIR}${n}.md`, 'utf8'))).length;
if (process.argv.includes('--pick')) {
  console.log(`next ${next.length} of ${remaining} remaining: ${next.join(' ')}`);
  process.exit(0);
}
if (!next.length) {
  log('the back catalogue is complete; nothing to do');
  process.exit(0);
}
log(`rendering ${next.join(' ')} (${remaining} remaining before today)`);

// 2. Render, verify, commit.
const outcomes: BackfillOutcome[] = [];
const failed: { name: string; error: string }[] = [];
for (const name of next) {
  try {
    const o = await renderIssue(name);
    outcomes.push(o);
    log(`${name}: ${(o.result.durationSeconds / 60).toFixed(1)} min, ${o.result.pieces} pieces (${o.result.synthesized} new), ${o.seconds} s${o.problems.length ? ` — PROBLEMS: ${o.problems.join('; ')}` : ''}`);
  } catch (err) {
    failed.push({ name, error: (err as Error).message.slice(0, 300) });
    log(`${name}: FAILED ${(err as Error).message.slice(0, 300)}`);
  }
}
let commit = 'nothing to commit';
try {
  const push = await publishPages(outcomes);
  if (push?.committed) {
    commit = `https://github.com/jthingelstad/weekly.thingelstad.com/commit/${push.sha}`;
    for (const o of outcomes.filter((x) => !x.problems.length)) state.published[o.name] = today;
  }
} catch (err) {
  commit = `COMMIT FAILED: ${(err as Error).message.slice(0, 300)}`;
}
log(`website: ${commit}`);

// 3. Yesterday's are in the feed by now.
const feedMissing: string[] = [];
try {
  const feed = await (await fetch(FEED, { signal: AbortSignal.timeout(30_000) })).text();
  for (const [name, date] of Object.entries(state.published)) {
    if (date === today) continue;
    if (!feed.includes(`<guid isPermaLink="false">weekly-thing-${name}-audio</guid>`)) feedMissing.push(name);
  }
} catch (err) {
  feedMissing.push(`(feed unreadable: ${(err as Error).message.slice(0, 100)})`);
}

// 4. Listen.
const assessments: { name: string; summary: string }[] = [];
for (const o of outcomes.filter((x) => !x.problems.length)) {
  try {
    const dir = path(`tmp/backfill/${o.name}/`);
    mkdirSync(dir, { recursive: true });
    const base = o.result.url.split('/').pop()!.replace(/\.mp3$/, '');
    for (const [url, ext] of [[o.result.url, 'mp3'], [o.result.transcriptUrl, 'vtt']] as const) {
      const bytes = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).arrayBuffer());
      writeFileSync(`${dir}${base}.${ext}`, bytes);
    }
    const out = execFileSync('python3', [path('backfill/assess.py'), dir], { encoding: 'utf8', timeout: 20 * 60_000 });
    const match = /median match ([\d.]+), (\d+)\/(\d+)/.exec(out);
    const pauses = [...out.matchAll(/^- +([\d.]+)s → +([\d.na]+)s/gm)].map((m) => Number(m[2]));
    const heard = pauses.filter((p) => Number.isFinite(p));
    const inRange = heard.filter((p) => p >= 0.8 && p <= 2.5).length;
    const summary = `median ${match?.[1] ?? '?'} (${match?.[2] ?? '?'}/${match?.[3] ?? '?'} cues ≥0.72), section pauses in range ${inRange}/${heard.length}`;
    assessments.push({ name: o.name, summary });
    log(`${o.name}: heard — ${summary}`);
  } catch (err) {
    assessments.push({ name: o.name, summary: `assessment failed: ${(err as Error).message.slice(0, 120)}` });
  }
}

// 5. On record.
state.lastRun = today;
mkdirSync(path('data/'), { recursive: true });
writeFileSync(stateFile, JSON.stringify(state, null, 2));
const clean = outcomes.filter((o) => !o.problems.length).map((o) => o.name);
const report = [
  `# Back catalogue, ${today}`,
  '',
  `Rendered and published: ${clean.length ? clean.join(', ') : 'none'}. Remaining after today: ${remaining - clean.length}.`,
  `Website commit: ${commit}`,
  '',
  ...outcomes.map((o) => `- WT${o.name}: ${(o.result.durationSeconds / 60).toFixed(1)} min, ${o.result.pieces} pieces (${o.result.synthesized} new), cover ${o.result.coverSource}${o.problems.length ? ` — **NOT PUBLISHED**: ${o.problems.join('; ')}` : ''}`),
  ...failed.map((f) => `- WT${f.name}: **FAILED** ${f.error}`),
  '',
  '## Heard',
  ...assessments.map((a) => `- WT${a.name}: ${a.summary} — details in tmp/backfill/${a.name}/assessment.txt`),
  '',
  `## Yesterday's in the live feed: ${feedMissing.length ? `MISSING ${feedMissing.join(', ')}` : 'all present'}`,
  '',
].join('\n');
writeFileSync(`${reportsDir}${today}.md`, report);
log(`report: tmp/backfill/reports/${today}.md — ${clean.length} published, ${failed.length + outcomes.length - clean.length} not, feed ${feedMissing.length ? 'MISSING ' + feedMissing.length : 'ok'}`);
process.exit(failed.length || outcomes.length !== clean.length || feedMissing.length ? 1 : 0);
