/**
 * The audio edition for an issue that was never authored here.
 *
 *   npm run backfill:audio -- [--plan | --dry] [--write] <issue> [<issue> ...]
 *   npm run backfill:audio -- --all [--plan | --dry] [--write]
 *
 * Reads the issue's page in the sibling website checkout for what the
 * assembler needs to know (subject, date, cover), speaks the script in
 * `backfill/scripts/`, and uploads the mp3, chapters, and transcript under a
 * content-addressed name. The banner is never uploaded: the back catalogue's
 * covers are already on the CDN.
 *
 *   --plan   parse and count; no synthesis, no upload, no cost
 *   --dry    synthesize (pieces go to the store) but write the three files to
 *            tmp/backfill/<issue>/ instead of the CDN — the calibration listen
 *   --write  put the audio fields into the archive page's front matter; the
 *            website repository's own commit and deploy publish them
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderAudio, type Episode } from '../src/server/integrations/audio.ts';
import { audioFrontMatter, type AudioFields } from '../src/server/publish.ts';
import { legacyBlocks, legacyTitle } from '../src/shared/render/legacy-blocks.ts';

const root = new URL('..', import.meta.url);
const ARCHIVE = fileURLToPath(new URL('../weekly.thingelstad.com/apps/site/archive/', root));
const SCRIPTS = fileURLToPath(new URL('backfill/scripts/', root));
const LAST_LEGACY_ISSUE = 349;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const names = args.filter((a) => !a.startsWith('--'));
if (flag('--all')) {
  names.push(...readdirSync(SCRIPTS).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)));
}
if (!names.length) {
  console.error('usage: backfill-audio [--plan | --dry] [--write] <issue> ... | --all');
  process.exit(2);
}
const byNumber = (a: string, b: string) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b);
names.sort(byNumber);

/** The front-matter keys this needs, without a YAML dependency: they are all one-line scalars. */
function frontMatter(page: string): { front: string; body: string; get: (key: string) => string } {
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

/** The front matter with any earlier audio record removed and this one appended. */
function withAudio(page: string, fields: AudioFields): string {
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

for (const name of names) {
  const n = Number.parseInt(name, 10);
  if (!Number.isFinite(n) || n > LAST_LEGACY_ISSUE) {
    console.error(`${name}: not a back-catalogue issue (1–${LAST_LEGACY_ISSUE} and 140-special)`);
    process.exit(1);
  }
  const pagePath = `${ARCHIVE}${name}.md`;
  const scriptPath = `${SCRIPTS}${name}.txt`;
  if (!existsSync(pagePath) || !existsSync(scriptPath)) {
    console.error(`${name}: missing ${existsSync(pagePath) ? scriptPath : pagePath}`);
    process.exit(1);
  }
  const page = readFileSync(pagePath, 'utf8');
  const { get } = frontMatter(page);
  const number: number | string = /^\d+$/.test(name) ? n : name;
  const image = get('image');
  const episode: Episode = {
    number,
    title: legacyTitle(get('subject'), number),
    date: get('publish_date').slice(0, 10),
    coverSource: /^https?:\/\//.test(image) ? image : null,
  };
  const permalink = get('permalink');
  const slug = /^\/archive\/([^/]+)\/?$/.exec(permalink)?.[1];
  const blocks = legacyBlocks(readFileSync(scriptPath, 'utf8'), { number, slug });
  const chapters = blocks.filter((b) => b.chapter).map((b) => b.chapter!.title);

  if (flag('--plan')) {
    console.log(`${name}: ${blocks.length} blocks, ${chapters.length} chapters [${chapters.join(', ')}]; "${episode.title}", ${episode.date}, cover ${episode.coverSource ? 'from page' : 'show art'}`);
    continue;
  }

  let localOut: string | undefined;
  if (flag('--dry')) {
    localOut = fileURLToPath(new URL(`tmp/backfill/${name}/`, root));
    mkdirSync(localOut, { recursive: true });
  }
  const started = Date.now();
  const result = await renderAudio(episode, blocks, { localOut, banner: false });
  const minutes = (result.durationSeconds / 60).toFixed(1);
  console.log(`${name}: ${minutes} min, ${result.pieces} pieces (${result.synthesized} new), cover ${result.coverSource}, ${((Date.now() - started) / 1000).toFixed(0)} s → ${localOut ?? result.url}`);

  if (flag('--write') && !localOut) {
    writeFileSync(pagePath, withAudio(page, {
      audio_url: result.url,
      audio_duration_seconds: result.durationSeconds,
      audio_byte_size: result.bytes,
      audio_voice: result.voice,
      audio_chapters_url: result.chaptersUrl,
      audio_transcript_url: result.transcriptUrl,
      audio_chapters: result.chapters,
    }));
    console.log(`${name}: front matter written to ${pagePath}`);
  }
}
