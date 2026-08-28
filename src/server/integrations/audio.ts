/**
 * The audio edition.
 *
 * Text-to-speech through OpenAI, matching what Studio has shipped for years:
 * `tts-1-hd` in the `echo` voice. The script comes from the audio renderer, so
 * every word spoken is a word the renderer chose — the flattened-Markdown path
 * Studio used is not inherited (AGENTS.md, Guardrails).
 *
 * Long scripts are chunked, synthesized chunk by chunk, and concatenated with
 * ffmpeg, with the standing intro and outro bumpers wrapped around the body.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { IssueDoc } from '../../shared/types.ts';
import { config, credentials } from '../config.ts';
import { CDN_HOST } from './images.ts';
import { buildCover } from './cover.ts';
import { subjectFor } from '../publish.ts';

export const TTS_MODEL = 'tts-1-hd';
export const TTS_VOICE = 'echo';
/** The voice string recorded on the issue, matching Studio's manifest format. */
export const VOICE_ID = `openai-${TTS_MODEL}:${TTS_VOICE}`;

/** OpenAI caps a single speech request; Studio settled on this chunk size. */
export const MAX_CHARS = 3800;

/**
 * Loudness normalization, matching Studio's shipped values. -16 LUFS is the
 * podcast convention, and the two-pass form (measure, then normalize with the
 * measurements) is what makes it linear rather than dynamic — dynamic
 * normalization pumps on speech.
 */
export const LOUDNORM_I = -16.0;
export const LOUDNORM_TP = -1.5;
export const LOUDNORM_LRA = 11.0;
export const LOUDNORM_VERSION = 'v3';
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

/**
 * Split a script on paragraph boundaries, never mid-sentence: a chunk seam is
 * audible, so it belongs where a pause already is.
 */
export function chunkScript(text: string, maxChars = MAX_CHARS): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      // A single paragraph over the cap: split on sentence ends.
      let sentence = '';
      for (const piece of para.split(/(?<=[.!?])\s+/)) {
        if ((sentence + ' ' + piece).trim().length > maxChars) {
          if (sentence.trim()) chunks.push(sentence.trim());
          sentence = piece;
        } else {
          sentence = sentence ? `${sentence} ${piece}` : piece;
        }
      }
      if (sentence.trim()) chunks.push(sentence.trim());
      continue;
    }
    if ((current + '\n\n' + para).trim().length > maxChars) flush();
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();
  return chunks;
}

async function speak(text: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI speech failed: ${res.status} ${res.statusText} ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
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

export async function durationSeconds(path: string): Promise<number> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  return Math.round(Number(out));
}

export interface AudioResult {
  url: string;
  bytes: number;
  durationSeconds: number;
  voice: string;
  chunks: number;
  loudnormVersion: string;
  coverUrl: string;
  coverSource: string;
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

/**
 * Synthesize the script, wrap it in the bumpers, normalize, tag, embed the
 * cover, upload, and return the reference the website publishes. The file
 * itself lives only on the CDN.
 */
export async function renderAudio(
  doc: IssueDoc,
  script: string,
  opts: { bumpersDir?: string } = {},
): Promise<AudioResult> {
  const issueNumber = doc.issue.number;

  for (const tool of ['ffmpeg', 'ffprobe']) {
    // Spawned processes inherit a minimal PATH under launchd; fail loudly here
    // rather than half-way through a paid synthesis run.
    await run(tool, ['-version']).catch(() => {
      throw new Error(`${tool} is required for audio and was not found on PATH`);
    });
  }

  const chunks = chunkScript(script);
  if (!chunks.length) throw new Error('the audio script is empty');

  // Build the cover before paying for synthesis: a missing cover should fail
  // the send cheaply, not after ten TTS calls.
  const cover = await buildCover(doc);

  const work = await mkdtemp(join(tmpdir(), `wt-audio-${issueNumber}-`));
  try {
    const coverPath = join(work, 'cover.jpg');
    await writeFile(coverPath, cover.square);

    const parts: string[] = [];

    const intro = opts.bumpersDir ? join(opts.bumpersDir, 'intro.mp3') : null;
    if (intro && existsSync(intro)) parts.push(intro);

    for (const [i, chunk] of chunks.entries()) {
      const audio = await speak(chunk);
      const path = join(work, `chunk-${String(i).padStart(3, '0')}.mp3`);
      await writeFile(path, audio);
      parts.push(path);
    }

    const outro = opts.bumpersDir ? join(opts.bumpersDir, 'outro.mp3') : null;
    if (outro && existsSync(outro)) parts.push(outro);

    const listPath = join(work, 'concat.txt');
    await writeFile(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));

    // Concat first, stream-copied, so normalization measures the whole
    // programme — bumpers included — rather than the body alone.
    const rawPath = join(work, 'raw.mp3');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', rawPath,
    ]);

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

    const outPath = join(work, `weekly-thing-${issueNumber}.mp3`);
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', rawPath,
      '-i', coverPath,
      '-map', '0:a', '-map', '1:v',
      '-c:v', 'copy', '-disposition:v', 'attached_pic',
      '-af', filter,
      '-ar', String(FINAL_SAMPLE_RATE),
      '-ac', String(FINAL_CHANNELS),
      '-c:a', 'libmp3lame',
      '-b:a', FINAL_BITRATE,
      '-write_xing', '1',
      '-id3v2_version', '3',
    ];
    for (const [key, value] of Object.entries(id3Tags(doc))) {
      args.push('-metadata', `${key}=${value}`);
    }
    args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
    args.push(outPath);
    await run('ffmpeg', args);

    const body = await readFile(outPath);
    const seconds = await durationSeconds(outPath);
    const key = `weekly-thing/${issueNumber}/weekly-thing-${issueNumber}.mp3`;

    await new S3Client({ region: config.awsRegion }).send(
      new PutObjectCommand({
        Bucket: CDN_HOST,
        Key: key,
        Body: body,
        ContentType: 'audio/mpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return {
      url: `https://${CDN_HOST}/${key}`,
      bytes: body.length,
      durationSeconds: seconds,
      voice: VOICE_ID,
      chunks: chunks.length,
      loudnormVersion: LOUDNORM_VERSION,
      coverUrl: cover.bannerUrl,
      coverSource: cover.source,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
