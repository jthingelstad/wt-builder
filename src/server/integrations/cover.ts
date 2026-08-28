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

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

export function bannerKey(issueNumber: number): string {
  return `weekly-thing/${issueNumber}/cover.jpg`;
}

export function bannerUrl(issueNumber: number): string {
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

async function sourceBytes(doc: IssueDoc): Promise<{ bytes: Buffer; from: string }> {
  const url = coverSource(doc);
  if (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (res.ok) {
      return { bytes: Buffer.from(await res.arrayBuffer()), from: url };
    }
    console.warn(`[cover] could not fetch ${url}: ${res.status}; falling back to show art`);
  }
  if (!existsSync(SHOW_ART)) {
    throw new Error(
      `no photo in this issue and no show art at ${SHOW_ART}; add assets/podcast-cover.png`,
    );
  }
  return { bytes: await readFile(SHOW_ART), from: 'show art' };
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
export async function buildCover(doc: IssueDoc): Promise<CoverResult> {
  const { bytes, from } = await sourceBytes(doc);

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

  await new S3Client({ region: config.awsRegion }).send(
    new PutObjectCommand({
      Bucket: CDN_HOST,
      Key: bannerKey(doc.issue.number),
      Body: banner,
      ContentType: 'image/jpeg',
      // The banner can change while an issue is still being edited, so this is
      // deliberately not immutable the way a content-addressed image is.
      CacheControl: 'public, max-age=3600',
    }),
  );

  return { bannerUrl: bannerUrl(doc.issue.number), square, source: from };
}
