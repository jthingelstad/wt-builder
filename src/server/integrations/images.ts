/**
 * Image rehosting.
 *
 * Micro.blog serves the original upload: a photo displayed at 600px arrives as
 * a 1800x1350 JPEG weighing 2.6 MB. An issue with several photos would be tens
 * of megabytes of email. Every remote image an issue references is therefore
 * copied to files.thingelstad.com, resized, and re-encoded, and the item body
 * is rewritten to point at the copy.
 *
 * Rehosting is idempotent: the key is a hash of the source URL plus the render
 * settings, so re-running finds the object already there and skips the work.
 */

import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import exifReader from 'exif-reader';

import type { IssueDoc, Item } from '../../shared/types.ts';
import { config } from '../config.ts';

/**
 * 1200px wide, so a 600px display slot stays sharp on a 2x screen without
 * paying for the full original.
 */
export const MAX_WIDTH = 1200;
export const JPEG_QUALITY = 80;

/** Where rehosted images live, and how they are addressed publicly. */
export const CDN_HOST = 'files.thingelstad.com';

const s3 = () => new S3Client({ region: config.awsRegion });

export interface RehostedImage {
  original: string;
  url: string;
  bytes: number;
  width: number;
  height: number;
  savedBytes: number;
}

export interface RehostReport {
  rehosted: RehostedImage[];
  skipped: string[];
  failed: { url: string; error: string }[];
}

/** Already ours, so leave it alone. */
export function isRehosted(url: string): boolean {
  try {
    return new URL(url).hostname === CDN_HOST;
  } catch {
    return false;
  }
}

/**
 * Every image an item references: Markdown images, raw `<img>` tags (which is
 * how Micro.blog embeds photos in post source), and a Photo item's own media.
 */
export function imageUrls(item: Item): string[] {
  const found = new Set<string>();
  const body = String(item.body ?? '');

  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    if (m[1]) found.add(m[1]);
  }
  for (const m of body.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    if (m[1]) found.add(m[1]);
  }
  if (item.media?.url) found.add(item.media.url);

  return [...found].filter((u) => /^https?:\/\//i.test(u));
}

function keyFor(issueNumber: number, source: string): string {
  const hash = createHash('sha256')
    .update(`${source}|w=${MAX_WIDTH}|q=${JPEG_QUALITY}`)
    .digest('hex')
    .slice(0, 12);
  return `weekly-thing/${issueNumber}/images/${hash}.jpg`;
}

async function alreadyThere(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: CDN_HOST, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch, resize, re-encode, and store one image. Returns the public URL.
 * Images already on the CDN are returned unchanged.
 */
export async function rehost(source: string, issueNumber: number): Promise<RehostedImage> {
  const key = keyFor(issueNumber, source);
  const url = `https://${CDN_HOST}/${key}`;

  const res = await fetch(source, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`fetch ${source} failed: ${res.status} ${res.statusText}`);
  const original = Buffer.from(await res.arrayBuffer());

  const pipeline = sharp(original)
    // `withoutEnlargement` so a small image is re-encoded but never upscaled.
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  if (!(await alreadyThere(key))) {
    await s3().send(
      new PutObjectCommand({
        Bucket: CDN_HOST,
        Key: key,
        Body: data,
        ContentType: 'image/jpeg',
        // Content-addressed by URL and settings, so it can be cached hard.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  return {
    original: source,
    url,
    bytes: data.length,
    width: info.width,
    height: info.height,
    savedBytes: Math.max(0, original.length - data.length),
  };
}

/** Point every reference to `from` at `to`, in body text and in media. */
export function rewriteReferences(item: Item, from: string, to: string): void {
  if (item.body) item.body = item.body.split(from).join(to);
  if (item.media?.url === from) item.media.url = to;
}

/**
 * Rehost every image the issue references. Runs before a send so the email
 * carries optimized copies, and is safe to run repeatedly.
 */
export async function rehostIssueImages(doc: IssueDoc): Promise<{ doc: IssueDoc; report: RehostReport }> {
  const next = structuredClone(doc);
  const report: RehostReport = { rehosted: [], skipped: [], failed: [] };

  if (!config.rehostImages) {
    for (const item of Object.values(next.items)) {
      for (const url of imageUrls(item)) if (!isRehosted(url)) report.skipped.push(url);
    }
    return { doc: next, report };
  }

  // One pass per distinct source URL: the same photo can appear in two items.
  const done = new Map<string, string>();

  for (const item of Object.values(next.items)) {
    for (const source of imageUrls(item)) {
      if (isRehosted(source)) {
        report.skipped.push(source);
        continue;
      }
      const settled = done.get(source);
      if (settled) {
        rewriteReferences(item, source, settled);
        continue;
      }
      try {
        const result = await rehost(source, next.issue.number);
        done.set(source, result.url);
        rewriteReferences(item, source, result.url);
        report.rehosted.push(result);
      } catch (err) {
        // A failed rehost leaves the original URL in place; the issue still sends.
        report.failed.push({ url: source, error: (err as Error).message });
      }
    }
  }

  return { doc: next, report };
}

// ── uploads ───────────────────────────────────────────────────────────────

/**
 * Store a photo Jamie dropped on the canvas.
 *
 * Same pipeline as a rehost — resize, re-encode, content-addressed key — but
 * the bytes arrive from the browser rather than from a URL. The EXIF read
 * happens here rather than in the client because the client only has the file's
 * modified time, which is when it was *copied*, not when it was taken.
 */
export async function storeUpload(
  original: Buffer,
  issueNumber: number,
  filename: string,
): Promise<RehostedImage & { takenAt?: string; coordinates?: string }> {
  const image = sharp(original);
  const meta = await image.metadata();

  const pipeline = image
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const key = keyFor(issueNumber, `upload:${filename}:${data.length}`);
  const url = `https://${CDN_HOST}/${key}`;

  if (!(await alreadyThere(key))) {
    await s3().send(
      new PutObjectCommand({
        Bucket: CDN_HOST,
        Key: key,
        Body: data,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  const exif = meta.exif ? readExif(meta.exif) : {};

  return {
    original: filename,
    url,
    bytes: data.length,
    width: info.width,
    height: info.height,
    savedBytes: Math.max(0, original.length - data.length),
    ...exif,
  };
}

/**
 * What the camera recorded: when, and where.
 *
 * Returns coordinates rather than a place name — naming the place needs a
 * geocoder this service does not have, and a wrong place name in print is worse
 * than none. The drop zone says both stay editable, so Jamie names it.
 */
export function readExif(buffer: Buffer): { takenAt?: string; coordinates?: string } {
  try {
    const tags = exifReader(buffer);
    const out: { takenAt?: string; coordinates?: string } = {};

    const taken = tags.Photo?.DateTimeOriginal ?? tags.Image?.DateTime;
    if (taken instanceof Date && !Number.isNaN(taken.getTime())) {
      // EXIF carries no zone; it is the camera's wall clock, which is the
      // clock the caption should read in.
      out.takenAt = taken.toISOString().replace(/\.\d+Z$/, '');
    }

    const gps = tags.GPSInfo;
    const lat = dms(gps?.GPSLatitude, gps?.GPSLatitudeRef);
    const lon = dms(gps?.GPSLongitude, gps?.GPSLongitudeRef);
    if (lat !== null && lon !== null) out.coordinates = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

    return out;
  } catch {
    // A photo with unreadable EXIF is still a usable photo.
    return {};
  }
}

/** EXIF stores coordinates as [degrees, minutes, seconds] plus a hemisphere. */
export function dms(value: unknown, ref: unknown): number | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [d, m, s] = value.map(Number);
  if ([d, m, s].some((n) => !Number.isFinite(n))) return null;
  const sign = ref === 'S' || ref === 'W' ? -1 : 1;
  return sign * (d! + m! / 60 + s! / 3600);
}
