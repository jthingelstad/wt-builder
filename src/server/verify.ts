/**
 * Publish verification: after a leg goes out, read the destination back and
 * say whether the issue landed as it was sent. Jamie asked for the confidence
 * the audio back catalogue gets from its nightly listening (WT351): not "the
 * send returned 200" but "the file is there, the page is live, the feed has
 * the episode, and the audio says what the script says".
 *
 * A leg still landing — an email scheduled for later, an archive the
 * Librarian has not ingested — is `waiting`, not wrong, and says when it will
 * be looked at again.
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
import { emailOf, lastSent } from '../shared/sends.ts';
import { plausibleDuration } from './backfill.ts';
import { archiveInputs, emailSubject } from './publish.ts';
import { config } from './config.ts';
import * as buttondown from './integrations/buttondown.ts';
import * as githubRepo from './integrations/github.ts';
import { CDN_HOST } from './integrations/images.ts';
import * as librarian from './integrations/librarian.ts';

const run = promisify(execFile);

/**
 * A verifier's findings, and when to look again if the leg is still landing
 * (a scheduled email, an archive the Librarian has not ingested yet).
 */
export interface VerifyOutcome {
  checks: VerifyCheck[];
  recheckMs?: number;
  /** What the destination said the thing is (Buttondown's email status). */
  remote_status?: string;
  /** Counts kept on the issue for the next one to compare with (Buttondown's delivery). */
  metrics?: Record<string, number>;
  /**
   * The recheck only refreshes counts on a leg that has landed (complaints
   * arriving over days): a warning stays a warning, not `waiting`.
   */
  settling?: boolean;
}

/** An earlier issue's Buttondown counts, as its own check recorded them. */
export interface EarlierDelivery {
  number: number;
  metrics: Record<string, number>;
}

const MINUTE = 60_000;
/** Central time, the way Jamie reads every time (memory: times in Central). */
const central = (iso: string) => new Date(iso).toLocaleString('en-US', {
  timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit',
});
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

/** The audio the page embeds: the podcast's last good send, as the website leg reads it. */
function audioOf(doc: IssueDoc): PodcastAudio {
  return (lastSent(doc.sends?.podcast)?.audio as PodcastAudio | undefined) ?? {};
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
/**
 * How long after the send a page that is not this send's yet is still
 * "deploying", looked at again on its own, rather than wrong. Past it the
 * page is judged as it stands.
 */
const DEPLOY_PATIENCE_MS = 60 * MINUTE;
const DEPLOY_RECHECK_MS = 5 * MINUTE;

/**
 * Every image the page loads from off the CDN and off the site itself. A
 * first send once rendered the copy read before the rehost and shipped each
 * new Journal photo as the Micro.blog original (review 2026-09-27 §2.2).
 */
export function hotlinks(html: string): string[] {
  const own = new Set([CDN_HOST, new URL(ISSUE_URL_BASE).hostname]);
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const src = (m[1] ?? m[2] ?? '').replace(/&amp;/g, '&');
    let host: string;
    try {
      host = new URL(src).hostname;
    } catch {
      continue; // relative: the site's own
    }
    if (!own.has(host) && !out.includes(src)) out.push(src);
  }
  return out;
}

const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const carries = (html: string, s: string) => html.includes(s) || html.includes(escaped(s)) || html.includes(s.replace(/'/g, '&#x27;')) || html.includes(s.replace(/'/g, '’'));

export async function verifyWebsite(doc: IssueDoc, opts: { wait?: boolean } = {}): Promise<VerifyOutcome> {
  const n = doc.issue.number;
  const pageUrl = `${ISSUE_URL_BASE}${n}/`;
  const a = audioOf(doc);
  const checks: VerifyCheck[] = [];
  const file = a.audio_url?.split('/').pop();

  // The deploy is asynchronous: wait for the page to be this send's. The
  // title alone cannot say so — the previous build carries it too, and a
  // re-send after a podcast re-run was judged on the old page and told to
  // re-send (review 2026-09-27 §2.3). When the page embeds audio, this
  // send's audio file is what marks the new deploy.
  const landed = (p: { status: number; text: string }) =>
    p.status === 200 && carries(p.text, doc.issue.title) && (!file || p.text.includes(file));
  let page = await fetchText(pageUrl);
  const deadline = Date.now() + (opts.wait ? DEPLOY_WAIT_MS : 0);
  while (!landed(page) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, DEPLOY_POLL_MS));
    page = await fetchText(pageUrl);
  }
  // Not this send's yet, and the send is recent: the site is still
  // building. That is waiting, looked at again on its own, like a scheduled
  // email or an archive not yet indexed — not a problem.
  const sentAt = Date.parse(lastSent(doc.sends?.website)?.at ?? '');
  if (!landed(page) && Number.isFinite(sentAt) && Date.now() - sentAt < DEPLOY_PATIENCE_MS) {
    return {
      checks: [warn('Page live', page.status !== 200
        ? `${pageUrl.replace('https://', '')} answers HTTP ${page.status} — the site is still deploying this send; checked again in 5 minutes.`
        : `${pageUrl.replace('https://', '')} still shows the previous build — the site is still deploying this send; checked again in 5 minutes.`)],
      recheckMs: DEPLOY_RECHECK_MS,
    };
  }
  if (page.status !== 200) {
    return { checks: [fail('Page live', `${pageUrl} answers HTTP ${page.status}${opts.wait ? ' after waiting for the deploy' : ''} — check the site's build.`)] };
  }
  checks.push(carries(page.text, doc.issue.title)
    ? pass('Page live', `${pageUrl.replace('https://', '')} is up with "${doc.issue.title}"`)
    : fail('Page live', `${pageUrl} is up but does not carry "${doc.issue.title}" — an older build may still be serving.`));

  const off = hotlinks(page.text);
  checks.push(off.length
    ? warn('No hotlinks', `${off.length} image${off.length === 1 ? '' : 's'} load from off the CDN — re-send the website to point them at the rehosted copies.`, off)
    : pass('No hotlinks', `every image is on ${CDN_HOST} or the site`));

  if (a.audio_url && file) {
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
  return { checks };
}

// ── Buttondown ────────────────────────────────────────────────────────────

/** How long after a send the delivery count is still worth refreshing. */
const DELIVERY_SETTLE_MS = 6 * 60 * MINUTE;

/**
 * Gmail's published line for bulk senders: keep spam complaints under 0.1%
 * of delivered mail and never reach 0.3%. Buttondown's count is only the
 * providers that report complaints back (not Gmail itself), so this is a
 * floor, and worth heeding the moment it crosses.
 */
export const COMPLAINT_WARN = 0.001;
export const COMPLAINT_FAIL = 0.003;
/** Complaints and unsubscriptions keep arriving for days; look again until then. */
const COMPLAINTS_SETTLE_MS = 72 * 60 * MINUTE;
const COMPLAINTS_RECHECK_MS = 6 * 60 * MINUTE;

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/** The Complaints line: this issue's spam complaints and unsubscriptions, beside the issues before it. */
export function complaintsCheck(
  d: { deliveries: number; complaints?: number; unsubscriptions?: number }, earlier: EarlierDelivery[] = [],
): VerifyCheck | undefined {
  if (d.complaints === undefined) return undefined;
  const rate = d.deliveries > 0 ? d.complaints / d.deliveries : 0;
  const unsub = d.unsubscriptions === undefined ? '' : ` · ${d.unsubscriptions.toLocaleString()} unsubscribed`;
  const line = `${d.complaints.toLocaleString()} spam complaint${d.complaints === 1 ? '' : 's'} (${pct(rate)})${unsub}`;
  const before = earlier
    .filter((e) => typeof e.metrics.complaints === 'number')
    .slice(0, 4)
    .map((e) => `WT${e.number}: ${e.metrics.complaints}${typeof e.metrics.unsubscriptions === 'number' ? ` / ${e.metrics.unsubscriptions}` : ''}`);
  const items = before.length ? [`Earlier issues (complaints / unsubscribed) — ${before.join(', ')}`] : undefined;
  if (rate >= COMPLAINT_FAIL) {
    return { ...fail('Complaints', `${line} — over Gmail's 0.3% line. Look at what this issue linked or said; complaints at this rate move mail to spam.`), ...(items ? { items } : {}) };
  }
  if (rate >= COMPLAINT_WARN) {
    return { ...warn('Complaints', `${line} — over Gmail's 0.1% guideline.`), ...(items ? { items } : {}) };
  }
  return { ...pass('Complaints', line), ...(items ? { items } : {}) };
}

export async function verifyButtondown(doc: IssueDoc, earlier: EarlierDelivery[] = []): Promise<VerifyOutcome> {
  const id = emailOf(doc.sends?.buttondown).id;
  if (!id) return { checks: [fail('Status', 'No Buttondown email is recorded for this issue.')] };
  const email = await buttondown.getEmail(id);
  const checks: VerifyCheck[] = [];
  let recheckMs: number | undefined;
  let metrics: Record<string, number> | undefined;
  let settling = false;

  // The leg ends at a draft; Jamie schedules or sends it in Buttondown. Until
  // it has gone, this waits and looks again — at the scheduled minute when
  // there is one — so the card ends up saying it was, in fact, sent.
  if (email.status === 'sent') {
    checks.push(pass('Status', `Sent ${email.publish_date ? central(email.publish_date) : ''} CT`.replace('  ', ' ')));
    const d = await buttondown.getDelivery(id);
    const failed = d.temporary_failures + d.permanent_failures;
    const line = `${d.recipients.toLocaleString()} recipients · ${d.deliveries.toLocaleString()} delivered · ${failed} failed (${d.permanent_failures} permanent)`;
    const badly = d.recipients > 0 && d.permanent_failures / d.recipients > 0.02;
    checks.push(d.recipients === 0
      ? warn('Delivery', 'Buttondown has not counted any recipients yet.')
      : badly ? fail('Delivery', `${line} — more than 2% bounced for good.`) : pass('Delivery', line));
    const complaints = complaintsCheck(d, earlier);
    if (complaints) checks.push(complaints);
    metrics = {
      recipients: d.recipients, deliveries: d.deliveries,
      ...(d.complaints !== undefined ? { complaints: d.complaints } : {}),
      ...(d.unsubscriptions !== undefined ? { unsubscriptions: d.unsubscriptions } : {}),
    };
    const age = email.publish_date ? Date.now() - Date.parse(email.publish_date) : Infinity;
    if (age < DELIVERY_SETTLE_MS && d.deliveries + failed < d.recipients) recheckMs = 30 * MINUTE;
    else if (age < COMPLAINTS_SETTLE_MS) {
      recheckMs = COMPLAINTS_RECHECK_MS;
      settling = true;
    }
  } else if (email.status === 'scheduled' || email.status === 'about_to_send' || email.status === 'in_flight') {
    const when = email.publish_date ? Date.parse(email.publish_date) : NaN;
    checks.push(warn('Status', email.status === 'scheduled' && email.publish_date
      ? `Scheduled for ${central(email.publish_date)} CT — checked again once it goes.`
      : 'Going out now — checked again in a few minutes.'));
    recheckMs = Number.isFinite(when) && when > Date.now() ? when - Date.now() + 3 * MINUTE : 3 * MINUTE;
  } else if (email.status === 'draft') {
    checks.push(warn('Status', 'A draft — schedule or send it from Buttondown. Checked again every 10 minutes.'));
    recheckMs = 10 * MINUTE;
  } else {
    checks.push(fail('Status', `Buttondown says "${email.status}".`));
  }

  const subject = emailSubject(doc);
  checks.push(email.subject === subject
    ? pass('Subject', subject)
    : warn('Subject', `Buttondown has "${email.subject}", the issue says "${subject}".`));
  const body = renderEmail(doc).trim();
  checks.push(email.body === body
    ? pass('Body', `the email edition as sent (${body.length.toLocaleString()} characters)`)
    : warn('Body', email.status === 'sent'
      ? 'The sent email differs from the email edition as it renders now — the issue changed after it went.'
      : 'The draft differs from the email edition as it renders now — edited in Buttondown, or the issue changed since; "Update draft" re-sends it.'));
  return { checks, recheckMs, remote_status: email.status || undefined, ...(metrics ? { metrics } : {}), ...(settling ? { settling } : {}) };
}

// ── archive ───────────────────────────────────────────────────────────────

/** The Librarian ingests on its own schedule; stop looking after a day. */
const INDEX_PATIENCE_MS = 24 * 60 * MINUTE;

export async function verifyArchive(doc: IssueDoc): Promise<VerifyOutcome> {
  const n = doc.issue.number;
  const sent = lastSent(doc.sends?.archive);
  if (!sent?.external_id) return { checks: [fail('In the corpus', 'No archive commit is recorded for this issue.')] };
  const checks: VerifyCheck[] = [];
  let recheckMs: number | undefined;

  // 1. The corpus holds exactly what this issue renders to.
  const email = emailOf(doc.sends?.buttondown);
  const files = archiveInputs(doc, { buttondownId: email.id, absoluteUrl: email.url });
  const d = await githubRepo.diff(files, { repo: config.archiveRepo, branch: config.archiveBranch });
  checks.push(d.changed.length
    ? warn('In the corpus', `${d.changed.length} of ${files.length} files in ${config.archiveRepo} differ from the issue as it renders now — "Re-commit" brings them level.`, d.changed)
    : pass('In the corpus', `${files.length} files in ${config.archiveRepo} match the issue exactly`));

  // 2. Thingy can find it: the Librarian returns this issue's own passages.
  // Asked for this issue exactly (4.11 issueNumber), so a crowded topic
  // cannot push it out of the top k the way a plain semantic probe could.
  const passages = await librarian.retrieve(`${doc.issue.title} ${doc.issue.dek ?? ''}`.trim(), 5, {
    filters: { issueNumber: n },
  });
  const own = passages.filter((p) => Number(p.issue_number) === n);
  if (own.length) {
    checks.push(pass('Retrievable by Thingy', `the Librarian returns ${own.length} WT${n} passage${own.length === 1 ? '' : 's'} for the issue's own title`));
  } else {
    const age = Date.now() - Date.parse(sent.at ?? new Date().toISOString());
    const patient = age < INDEX_PATIENCE_MS;
    checks.push((patient ? warn : fail)('Retrievable by Thingy', patient
      ? `Not in the Librarian yet — it ingests on its own schedule. Checked again every 15 minutes.`
      : `A day after the commit the Librarian still returns nothing from WT${n} — check its ingest.`));
    if (patient) recheckMs = 15 * MINUTE;
  }
  return { checks, recheckMs };
}

export function verifierFor(
  dest: Destination, earlier: () => EarlierDelivery[] = () => [],
): ((doc: IssueDoc, wait?: boolean) => Promise<VerifyOutcome>) | null {
  if (dest === 'podcast') return async (doc) => ({ checks: await verifyPodcast(doc) });
  if (dest === 'website') return (doc, wait) => verifyWebsite(doc, { wait });
  if (dest === 'buttondown') return (doc) => verifyButtondown(doc, earlier().filter((e) => e.number < doc.issue.number));
  if (dest === 'archive') return verifyArchive;
  return null;
}
