/**
 * Publish verification: after a leg goes out, read the destination back and
 * say whether the issue landed as it was sent. Jamie asked for the confidence
 * the audio back catalogue gets from its nightly listening (WT351): not "the
 * send returned 200" but "the file is there, the page is live, the feed has
 * the episode, and the audio says what the script says".
 *
 * Every check reads the real destination. Nothing here writes anywhere but
 * `tmp/verify/`, where the downloaded audio and whisper's transcript are kept
 * for a closer look.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import type { Destination, IssueDoc, VerifyCheck } from '../shared/types.ts';
import { audioScript, ISSUE_URL_BASE } from '../shared/render/audio.ts';
import { renderEmail } from '../shared/render/email.ts';
import { plausibleDuration } from './backfill.ts';
import { subjectFor } from './publish.ts';
import * as buttondown from './integrations/buttondown.ts';

const run = promisify(execFile);
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const FEED = 'https://weekly.thingelstad.com/podcast.xml';

interface PodcastAudio {
  audio_url?: string;
  audio_byte_size?: number;
  audio_duration_seconds?: number;
  audio_chapters_url?: string;
  audio_transcript_url?: string;
  audio_chapters?: { title: string; start: number }[];
}

const pass = (label: string, detail: string): VerifyCheck => ({ label, ok: true, detail });
const warn = (label: string, detail: string, items?: string[]): VerifyCheck => ({ label, ok: null, detail, items });
const fail = (label: string, detail: string, items?: string[]): VerifyCheck => ({ label, ok: false, detail, items });

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  // A query string past the CDN's cached copy: a check must see what is live now.
  const bust = `${url}${url.includes('?') ? '&' : '?'}verify=${Date.now()}`;
  const res = await fetch(bust, { signal: AbortSignal.timeout(30_000) });
  return { status: res.status, text: res.ok ? await res.text() : '' };
}

function audioOf(doc: IssueDoc): PodcastAudio {
  return ((doc.sends?.podcast as { audio?: PodcastAudio } | undefined)?.audio) ?? {};
}

// ── podcast ───────────────────────────────────────────────────────────────

/** A quoted gap outside this range is heard as a stumble or a dead stop. */
const PAUSE_RANGE = [0.6, 2.5] as const;

export async function verifyPodcast(doc: IssueDoc): Promise<VerifyCheck[]> {
  const a = audioOf(doc);
  if (!a.audio_url) return [fail('Podcast sent', 'No podcast file is recorded for this issue.')];
  const checks: VerifyCheck[] = [];

  // 1. The three files are served, the mp3 at the size that was rendered.
  const missing: string[] = [];
  for (const [url, bytes] of [[a.audio_url, a.audio_byte_size], [a.audio_chapters_url, undefined], [a.audio_transcript_url, undefined]] as const) {
    if (!url) { missing.push('(not recorded)'); continue; }
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
    const length = Number(res.headers.get('content-length'));
    if (!res.ok) missing.push(`${url.split('/').pop()}: HTTP ${res.status}`);
    else if (bytes !== undefined && length !== bytes) missing.push(`${url.split('/').pop()}: ${length} bytes served, ${bytes} rendered`);
  }
  checks.push(missing.length
    ? fail('On the CDN', 'A file is missing or not the file that was rendered.', missing)
    : pass('On the CDN', `mp3, chapters, and transcript served; mp3 ${(a.audio_byte_size! / 1_048_576).toFixed(1)} MB as rendered`));

  // 2. The length fits the script: skipped or repeated speech shows here.
  const blocks = audioScript(doc);
  const seconds = a.audio_duration_seconds ?? 0;
  const odd = plausibleDuration(blocks, seconds);
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  checks.push(odd
    ? fail('Length', odd)
    : pass('Length', `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')} for ${chars.toLocaleString()} characters of script (${(chars / seconds).toFixed(1)}/s)`));

  // 3. The chapters are the ones rendered, in order, inside the episode.
  if (a.audio_chapters_url) {
    const { status, text } = await fetchText(a.audio_chapters_url);
    let chapters: { startTime: number; title: string }[] = [];
    try { chapters = (JSON.parse(text) as { chapters?: typeof chapters }).chapters ?? []; } catch { /* reported below */ }
    const ordered = chapters.every((c, i) => i === 0 || c.startTime > chapters[i - 1]!.startTime);
    const inside = chapters.every((c) => c.startTime < seconds);
    const expected = a.audio_chapters?.length ?? chapters.length;
    checks.push(status !== 200 || !chapters.length
      ? fail('Chapters', `The chapters file did not load (HTTP ${status}).`)
      : !ordered || !inside || chapters.length !== expected
        ? fail('Chapters', `${chapters.length} chapters, ${expected} rendered${ordered ? '' : '; out of order'}${inside ? '' : '; one starts past the end'}.`)
        : pass('Chapters', `${chapters.length} chapters, in order, all inside the episode`));
  }

  // 4. Listen: whisper hears the episode and every cue is matched to what
  // was said inside its window (backfill/assess.py, the back catalogue's own
  // listening). A cue that does not match is heard again on its own.
  const dir = join(ROOT, 'tmp', 'verify', `wt${doc.issue.number}`);
  mkdirSync(dir, { recursive: true });
  const base = a.audio_url.split('/').pop()!.replace(/\.mp3$/, '');
  for (const [url, ext] of [[a.audio_url, 'mp3'], [a.audio_transcript_url, 'vtt']] as const) {
    const res = await fetch(url!, { signal: AbortSignal.timeout(180_000) });
    writeFileSync(join(dir, `${base}.${ext}`), Buffer.from(await res.arrayBuffer()));
  }
  const { stdout } = await run('python3', [join(ROOT, 'backfill', 'assess.py'), '--json', dir], {
    cwd: ROOT, timeout: 20 * 60_000, maxBuffer: 16 * 1024 * 1024,
  });
  const heard = JSON.parse(stdout) as {
    cues: number; matched: number; median: number; wpm: number;
    suspects: { at: number; script: string; heard: string; alone?: string; cleared: boolean }[];
    pauses: { at: number; heard: number | null; text: string }[];
  };
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const standing = heard.suspects.filter((s) => !s.cleared);
  const cleared = heard.suspects.length - standing.length;
  const summary = `${heard.matched}/${heard.cues} cues heard as written (median ${heard.median.toFixed(2)}, ${heard.wpm} wpm)${cleared ? `; ${cleared} more heard right on its own` : ''}`;
  checks.push(standing.length
    ? (standing.length > 3 || heard.median < 0.9 ? fail : warn)('Heard as written', `${summary}; ${standing.length} still differ${standing.length === 1 ? 's' : ''} — listen at the times below.`,
      standing.map((s) => `${clock(s.at)} said "${s.script}" — heard "${(s.alone ?? s.heard).trim()}"`))
    : pass('Heard as written', summary));

  const off = heard.pauses.filter((p) => p.heard === null || p.heard < PAUSE_RANGE[0] || p.heard > PAUSE_RANGE[1]);
  checks.push(off.length
    ? warn('Section pauses', `${heard.pauses.length - off.length}/${heard.pauses.length} section changes have a clear pause.`,
      off.map((p) => `${clock(p.at)} ${p.heard === null ? 'no pause found' : `${p.heard.toFixed(1)} s`} before "${p.text}"`))
    : pass('Section pauses', `all ${heard.pauses.length} section changes pause ${Math.min(...heard.pauses.map((p) => p.heard!)).toFixed(1)}–${Math.max(...heard.pauses.map((p) => p.heard!)).toFixed(1)} s`));

  return checks;
}

// ── website ───────────────────────────────────────────────────────────────

/** The site builds on push; the page appears a minute or two after the commit. */
const DEPLOY_WAIT_MS = 8 * 60_000;
const DEPLOY_POLL_MS = 20_000;

const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const carries = (html: string, s: string) => html.includes(s) || html.includes(escaped(s)) || html.includes(s.replace(/'/g, '&#x27;')) || html.includes(s.replace(/'/g, '’'));

export async function verifyWebsite(doc: IssueDoc, opts: { wait?: boolean } = {}): Promise<VerifyCheck[]> {
  const n = doc.issue.number;
  const pageUrl = `${ISSUE_URL_BASE}${n}/`;
  const a = audioOf(doc);
  const checks: VerifyCheck[] = [];

  // The deploy is asynchronous: wait for the page to carry this issue.
  let page = await fetchText(pageUrl);
  const deadline = Date.now() + (opts.wait ? DEPLOY_WAIT_MS : 0);
  while ((page.status !== 200 || !carries(page.text, doc.issue.title)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DEPLOY_POLL_MS));
    page = await fetchText(pageUrl);
  }
  if (page.status !== 200) {
    return [fail('Page live', `${pageUrl} answers HTTP ${page.status}${opts.wait ? ' after waiting for the deploy' : ''} — check the site's build.`)];
  }
  checks.push(carries(page.text, doc.issue.title)
    ? pass('Page live', `${pageUrl.replace('https://', '')} is up with "${doc.issue.title}"`)
    : fail('Page live', `${pageUrl} is up but does not carry "${doc.issue.title}" — an older build may still be serving.`));

  if (a.audio_url) {
    const file = a.audio_url.split('/').pop()!;
    const want = [file, a.audio_chapters_url?.split('/').pop(), a.audio_transcript_url?.split('/').pop()].filter(Boolean) as string[];
    const absent = want.filter((f) => !page.text.includes(f));
    checks.push(absent.length
      ? fail('Page audio', 'The page does not embed this week’s audio — re-send the website after a podcast re-run.', absent)
      : pass('Page audio', `embeds ${file} with its chapters and transcript`));

    const feed = await fetchText(FEED);
    const guid = `weekly-thing-${n}-audio`;
    const inFeed = feed.text.includes(guid);
    const right = feed.text.includes(file);
    checks.push(!inFeed
      ? fail('Podcast feed', `${FEED.replace('https://', '')} has no episode ${guid}.`)
      : !right
        ? fail('Podcast feed', `The episode is in the feed but points at another file than ${file}.`)
        : pass('Podcast feed', `episode ${n} is in the feed with ${file}`));
  }
  return checks;
}

// ── Buttondown ────────────────────────────────────────────────────────────

export async function verifyButtondown(doc: IssueDoc): Promise<VerifyCheck[]> {
  const id = doc.sends?.buttondown?.external_id;
  if (!id) return [fail('Draft', 'No Buttondown draft is recorded for this issue.')];
  const email = await buttondown.getEmail(id);
  const checks: VerifyCheck[] = [];
  checks.push(pass('Draft', `Buttondown holds it, status "${email.status}"${email.status === 'draft' ? ' — sending is yours, from Buttondown' : ''}`));
  const subject = subjectFor(doc);
  checks.push(email.subject === subject
    ? pass('Subject', subject)
    : warn('Subject', `Buttondown has "${email.subject}", the issue says "${subject}".`));
  const body = renderEmail(doc).trim();
  checks.push(email.body === body
    ? pass('Body', `the email edition as sent (${body.length.toLocaleString()} characters)`)
    : warn('Body', 'The draft differs from the email edition as it renders now — edited in Buttondown, or the issue changed since; "Update draft" re-sends it.'));
  return checks;
}

export function verifierFor(dest: Destination) {
  if (dest === 'podcast') return (doc: IssueDoc) => verifyPodcast(doc);
  if (dest === 'website') return (doc: IssueDoc, wait?: boolean) => verifyWebsite(doc, { wait });
  if (dest === 'buttondown') return (doc: IssueDoc) => verifyButtondown(doc);
  return null;
}
