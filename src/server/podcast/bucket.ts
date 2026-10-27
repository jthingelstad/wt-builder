/**
 * The episode's mp3 in another.thingelstad.com's audio bucket: the copy
 * subscribers download, through CloudFront, at the same
 * /uploads/YYYY/another-thing-N.mp3 URL the feed's enclosure names. Not in
 * git since 2026-10-26 (another.thingelstad.com/AGENTS.md, "S3 and
 * CloudFront"; Jamie: "Not great for the audio files to be in git").
 *
 * It behaves as the site's own `npm run audio:put` (scripts/put-audio.mjs):
 * - the same bytes already there are left as they are;
 * - different bytes at the key are a clash, unless the caller says this
 *   episode put them there (a re-send of a new master keeps its URL; the
 *   bucket is versioned and keeps the old master a year);
 * - nothing here deletes from the bucket.
 * What it put is read back (HeadObject) before the send goes on to GitHub,
 * because the site's deploy refuses a feed whose enclosure is not in the
 * bucket as audio/mpeg at the feed's length.
 *
 * Offline (every test), the AWS SDK has no credentials (config.ts), so a
 * call that is not stubbed fails before it leaves the machine, as the CDN
 * bucket's do.
 */

import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client, type HeadObjectCommandOutput } from '@aws-sdk/client-s3';

import { config } from '../config.ts';

/** The same as AUDIO_CACHE_CONTROL in another.thingelstad.com/scripts/publish-plan.mjs. */
export const AUDIO_CACHE_CONTROL = 'public, max-age=86400, s-maxage=31536000';

/** Different audio is already at the key, and this episode did not put it there. */
export class AudioClash extends Error {}

export type Placed = 'uploaded' | 'replaced' | 'unchanged';

let client: S3Client | undefined;
const s3 = () => (client ??= new S3Client({ region: config.awsRegion, maxAttempts: 5 }));

export const md5Hex = (body: Buffer) => createHash('md5').update(body).digest('hex');

/** What is at the key, or null when nothing is (a 404 needs s3:ListBucket; without it S3 says 403). */
export async function headAudio(key: string): Promise<HeadObjectCommandOutput | null> {
  try {
    return await s3().send(new HeadObjectCommand({ Bucket: config.anotherAudioBucket, Key: key }));
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/** Is this object these bytes, served as the feed says? A single-part SSE-S3 object's ETag is its MD5. */
function matches(head: HeadObjectCommandOutput | null, body: Buffer, md5: string): boolean {
  return Boolean(head)
    && head!.ETag?.replaceAll('"', '') === md5
    && head!.ContentLength === body.length
    && head!.ContentType === 'audio/mpeg';
}

/**
 * Put the episode's mp3 at `key`, or find it already there. `ours` says this
 * episode put whatever is at the key now (an earlier send of it), so a new
 * master may replace it. Throws AudioClash for anyone else's audio, and an
 * Error when what is there afterwards is not what was put.
 *
 * `putting` runs just before the PutObject, once the key is this episode's
 * to write (empty, or its own audio): the caller records the key as its own
 * then, so a put whose answer is lost, or a read-back that fails, still
 * leaves the record saying whose object it is. Recording it early is safe:
 * a put that never happened left the key empty or this episode's already.
 */
export async function placeAudio(
  key: string, body: Buffer, ours: boolean, putting: (md5: string) => void = () => {},
): Promise<{ placed: Placed; md5: string }> {
  const md5 = md5Hex(body);
  const there = await headAudio(key);
  if (matches(there, body, md5)) return { placed: 'unchanged', md5 };
  // The same bytes stored with the wrong type is not a clash: it is this audio, put right.
  const same = there?.ETag?.replaceAll('"', '') === md5;
  if (there && !same && !ours) {
    throw new AudioClash(`different audio is already in the audio bucket at ${key} (${there.ContentLength} bytes), and this episode did not put it there`);
  }
  putting(md5);
  await s3().send(new PutObjectCommand({
    Bucket: config.anotherAudioBucket,
    Key: key,
    Body: body,
    ContentType: 'audio/mpeg',
    CacheControl: AUDIO_CACHE_CONTROL,
    ContentMD5: Buffer.from(md5, 'hex').toString('base64'),
  }));
  const after = await headAudio(key);
  if (!matches(after, body, md5)) {
    throw new Error(`the audio bucket does not hold what was put at ${key}: ${after ? `${after.ContentLength} bytes, ${after.ContentType}` : 'nothing there'}, expected ${body.length} bytes, audio/mpeg`);
  }
  return { placed: there ? 'replaced' : 'uploaded', md5 };
}
