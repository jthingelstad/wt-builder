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

import { config, credentials } from '../config.ts';
import { CDN_HOST } from './images.ts';

export const TTS_MODEL = 'tts-1-hd';
export const TTS_VOICE = 'echo';
/** The voice string recorded on the issue, matching Studio's manifest format. */
export const VOICE_ID = `openai-${TTS_MODEL}:${TTS_VOICE}`;

/** OpenAI caps a single speech request; Studio settled on this chunk size. */
export const MAX_CHARS = 3800;

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
}

/**
 * Synthesize the script, wrap it in the bumpers, upload, and return the
 * reference the website publishes. The file itself lives only on the CDN.
 */
export async function renderAudio(
  script: string,
  issueNumber: number,
  opts: { bumpersDir?: string } = {},
): Promise<AudioResult> {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    // Spawned processes inherit a minimal PATH under launchd; fail loudly here
    // rather than half-way through a paid synthesis run.
    await run(tool, ['-version']).catch(() => {
      throw new Error(`${tool} is required for audio and was not found on PATH`);
    });
  }

  const chunks = chunkScript(script);
  if (!chunks.length) throw new Error('the audio script is empty');

  const work = await mkdtemp(join(tmpdir(), `wt-audio-${issueNumber}-`));
  try {
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

    const outPath = join(work, `weekly-thing-${issueNumber}.mp3`);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-c', 'copy', outPath,
    ]);

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
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
