/**
 * The banner at weekly-thing/{N}/cover.jpg is live: the archive page and its
 * social card point at it. A cover built when the issue's photo could not be
 * fetched falls back to the show art for the mp3, and must leave the live
 * banner alone (review 2026-09-27, appendix: Audio). S3 and the network are mocked; nothing
 * here leaves the machine.
 */
import sharp from 'sharp';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  puts: [] as { Key?: string }[],
  heads: [] as { Key?: string }[],
  /** Whether weekly-thing/{N}/cover.jpg is already in the bucket. */
  bannerExists: true,
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const real = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...real,
    S3Client: class {
      async send(command: { input: { Key?: string } }) {
        if (command instanceof real.HeadObjectCommand) {
          h.heads.push(command.input);
          if (h.bannerExists) return {};
          throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        }
        h.puts.push(command.input);
        return {};
      }
    },
  };
});

const { buildCover, bannerKey } = await import('../src/server/integrations/cover.ts');

const PHOTO = 'https://files.thingelstad.com/weekly-thing/990/photo.jpg';
const realFetch = globalThis.fetch;
let answer: () => Promise<Response>;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== PHOTO) throw new Error(`the cover test reached off the machine: ${url}`);
  return answer();
}) as typeof fetch;

afterEach(() => { h.puts.length = 0; h.heads.length = 0; h.bannerExists = true; });
afterAll(() => { globalThis.fetch = realFetch; });

const jpeg = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).jpeg().toBuffer();

describe('the live banner', () => {
  it('is left alone when the issue photo cannot be fetched, and the mp3 gets the show art', async () => {
    answer = async () => new Response('gone', { status: 404 });
    const cover = await buildCover({ number: 990, coverSource: PHOTO });
    expect(cover.source).toBe('show art');
    expect(cover.square.length).toBeGreaterThan(0);
    expect(h.heads.map((p) => p.Key)).toEqual([bannerKey(990)]);
    expect(h.puts).toEqual([]);
  });

  it('is the show art when the photo cannot be fetched and there is no banner yet, so the page never points at nothing', async () => {
    h.bannerExists = false;
    answer = async () => new Response('gone', { status: 404 });
    const cover = await buildCover({ number: 990, coverSource: PHOTO });
    expect(cover.source).toBe('show art');
    expect(h.puts.map((p) => p.Key)).toEqual([bannerKey(990)]);
  });

  it('is replaced from the photo when the photo was fetched', async () => {
    const bytes = await jpeg();
    answer = async () => new Response(bytes, { status: 200 });
    const cover = await buildCover({ number: 990, coverSource: PHOTO });
    expect(cover.source).toBe(PHOTO);
    expect(h.puts.map((p) => p.Key)).toEqual([bannerKey(990)]);
  });

  it('is the show art when the issue has no photo', async () => {
    const cover = await buildCover({ number: 990, coverSource: null });
    expect(cover.source).toBe('show art');
    expect(h.puts.map((p) => p.Key)).toEqual([bannerKey(990)]);
  });
});
