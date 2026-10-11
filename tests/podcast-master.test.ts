/**
 * Mastering, for real: a generated stereo recording through ffmpeg, then
 * the result read back with ffprobe and measured again. Skipped where
 * ffmpeg is not installed (CI); it runs on the Mac that masters episodes.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { EpisodeDoc } from '../src/shared/podcast/types.ts';

const work = mkdtempSync(join(tmpdir(), 'wt-podcast-master-'));
process.env.WT_BUILDER_DB ??= join(work, 'never-opened.db');
process.env.WT_BUILDER_EPISODE_AUDIO = join(work, 'audio');
const { master, tagged, LOUDNORM_I } = await import('../src/server/podcast/master.ts');

const present = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

afterAll(() => rmSync(work, { recursive: true, force: true }));

function probe(path: string) {
  const out = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=channels,sample_rate,bit_rate:format_tags=title,track,album', '-of', 'json', path], { encoding: 'utf8' });
  return JSON.parse(out.stdout) as { streams: { channels: number; sample_rate: string; bit_rate: string }[]; format: { tags?: Record<string, string> } };
}

function loudness(path: string): number {
  const err = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  return Number(JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1)).input_i);
}

const doc = {
  schema_version: 1,
  episode: { id: 'at7', number: 7, title: 'A test tone', slug: 'a-test-tone', summary: '', date: '2026-10-11T19:00:00-05:00', status: 'draft' },
  segments: [], notes: [],
} as EpisodeDoc;

describe.runIf(present)('mastering with ffmpeg', () => {
  it('masters a quiet stereo 48k recording to -16 LUFS mono 44.1k 128k, tagged', async () => {
    const src = join(work, 'take.wav');
    // Twelve seconds of a quiet stereo tone: about -30 LUFS, well below the target.
    const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=12',
      '-af', 'volume=0.03', '-ac', '2', '-c:a', 'pcm_s24le', src]);
    expect(made.status).toBe(0);

    const result = await master(doc, src);
    expect(result.durationSeconds).toBe(12);

    const p = probe(result.path);
    expect(p.streams[0]!.channels).toBe(1);
    expect(p.streams[0]!.sample_rate).toBe('44100');
    expect(Math.round(Number(p.streams[0]!.bit_rate) / 1000)).toBe(128);
    expect(p.format.tags?.title).toBe('A test tone');
    expect(p.format.tags?.album).toBe('Another Thing');
    expect(Math.abs(loudness(result.path) - LOUDNORM_I)).toBeLessThan(1.5);
  }, 60_000);

  it('re-tags the master with the episode as it stands, without re-encoding', async () => {
    const renamed = { ...doc, episode: { ...doc.episode, title: 'A better title', number: 8 } };
    const body = await tagged(renamed);
    const out = join(work, 'retagged.mp3');
    (await import('node:fs')).writeFileSync(out, body);
    const p = probe(out);
    expect(p.format.tags?.title).toBe('A better title');
    expect(p.format.tags?.track).toBe('8');
    expect(p.streams[0]!.channels).toBe(1);
  }, 60_000);
});
