/**
 * The audio edition, assembled.
 *
 * Text-to-speech through OpenAI, `tts-1-hd`, in the `echo` voice for Jamie
 * and `nova` for Thingy. The script comes from the audio renderer, so every
 * word spoken is a word the renderer chose.
 *
 * Each script block is synthesized on its own and the programme is assembled
 * from the pieces with measured silence between them. The renderer says what
 * kind of boundary each block sits on; `PAUSE` says how long that is. This is
 * what the synthesizer cannot do itself — a blank line in its input is not a
 * pause (WT350, measured 2026-09-21) — and it is what makes the pauses fall
 * where the structure is rather than where a 3,800-character chunk happened
 * to end. Because the pieces are placed by hand, the assembler also knows
 * when every block starts, which is where the chapters and the transcript
 * come from.
 *
 * Pieces are cached by content: regenerating an issue after a wording fix
 * pays for the blocks that changed and nothing else.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { IssueDoc } from '../../shared/types.ts';
import type { Boundary, Chapter, ScriptBlock, Speaker } from '../../shared/render/audio.ts';
import { pronounce } from '../../shared/render/speech.ts';
import { config, credentials } from '../config.ts';
import { CDN_HOST } from './images.ts';
import { buildCover, squareArt } from './cover.ts';
import { subjectFor } from '../publish.ts';

export const TTS_MODEL = 'tts-1-hd';
export const TTS_VOICE = 'echo';
/**
 * Thingy's voice — chosen by ear against echo on 2026-09-20 (nova, on the
 * same model; gpt-4o-mini-tts lost on sound). A different voice is the
 * audio edition's different font.
 */
export const THINGY_VOICE = 'nova';
export const VOICES: Record<Speaker, string> = { jamie: TTS_VOICE, thingy: THINGY_VOICE };
/**
 * Delivery pace, as the speech endpoint's `speed`. tts-1-hd reads at about
 * 200 words a minute at 1.0 — quick for a listen. To be settled by ear with
 * `npm run voice:samples`; nothing below depends on the value.
 */
export const TTS_SPEED = 1.0;
/** The voice string recorded on the issue, matching Studio's manifest format. */
export const VOICE_ID = `openai-${TTS_MODEL}:${TTS_VOICE}+${THINGY_VOICE}`;

/**
 * Silence between blocks, in seconds, by the boundary the renderer put there.
 * A sentence inside a block keeps the synthesizer's own timing; these are the
 * pauses the synthesizer would not make.
 */
export const PAUSE: Record<Boundary, number> = {
  none: 0,
  section: 1.4,
  lead: 0.6,
  item: 0.9,
  paragraph: 0.5,
  line: 0.7,
};

/**
 * Each piece keeps this much of its own room tone at either end when its
 * leading and trailing silence is trimmed, so a pause is the piece's own
 * quiet plus the inserted silence, not a hard digital cut into nothing.
 */
export const PIECE_HEAD_S = 0.1;
export const PIECE_TAIL_S = 0.15;
/** The synthesizer's own rate; pieces are assembled at it and mastered up. */
const PIECE_RATE = 24000;
/** Synthesis calls in flight at once. Pricing is per character, so this is only latency. */
const CONCURRENCY = 3;

/**
 * Loudness normalization, matching Studio's shipped values. -16 LUFS is the
 * podcast convention, and the two-pass form (measure, then normalize with the
 * measurements) is what makes it linear rather than dynamic — dynamic
 * normalization pumps on speech.
 */
export const LOUDNORM_I = -16.0;
export const LOUDNORM_TP = -1.5;
export const LOUDNORM_LRA = 11.0;
export const LOUDNORM_VERSION = 'v4';
/** Rolls off TTS rumble below the voice. */
export const HIGHPASS_HZ = 80;

export const FINAL_SAMPLE_RATE = 44100;
export const FINAL_CHANNELS = 1;
export const FINAL_BITRATE = '192k';

const ID3 = {
  artist: 'Jamie Thingelstad',
  album: 'The Weekly Thing',
  album_artist: 'Jamie Thingelstad',
  genre: 'Technology',
  comment:
    'AI-generated audio version of The Weekly Thing newsletter. weekly.thingelstad.com',
};

/** The per-issue ID3 tags, built from what the issue already knows. */
export function id3Tags(doc: IssueDoc): Record<string, string> {
  return {
    title: subjectFor(doc),
    artist: ID3.artist,
    album: ID3.album,
    album_artist: ID3.album_artist,
    date: doc.issue.publication_date,
    genre: ID3.genre,
    track: String(doc.issue.number),
    comment: ID3.comment,
  };
}

function requireKey(): string {
  const key = credentials.openaiKey;
  if (!key) throw new Error('OPENAI_API_KEY is not configured');
  return key;
}

export function isConfigured(): boolean {
  return Boolean(credentials.openaiKey);
}

export interface SpeakOptions {
  voice?: string;
  model?: string;
  speed?: number;
  /** Delivery direction; honoured by the gpt-4o-mini-tts family, ignored by tts-1. */
  instructions?: string;
}

export async function speak(text: string, opts: SpeakOptions | string = {}): Promise<Buffer> {
  const o = typeof opts === 'string' ? { voice: opts } : opts;
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: o.model ?? TTS_MODEL,
      voice: o.voice ?? TTS_VOICE,
      input: text,
      response_format: 'mp3',
      ...(o.speed !== undefined && o.speed !== 1 ? { speed: o.speed } : {}),
      ...(o.instructions ? { instructions: o.instructions } : {}),
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`OpenAI speech failed: ${res.status} ${res.statusText} ${detail.slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

/** The cache key: what is said, by whom, how. Anything else about the run is not the piece. */
export function pieceKey(text: string, voice: string, model = TTS_MODEL, speed = TTS_SPEED): string {
  return createHash('sha256').update(`${model}|${voice}|${speed}|${text}`).digest('hex').slice(0, 32);
}

/**
 * Speak one block, from the cache when it has been said before. Rate limits
 * are retried with a backoff; anything else is the caller's failure.
 */
async function speakCached(text: string, voice: string, cacheDir: string): Promise<{ path: string; fresh: boolean }> {
  const path = join(cacheDir, `${pieceKey(text, voice)}.mp3`);
  if (existsSync(path)) return { path, fresh: false };
  let attempt = 0;
  for (;;) {
    try {
      const audio = await speak(text, { voice, speed: TTS_SPEED });
      await writeFile(path, audio);
      return { path, fresh: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if ((status === 429 || (status !== undefined && status >= 500)) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`)),
    );
  });
}

/** Exact duration, for placing pieces; the rounded one is for the feed. */
async function durationExact(path: string): Promise<number> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  return Number(out);
}

export async function durationSeconds(path: string): Promise<number> {
  return Math.round(await durationExact(path));
}

/** A chapter with the second it starts at. */
export interface TimedChapter extends Chapter {
  start: number;
}

export interface AudioResult {
  url: string;
  bytes: number;
  durationSeconds: number;
  voice: string;
  /** Blocks synthesized, and how many of them were not already in the cache. */
  pieces: number;
  synthesized: number;
  loudnormVersion: string;
  coverUrl: string;
  coverSource: string;
  chaptersUrl: string;
  transcriptUrl: string;
  chapters: TimedChapter[];
}

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/**
 * Pass one: measure. loudnorm prints its measurements as JSON on stderr, which
 * pass two consumes so the correction is linear — a single-pass loudnorm is
 * dynamic and audibly pumps on speech.
 */
async function measureLoudness(path: string): Promise<LoudnormMeasurement> {
  const stderr = await runCapturingStderr('ffmpeg', [
    '-hide_banner', '-nostats', '-i', path,
    '-af', `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:print_format=json`,
    '-f', 'null', '-',
  ]);

  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('could not parse loudnorm measurements from ffmpeg');
  }
  const parsed = JSON.parse(stderr.slice(start, end + 1)) as Partial<LoudnormMeasurement>;

  const required = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const;
  const missing = required.filter((k) => parsed[k] === undefined);
  if (missing.length) {
    throw new Error(`loudnorm measurements missing: ${missing.join(', ')}`);
  }
  return parsed as LoudnormMeasurement;
}

function runCapturingStderr(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    // loudnorm's measurement pass writes to a null muxer; a non-zero exit is a
    // real failure, but the measurements we want are on stderr either way.
    proc.on('close', (code) =>
      code === 0 ? resolve(err) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`)),
    );
  });
}

/** A concat-demuxer list: one `file` line per path, single quotes escaped. */
function concatList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
}

/** `hh:mm:ss.mmm`, the WebVTT clock. */
export function vttClock(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

/** A placed block: where it starts and ends in the programme. */
export interface PlacedBlock {
  block: ScriptBlock;
  start: number;
  end: number;
}

/**
 * The transcript, as WebVTT: one cue per block, the speaker named, so
 * Thingy's words are attributed in the transcript as they are in the voice.
 */
export function transcriptVtt(placed: PlacedBlock[]): string {
  const cues = placed.map(({ block, start, end }) => {
    const who = block.speaker === 'thingy' ? 'Thingy' : 'Jamie';
    const text = block.text.replace(/-->/g, '→').replace(/\s*\n\s*/g, ' ');
    return `${vttClock(start)} --> ${vttClock(end)}\n<v ${who}>${text}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** The chapters, from the blocks that begin one, timed by where they landed. */
export function chaptersOf(placed: PlacedBlock[]): TimedChapter[] {
  return placed
    .filter((p) => p.block.chapter)
    .map((p) => ({ ...p.block.chapter!, start: Math.round(p.start * 1000) / 1000 }));
}

/** Podcasting 2.0 chapters — the form the players that show links read. */
export function chaptersJson(chapters: TimedChapter[]): string {
  return JSON.stringify({
    version: '1.2.0',
    chapters: chapters.map((c) => ({
      startTime: c.start,
      title: c.title,
      ...(c.url ? { url: c.url } : {}),
      ...(c.image ? { img: c.image } : {}),
    })),
  }, null, 2) + '\n';
}

/** ffmetadata escaping: `=`, `;`, `#`, `\` and newline are special. */
function ffEscape(s: string): string {
  return s.replace(/[\\=;#\n]/g, (c) => (c === '\n' ? '\\\n' : `\\${c}`));
}

/** The ID3 tags and the chapters, as one ffmetadata file for the final encode. */
export function ffMetadata(tags: Record<string, string>, chapters: TimedChapter[], totalSeconds: number): string {
  const lines = [';FFMETADATA1'];
  for (const [k, v] of Object.entries(tags)) lines.push(`${k}=${ffEscape(v)}`);
  chapters.forEach((c, i) => {
    const end = chapters[i + 1]?.start ?? totalSeconds;
    if (end <= c.start) return;
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.start * 1000)}`, `END=${Math.round(end * 1000)}`, `title=${ffEscape(c.title)}`);
  });
  return lines.join('\n') + '\n';
}

/**
 * Synthesize every block, place the pieces with their pauses, gain-match the
 * voices, master, tag, chapter, embed the cover, write the transcript, and
 * upload all three under a content-addressed name. The files live only on
 * the CDN.
 *
 * The name carries a hash of the mp3: the CDN serves these immutable for a
 * year, so a regenerated issue must be a new object, and the page and feed
 * move to it when the website leg re-sends.
 */
export async function renderAudio(
  doc: IssueDoc,
  blocks: ScriptBlock[],
  opts: {
    /** Write the three files here instead of the CDN — a dry run that costs only the synthesis. */
    localOut?: string;
  } = {},
): Promise<AudioResult> {
  const issueNumber = doc.issue.number;
  if (!blocks.length) throw new Error('the audio script is empty');

  for (const tool of ['ffmpeg', 'ffprobe']) {
    // Spawned processes inherit a minimal PATH under launchd; fail loudly here
    // rather than half-way through a paid synthesis run.
    await run(tool, ['-version']).catch(() => {
      throw new Error(`${tool} is required for audio and was not found on PATH`);
    });
  }

  // Build the cover before paying for synthesis: a missing cover should fail
  // the send cheaply, not after a hundred TTS calls.
  const cover = await buildCover(doc, { upload: !opts.localOut });

  await mkdir(config.ttsCacheDir, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), `wt-audio-${issueNumber}-`));
  try {
    const coverPath = join(work, 'cover.jpg');
    await writeFile(coverPath, cover.square);

    // 1. Speech, one piece per block, from the cache where it has been said.
    const spoken = await mapLimit(blocks, CONCURRENCY, (b) =>
      speakCached(pronounce(b.text), VOICES[b.speaker ?? 'jamie'], config.ttsCacheDir));
    const synthesized = spoken.filter((s) => s.fresh).length;

    // 2. Each piece to PCM at the synthesizer's rate, its own dead air
    //    trimmed to a small margin so the pauses are the ones placed below.
    const trim =
      `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=${PIECE_HEAD_S},` +
      `areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=${PIECE_TAIL_S},areverse`;
    const pieces = await mapLimit(spoken, 4, async (s, i) => {
      const path = join(work, `piece-${String(i).padStart(3, '0')}.wav`);
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', s.path,
        '-af', trim, '-ar', String(PIECE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', path]);
      return path;
    });

    // 3. Gain-match Thingy to Jamie. The final loudnorm is linear, so a level
    //    difference between the two voices would survive it.
    const bySpeaker = (who: Speaker) => pieces.filter((_, i) => (blocks[i]!.speaker ?? 'jamie') === who);
    if (bySpeaker('thingy').length) {
      const level = async (who: Speaker) => {
        const list = join(work, `${who}.txt`);
        await writeFile(list, concatList(bySpeaker(who)));
        const wav = join(work, `${who}.wav`);
        await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', wav]);
        return Number((await measureLoudness(wav)).input_i);
      };
      const offset = (await level('jamie')) - (await level('thingy'));
      if (Math.abs(offset) >= 0.5) {
        await mapLimit(pieces.map((p, i) => [p, i] as const).filter(([, i]) => blocks[i]!.speaker === 'thingy'), 4,
          async ([p]) => {
            const matched = `${p}.matched.wav`;
            await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', p, '-af', `volume=${offset.toFixed(2)}dB`, matched]);
            await run('mv', [matched, p]);
          });
      }
    }

    // 4. Place: pause, piece, pause, piece. The pauses are files of silence,
    //    one per distinct length, so the concat is a plain list.
    const silences = new Map<number, string>();
    const silence = async (seconds: number) => {
      const have = silences.get(seconds);
      if (have) return have;
      const path = join(work, `silence-${seconds}.wav`);
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', `anullsrc=r=${PIECE_RATE}:cl=mono`, '-t', String(seconds), '-c:a', 'pcm_s16le', path]);
      silences.set(seconds, path);
      return path;
    };
    const durations = await mapLimit(pieces, 4, durationExact);
    const parts: string[] = [];
    const placed: PlacedBlock[] = [];
    let t = 0;
    for (const [i, block] of blocks.entries()) {
      const pause = i === 0 ? 0 : PAUSE[block.pauseBefore];
      if (pause > 0) {
        parts.push(await silence(pause));
        t += pause;
      }
      parts.push(pieces[i]!);
      placed.push({ block, start: t, end: t + durations[i]! });
      t += durations[i]!;
    }
    const listPath = join(work, 'concat.txt');
    await writeFile(listPath, concatList(parts));
    const rawPath = join(work, 'raw.wav');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', rawPath]);
    const total = await durationExact(rawPath);

    // 5. Master: measure the whole programme, then normalize linearly.
    const measured = await measureLoudness(rawPath);
    const filter =
      `highpass=f=${HIGHPASS_HZ},` +
      `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}` +
      `:measured_I=${measured.input_i}` +
      `:measured_TP=${measured.input_tp}` +
      `:measured_LRA=${measured.input_lra}` +
      `:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}` +
      `:linear=true:print_format=summary`;

    const chapters = chaptersOf(placed);
    // Chapter art, squared and content-addressed. Each distinct picture is
    // fetched and cropped once; the chapter points at the square.
    const art = new Map<string, { key: string; body: Buffer }>();
    for (const c of chapters) {
      if (!c.image) continue;
      let have = art.get(c.image);
      if (!have) {
        const res = await fetch(c.image, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`chapter art ${c.image}: ${res.status}`);
        const squared = await squareArt(Buffer.from(await res.arrayBuffer()));
        const hash = createHash('sha256').update(squared).digest('hex').slice(0, 12);
        have = { key: `weekly-thing/${issueNumber}/chapters/${hash}.jpg`, body: squared };
        art.set(c.image, have);
      }
      c.image = have.key;
    }
    const metaPath = join(work, 'metadata.txt');
    await writeFile(metaPath, ffMetadata(id3Tags(doc), chapters, total));

    const outPath = join(work, `weekly-thing-${issueNumber}.mp3`);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', rawPath,
      '-i', coverPath,
      '-i', metaPath,
      '-map', '0:a', '-map', '1:v',
      '-map_metadata', '2', '-map_chapters', '2',
      '-c:v', 'copy', '-disposition:v', 'attached_pic',
      '-af', filter,
      '-ar', String(FINAL_SAMPLE_RATE),
      '-ac', String(FINAL_CHANNELS),
      '-c:a', 'libmp3lame',
      '-b:a', FINAL_BITRATE,
      '-write_xing', '1',
      '-id3v2_version', '3',
      '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)',
      outPath,
    ]);

    const body = await readFile(outPath);
    const seconds = await durationSeconds(outPath);
    const stamp = createHash('sha256').update(body).digest('hex').slice(0, 8);
    const base = `weekly-thing/${issueNumber}/weekly-thing-${issueNumber}-${stamp}`;
    const transcript = transcriptVtt(placed);

    let href = (key: string) => `https://${CDN_HOST}/${key}`;
    if (opts.localOut) {
      await mkdir(opts.localOut, { recursive: true });
      href = (key: string) => `file://${join(opts.localOut!, key.split('/').pop()!)}`;
    }
    for (const c of chapters) if (c.image) c.image = href(c.image);
    const chaptersFile = chaptersJson(chapters);

    if (opts.localOut) {
      const name = base.split('/').pop()!;
      await writeFile(join(opts.localOut, `${name}.mp3`), body);
      await writeFile(join(opts.localOut, `${name}.chapters.json`), chaptersFile);
      await writeFile(join(opts.localOut, `${name}.vtt`), transcript);
      for (const a of art.values()) await writeFile(join(opts.localOut, a.key.split('/').pop()!), a.body);
    } else {
      const s3 = new S3Client({ region: config.awsRegion });
      const put = (key: string, Body: Buffer | string, ContentType: string) =>
        s3.send(new PutObjectCommand({
          Bucket: CDN_HOST, Key: key, Body, ContentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }));
      for (const a of art.values()) await put(a.key, a.body, 'image/jpeg');
      await put(`${base}.mp3`, body, 'audio/mpeg');
      await put(`${base}.chapters.json`, chaptersFile, 'application/json+chapters');
      await put(`${base}.vtt`, transcript, 'text/vtt');
    }

    return {
      url: href(`${base}.mp3`),
      bytes: body.length,
      durationSeconds: seconds,
      voice: VOICE_ID,
      pieces: blocks.length,
      synthesized,
      loudnormVersion: LOUDNORM_VERSION,
      coverUrl: cover.bannerUrl,
      coverSource: cover.source,
      chaptersUrl: href(`${base}.chapters.json`),
      transcriptUrl: href(`${base}.vtt`),
      chapters,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
