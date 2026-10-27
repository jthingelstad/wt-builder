/**
 * Did the episode land? Read back off the live site, never off the commit:
 * the feed carries its GUID and its enclosure, the enclosure answers with
 * the bytes that were sent, and the episode page is up.
 *
 * The site's build deploys to S3 and CloudFront after the commit, so for a while after a send the
 * answer is "not yet", which is `waiting`, not a problem: the routes look
 * again on their own until LANDING_MS has passed, and only then is a missing
 * piece a problem.
 */

import { audioRepoPath, guidFor, permalink, SITE } from '../../shared/podcast/contract.ts';
import type { EpisodeDoc } from '../../shared/podcast/types.ts';
import { lastSent } from '../../shared/sends.ts';
import type { Verification, VerifyCheck } from '../../shared/types.ts';

export const FEED_URL = `${SITE}/podcast.xml`;
/** How long after a send a missing piece is still "the build has not run". */
export const LANDING_MS = 20 * 60_000;
export const RECHECK_MS = 2 * 60_000;

type Fetch = typeof fetch;

export async function verifyEpisode(doc: EpisodeDoc, get: Fetch = fetch, now = Date.now()): Promise<Verification> {
  const at = new Date(now).toISOString();
  const sent = lastSent(doc.sends?.another);
  const e = doc.episode;
  if (!sent || !e.date) {
    return { status: 'error', at, checks: [], error: 'the episode has not been sent' };
  }
  const guid = guidFor(e.date, e.slug);
  const audioUrl = `${SITE}/${audioRepoPath(e.number, e.date)}`;
  const pageUrl = `${SITE}${permalink(e.date, e.slug)}`;
  const sentBytes = Number((sent.audio as { bytes?: number } | undefined)?.bytes ?? 0);
  const checks: VerifyCheck[] = [];

  try {
    const feed = await get(FEED_URL, { signal: AbortSignal.timeout(20_000), headers: { 'Cache-Control': 'no-cache' } });
    const xml = feed.ok ? await feed.text() : '';
    const inFeed = xml.includes(`>${guid}<`);
    checks.push({
      label: 'Feed',
      ok: inFeed,
      detail: inFeed ? `podcast.xml carries ${guid}` : feed.ok ? 'podcast.xml does not carry the episode yet' : `podcast.xml answered ${feed.status}`,
    });
    const enclosed = xml.includes(`url="${audioUrl}"`);
    checks.push({
      label: 'Enclosure',
      ok: enclosed,
      detail: enclosed ? `the feed encloses ${audioUrl}` : 'the feed does not enclose the episode\'s mp3 yet',
    });

    const audio = await get(audioUrl, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
    const length = Number(audio.headers.get('content-length') ?? 0);
    const sameBytes = !sentBytes || length === sentBytes;
    checks.push({
      label: 'Audio',
      ok: audio.ok && sameBytes,
      detail: !audio.ok
        ? `${audioUrl} answered ${audio.status}`
        : sameBytes
          ? `${audioUrl} is up (${(length / 1e6).toFixed(1)} MB)`
          : `${audioUrl} is ${length} bytes; the send put ${sentBytes} in the audio bucket (an older copy is still cached, or the build has not run)`,
    });

    const page = await get(pageUrl, { signal: AbortSignal.timeout(20_000) });
    checks.push({ label: 'Page', ok: page.ok, detail: page.ok ? `${pageUrl} is up` : `${pageUrl} answered ${page.status}` });
  } catch (err) {
    return { status: 'error', at, checks, error: (err as Error).message };
  }

  if (checks.every((c) => c.ok)) return { status: 'passed', at, checks };
  const landing = now - Date.parse(sent.at ?? '') < LANDING_MS;
  if (landing) return { status: 'waiting', at, checks, recheck_at: new Date(now + RECHECK_MS).toISOString() };
  return { status: 'problems', at, checks };
}
