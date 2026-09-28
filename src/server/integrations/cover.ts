/**
 * Cover art.
 *
 * Two shapes come out of one source image:
 *
 * - a 1200x675 landscape banner at `weekly-thing/{N}/cover.jpg`, which is what
 *   the archive page's `image` field points at and what social cards use;
 * - a 3000x3000 square, which is what gets embedded in the mp3, because
 *   podcast art conventions are square and Apple Podcasts wants 1400-3000.
 *
 * Studio only ever *resolved* a per-issue cover — it downloaded whatever was
 * already at that URL and squared it, so something upstream had to have put a
 * file there. WT Builder makes it: the issue's own photo is the cover, and the
 * show art is the fallback when an issue has no photo.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

import type { IssueDoc } from '../../shared/types.ts';
import { planEdition } from '../../shared/render/plan.ts';
import { config } from '../config.ts';
import { CDN_HOST } from './images.ts';

/** The archive page's social card. */
export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 675;

/** Apple Podcasts accepts 1400-3000 square; Studio's show art is 3000. */
export const SQUARE_SIZE = 3000;

export const JPEG_QUALITY = 86;

/** Where the show-level art lives when no issue photo is available. */
const SHOW_ART = fileURLToPath(new URL('../../../assets/podcast-cover.png', import.meta.url));

export function bannerKey(issueNumber: number | string): string {
  return `weekly-thing/${issueNumber}/cover.jpg`;
}

export function bannerUrl(issueNumber: number | string): string {
  return `https://${CDN_HOST}/${bannerKey(issueNumber)}`;
}

/** The issue's own photo, which is the cover unless there is none. */
export function coverSource(doc: IssueDoc): string | null {
  for (const planned of planEdition(doc, 'website')) {
    for (const { item } of planned.items) {
      if (item.type === 'photo' && item.media?.url) return item.media.url;
    }
  }
  return null;
}

/** The cover is what the issue is, and what is said. */
export interface CoverSubject {
  number: number | string;
  /** The picture the cover is cut from; null means the show art. */
  coverSource: string | null;
}

/**
 * The picture to cut the covers from. `fallback` is set when the issue has a
 * photo and it could not be fetched: the show art stands in for the mp3, but
 * it is not the issue's cover.
 */
async function sourceBytes(url: string | null): Promise<{ bytes: Buffer; from: string; fallback: boolean }> {
  if (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (res.ok) {
      return { bytes: Buffer.from(await res.arrayBuffer()), from: url, fallback: false };
    }
    console.warn(`[cover] could not fetch ${url}: ${res.status}; falling back to show art, and leaving any live banner as it is`);
  }
  if (!existsSync(SHOW_ART)) {
    throw new Error(
      `no photo in this issue and no show art at ${SHOW_ART}; add assets/podcast-cover.png`,
    );
  }
  return { bytes: await readFile(SHOW_ART), from: 'show art', fallback: Boolean(url) };
}

export interface CoverResult {
  /** The landscape banner, uploaded and referenced by the archive page. */
  bannerUrl: string;
  /** The square art, embedded in the mp3 rather than uploaded. */
  square: Buffer;
  source: string;
}

/**
 * Build both covers. `attention` cropping keeps the interesting part of a
 * photo in frame rather than centre-cropping through a subject's head.
 */
/**
 * Chapter art is shown in a square, like the cover, and smaller. Players
 * fill the frame, so a landscape photo handed over as-is is cropped by
 * whoever draws it — through a head as easily as not. Cropped here, with
 * the same attention strategy as the cover, it fills the frame on purpose.
 */
export const CHAPTER_ART_SIZE = 1000;

export async function squareArt(bytes: Buffer, size = CHAPTER_ART_SIZE): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    // JPEG has no alpha: a transparent PNG (Thingy's portrait) would come
    // out on black. The site's page colour is the background it sits on.
    .flatten({ background: '#fcfcfa' })
    .resize({ width: size, height: size, fit: 'cover', position: sharp.strategy.attention, withoutEnlargement: false })
    .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
    .toBuffer();
}

/**
 * Whether the issue's banner is already in the bucket. Anything but a clear
 * "not there" counts as there: the answer decides whether show art may be
 * written over it, and the safe mistake is to leave it.
 */
async function bannerExists(s3: S3Client, issueNumber: number | string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: CDN_HOST, Key: bannerKey(issueNumber) }));
    return true;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
    console.warn(`[cover] could not tell whether ${bannerKey(issueNumber)} exists (${(err as Error).message}); leaving it`);
    return true;
  }
}

export async function buildCover(subject: CoverSubject, opts: { upload?: boolean } = {}): Promise<CoverResult> {
  const { bytes, from, fallback } = await sourceBytes(subject.coverSource);

  const banner = await sharp(bytes)
    .rotate()
    .resize({
      width: BANNER_WIDTH,
      height: BANNER_HEIGHT,
      fit: 'cover',
      position: sharp.strategy.attention,
    })
    .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
    .toBuffer();

  const square = await sharp(bytes)
    .rotate()
    .resize({
      width: SQUARE_SIZE,
      height: SQUARE_SIZE,
      fit: 'cover',
      position: sharp.strategy.attention,
      withoutEnlargement: false,
    })
    .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
    .toBuffer();

  // A dry run of the audio must not touch the live banner: this once
  // replaced WT350's cover with the fixture's photo (2026-09-21). Nor must a
  // photo that failed to load: the show art stood in for it, and uploading
  // that would put show art over a real cover (review 2026-09-27, appendix: Audio). Only
  // when there is no banner yet does the show art go up, so the page and its
  // social card never point at a missing cover.jpg.
  const s3 = new S3Client({ region: config.awsRegion });
  if (opts.upload !== false && (!fallback || !(await bannerExists(s3, subject.number)))) await s3.send(
    new PutObjectCommand({
      Bucket: CDN_HOST,
      Key: bannerKey(subject.number),
      Body: banner,
      ContentType: 'image/jpeg',
      // The banner can change while an issue is still being edited, so this is
      // deliberately not immutable the way a content-addressed image is.
      CacheControl: 'public, max-age=3600',
    }),
  );

  return { bannerUrl: bannerUrl(subject.number), square, source: from };
}
