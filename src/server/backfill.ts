/**
 * The back catalogue: an audio edition for an issue that was never authored
 * here, from its page in the website repository and its script in
 * `backfill/scripts/`.
 *
 * The website's page is the record of an episode, and the copy of record is
 * the one on GitHub — the sibling checkout drifts behind CI and the app's own
 * sends. So the page is read from GitHub, the audio fields are put into its
 * front matter, and it is committed back through the same path an issue send
 * uses; the site's CI deploys it. The local checkout is only consulted to
 * choose what to do next.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { VOICE_ID, renderAudio, type AudioResult, type Episode } from './integrations/audio.ts';
import * as githubRepo from './integrations/github.ts';
import { audioFrontMatter, type AudioFields } from './publish.ts';
import { legacyBlocks, legacyTitle } from '../shared/render/legacy-blocks.ts';
import type { ScriptBlock } from '../shared/render/audio.ts';

const root = new URL('../../', import.meta.url);
export const ARCHIVE_DIR = fileURLToPath(new URL('../weekly.thingelstad.com/apps/site/archive/', root));
export const SCRIPTS_DIR = fileURLToPath(new URL('backfill/scripts/', root));
export const ARCHIVE_PATH = 'apps/site/archive';
/** Issues from 350 on are authored here and spoken from their document. */
export const LAST_LEGACY_ISSUE = 349;

/** The front-matter keys this needs, without a YAML dependency: they are all one-line scalars. */
export function frontMatter(page: string): { front: string; body: string; get: (key: string) => string } {
  if (!page.startsWith('---\n')) throw new Error('no front matter');
  const end = page.indexOf('\n---\n', 4);
  const front = page.slice(4, end);
  const body = page.slice(end + 5);
  const get = (key: string): string => {
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(front);
    if (!m) return '';
    let v = m[1]!.trim();
    if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === "'" || v[0] === '"')) {
      v = v[0] === "'" ? v.slice(1, -1).replace(/''/g, "'") : v.slice(1, -1).replace(/\\"/g, '"');
    }
    return v;
  };
  return { front, body, get };
}

/** The page with any earlier audio record removed and this one appended. */
export function withAudio(page: string, fields: AudioFields): string {
  const { front, body } = frontMatter(page);
  const kept: string[] = [];
  let inChapters = false;
  for (const line of front.split('\n')) {
    if (/^audio_chapters:/.test(line)) { inChapters = true; continue; }
    if (inChapters && /^(- |  )/.test(line)) continue;
    inChapters = false;
    if (/^audio_/.test(line)) continue;
    kept.push(line);
  }
  return `---\n${[...kept, ...audioFrontMatter(fields)].join('\n')}\n---\n${body}`;
}

/** Rendered by this assembler already, in this voice: nothing to do. */
export function hasCurrentAudio(page: string): boolean {
  return frontMatter(page).get('audio_voice') === VOICE_ID;
}

export function isLegacyIssue(name: string): boolean {
  const n = Number.parseInt(name, 10);
  return Number.isFinite(n) && n <= LAST_LEGACY_ISSUE && existsSync(`${SCRIPTS_DIR}${name}.txt`);
}

/** Every back-catalogue issue with a script, newest first. */
export function legacyIssues(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.slice(0, -4))
    .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10) || b.localeCompare(a));
}

export interface Prepared {
  name: string;
  episode: Episode;
  blocks: ScriptBlock[];
  chapters: string[];
}

/** What the assembler needs, from the page and the script. */
export function prepare(name: string, page: string): Prepared {
  const { get } = frontMatter(page);
  const n = Number.parseInt(name, 10);
  const number: number | string = /^\d+$/.test(name) ? n : name;
  const image = get('image');
  const episode: Episode = {
    number,
    title: legacyTitle(get('subject'), number),
    date: get('publish_date').slice(0, 10),
    coverSource: /^https?:\/\//.test(image) ? image : null,
  };
  const slug = /^\/archive\/([^/]+)\/?$/.exec(get('permalink'))?.[1];
  const blocks = legacyBlocks(readFileSync(`${SCRIPTS_DIR}${name}.txt`, 'utf8'), { number, slug });
  return { name, episode, blocks, chapters: blocks.filter((b) => b.chapter).map((b) => b.chapter!.title) };
}

export function audioFieldsOf(result: AudioResult): AudioFields {
  return {
    audio_url: result.url,
    audio_duration_seconds: result.durationSeconds,
    audio_byte_size: result.bytes,
    audio_voice: result.voice,
    audio_chapters_url: result.chaptersUrl,
    audio_transcript_url: result.transcriptUrl,
    audio_chapters: result.chapters,
  };
}

/** The three files are on the CDN at the sizes the render reported. */
export async function verifyPublished(result: AudioResult): Promise<string[]> {
  const problems: string[] = [];
  const head = async (url: string, bytes?: number) => {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return problems.push(`${url}: HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length'));
    if (bytes !== undefined && length !== bytes) problems.push(`${url}: ${length} bytes on the CDN, ${bytes} rendered`);
  };
  await head(result.url, result.bytes);
  await head(result.chaptersUrl);
  await head(result.transcriptUrl);
  return problems;
}

/**
 * The render is the right length for its script. Speech runs 10–20
 * characters a second here; outside 6–30 something was skipped or repeated.
 */
export function plausibleDuration(blocks: ScriptBlock[], seconds: number): string | null {
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  const rate = chars / Math.max(seconds, 1);
  return rate >= 6 && rate <= 30 ? null : `${chars} characters in ${seconds} s (${rate.toFixed(1)} chars/s) is not a plausible reading`;
}

export interface BackfillOutcome {
  name: string;
  result: AudioResult;
  page: string;
  problems: string[];
  seconds: number;
}

/**
 * Render one issue against its live page and return the page with the audio
 * fields in it — not yet committed, so a day's issues land as one commit.
 * Any problem found on the CDN or in the length leaves the page unchanged.
 */
export async function renderIssue(name: string, opts: { localOut?: string } = {}): Promise<BackfillOutcome> {
  if (!isLegacyIssue(name)) throw new Error(`${name}: not a back-catalogue issue (1–${LAST_LEGACY_ISSUE} and 140-special)`);
  const path = `${ARCHIVE_PATH}/${name}.md`;
  const live = opts.localOut ? readFileSync(`${ARCHIVE_DIR}${name}.md`, 'utf8') : await githubRepo.readFile(path);
  if (!live) throw new Error(`${name}: ${path} is not in the website repository`);
  const prepared = prepare(name, live);
  const started = Date.now();
  const result = await renderAudio(prepared.episode, prepared.blocks, { localOut: opts.localOut, banner: false });
  const problems: string[] = [];
  const length = plausibleDuration(prepared.blocks, result.durationSeconds);
  if (length) problems.push(length);
  if (!opts.localOut) problems.push(...(await verifyPublished(result)));
  return {
    name,
    result,
    page: problems.length ? live : withAudio(live, audioFieldsOf(result)),
    problems,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

/** Commit the pages of a day's issues to the website as one commit. */
export async function publishPages(outcomes: BackfillOutcome[]): Promise<githubRepo.PushResult | null> {
  const files = outcomes.filter((o) => !o.problems.length).map((o) => ({ path: `${ARCHIVE_PATH}/${o.name}.md`, content: o.page }));
  if (!files.length) return null;
  const names = outcomes.filter((o) => !o.problems.length).map((o) => `WT${o.name}`).join(', ');
  return githubRepo.putTree(files, `Audio edition for ${names} (back catalogue)`);
}
