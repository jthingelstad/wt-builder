/**
 * Mastering an episode: the audio tail of the newsletter's podcast, without
 * the synthesis. Jamie's edited recording arrives as a file, in whatever
 * ffmpeg reads (wav, aiff, m4a, mp3); what this owns is two-pass loudnorm
 * to podcast levels (linear, so it never pumps on speech), a gentle
 * highpass under the voice, mono at broadcast rate, and ID3v2.3 tags.
 * No chapters and no cover art: the feed carries the show's art.
 *
 * Ported from AT Builder (retired 2026-10-11), where it had never run
 * against a real recording.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EpisodeDoc } from '../../shared/podcast/types.ts';
import { config } from '../config.ts';

export const LOUDNORM_I = -16.0;
export const LOUDNORM_TP = -1.5;
export const LOUDNORM_LRA = 11.0;
export const HIGHPASS_HZ = 80;
export const FINAL_SAMPLE_RATE = 44100;
export const FINAL_CHANNELS = 1;
export const FINAL_BITRATE = '128k';

/** The episode's ID3 tags, from what the episode knows now. */
export function id3Tags(doc: EpisodeDoc): Record<string, string> {
  return {
    title: doc.episode.title,
    artist: 'Jamie Thingelstad',
    album: 'Another Thing',
    album_artist: 'Jamie Thingelstad',
    track: String(doc.episode.number),
    date: (doc.episode.date ?? '').slice(0, 4),
    comment: 'Another Thing, a podcast by Jamie Thingelstad. another.thingelstad.com',
  };
}

/**
 * Where an episode's mastered mp3 waits until the send commits it: keyed by
 * the episode's id, which never changes, so renumbering a draft cannot
 * strand its audio.
 */
export function masteredPath(id: string): string {
  return join(config.episodeAudioDir, `${id}.mp3`);
}

function run(cmd: string, args: string[], captureStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (captureStderr && code === 0) return resolve(err);
      if (code === 0) return resolve(out.trim());
      reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`));
    });
  });
}

/** Are ffmpeg and ffprobe on PATH? */
export async function toolsPresent(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

export async function durationSeconds(path: string): Promise<number> {
  const out = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ]);
  const seconds = Number(out);
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read a duration from ${path}`);
  return Math.round(seconds);
}

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** Pass one: measure, so pass two's correction is linear rather than dynamic. */
async function measure(path: string): Promise<LoudnormMeasurement> {
  const stderr = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', path,
    '-af', `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:print_format=json`,
    '-f', 'null', '-',
  ], true);
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('could not parse loudnorm measurements');
  return JSON.parse(stderr.slice(start, end + 1)) as LoudnormMeasurement;
}

export interface MasterResult {
  path: string;
  bytes: number;
  durationSeconds: number;
}

/**
 * Master the dropped recording (`src`, a file the route streamed the upload
 * into) into the episode's mp3, replacing any earlier master only once the
 * new one is complete.
 */
export async function master(doc: EpisodeDoc, src: string): Promise<MasterResult> {
  if (!(await toolsPresent())) throw new Error('ffmpeg and ffprobe are required and were not found on PATH');

  const work = await mkdtemp(join(tmpdir(), `wt-episode-${doc.episode.id}-`));
  try {
    const m = await measure(src);
    const filter =
      `highpass=f=${HIGHPASS_HZ},` +
      `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}` +
      `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
      `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}` +
      ':linear=true:print_format=summary';

    const out = join(work, 'mastered.mp3');
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-map', '0:a:0', '-af', filter,
      '-ar', String(FINAL_SAMPLE_RATE), '-ac', String(FINAL_CHANNELS),
      '-c:a', 'libmp3lame', '-b:a', FINAL_BITRATE,
      '-write_xing', '1', '-id3v2_version', '3',
    ];
    for (const [key, value] of Object.entries(id3Tags(doc))) args.push('-metadata', `${key}=${value}`);
    args.push(out);
    await run('ffmpeg', args);

    const seconds = await durationSeconds(out);
    const body = await readFile(out);
    await mkdir(config.episodeAudioDir, { recursive: true });
    const dest = masteredPath(doc.episode.id);
    // Write beside, then rename over: a failed master never leaves half a file.
    await writeFile(`${dest}.part`, body);
    await rename(`${dest}.part`, dest);
    return { path: dest, bytes: body.length, durationSeconds: seconds };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * The mastered mp3 with tags for the episode as it stands now: a title or
 * number changed after mastering is in the file that goes out. Stream copy,
 * no re-encode.
 */
export async function tagged(doc: EpisodeDoc): Promise<Buffer> {
  const src = masteredPath(doc.episode.id);
  const work = await mkdtemp(join(tmpdir(), `wt-episode-tag-${doc.episode.id}-`));
  try {
    const out = join(work, 'tagged.mp3');
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map', '0:a', '-c', 'copy', '-map_metadata', '-1',
      '-id3v2_version', '3', '-write_xing', '1'];
    for (const [key, value] of Object.entries(id3Tags(doc))) args.push('-metadata', `${key}=${value}`);
    args.push(out);
    await run('ffmpeg', args);
    return await readFile(out);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
