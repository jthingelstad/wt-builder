/**
 * The mastered mp3 → a transcript draft, in Another's contract shape: plain
 * text, paragraphs on blank lines.
 *
 * whisper-1 (verbose, so the segment timings come back), chunked through
 * ffmpeg past ten minutes to stay under the API's 25 MB limit. Paragraphs
 * are cut on the speech's own pauses, which is what makes a published
 * transcript readable. The service drafts; Jamie reads it through, and the
 * send ships whatever the field says then.
 *
 * Ported from AT Builder (retired 2026-10-11), where it never ran for real.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { credentials } from '../config.ts';

export const MODEL = 'whisper-1';
/** ~9.6 MB at the mastered 128k: comfortably under 25 MB. */
export const CHUNK_SECONDS = 600;
/** A pause this long starts a new paragraph. */
export const PARAGRAPH_PAUSE = 1.25;

export interface Piece {
  /** Seconds from the start of the whole recording. */
  start: number;
  end: number;
  text: string;
}

/**
 * Segments → paragraphs, cut on the speech's own seams: a pause of
 * PARAGRAPH_PAUSE or more starts a new paragraph, and a long one breaks at
 * the next sentence end past ~700 characters. Pure, so the seams are tested.
 */
export function paragraphs(pieces: Piece[]): string {
  const out: string[] = [];
  let current = '';
  let lastEnd: number | null = null;
  for (const piece of pieces) {
    const text = piece.text.trim();
    if (!text) continue;
    const pause = lastEnd !== null && piece.start - lastEnd >= PARAGRAPH_PAUSE;
    const overlong = current.length > 700 && /[.!?…]$/.test(current.trim());
    if (current && (pause || overlong)) {
      out.push(current.trim());
      current = '';
    }
    current = current ? `${current} ${text}` : text;
    lastEnd = piece.end;
  }
  if (current.trim()) out.push(current.trim());
  return out.join('\n\n');
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve('') : reject(new Error(`${cmd} exited ${code}: ${err.slice(-300)}`))));
  });
}

export function isConfigured(): boolean {
  return Boolean(credentials.openaiKey);
}

async function transcribeChunk(bytes: Buffer, offset: number): Promise<Piece[]> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }), 'chunk.mp3');
  form.append('model', MODEL);
  form.append('response_format', 'verbose_json');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${credentials.openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    throw new Error(`transcription failed: ${res.status} ${res.statusText} ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { segments?: { start: number; end: number; text: string }[]; text?: string };
  if (body.segments?.length) return body.segments.map((s) => ({ start: s.start + offset, end: s.end + offset, text: s.text }));
  return body.text ? [{ start: offset, end: offset, text: body.text }] : [];
}

/** Transcribe a mastered mp3 into contract-shaped paragraphs. */
export async function transcribe(mp3Path: string, durationSeconds: number): Promise<string> {
  if (!credentials.openaiKey) throw new Error('OPENAI_API_KEY is not configured — transcription needs it');
  if (durationSeconds <= CHUNK_SECONDS) return paragraphs(await transcribeChunk(await readFile(mp3Path), 0));

  // Stream-copied time chunks. A seam can clip a syllable; on a solo voice at
  // ten-minute seams that is rare, and Jamie's read-through owns the fix.
  const work = await mkdtemp(join(tmpdir(), 'wt-episode-transcribe-'));
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', mp3Path,
      '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), '-c', 'copy',
      join(work, 'chunk%03d.mp3'),
    ]);
    const chunks = (await readdir(work)).filter((f) => f.startsWith('chunk')).sort();
    const pieces: Piece[] = [];
    for (const [i, name] of chunks.entries()) {
      pieces.push(...await transcribeChunk(await readFile(join(work, name)), i * CHUNK_SECONDS));
    }
    return paragraphs(pieces);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
