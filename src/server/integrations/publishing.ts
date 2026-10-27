/**
 * The publishing bus: every send announces itself with a `published` event
 * on `thingelstad-publishing`, the EventBridge bus the sync stack owns
 * (sync.thingelstad.xyz/AGENTS.md, "The publishing bus"). The sync probe
 * runs on each event, records it as WT Builder's fact, and shows the item's
 * journey from that moment. Jamie, 2026-10-26: "I really would like to get
 * as many things to be event based".
 *
 * One event per leg, after the leg's send is on the record:
 *
 *   source       wt-builder
 *   detail-type  published
 *   detail       { product, kind, id, title, url, leg, leg_url, at, legs }
 *
 * `legs` is every leg of the item sent so far (its time and URL), so a
 * reader that missed one event still knows the whole send. The bus is told,
 * never asked: a failure to announce is logged and recorded on the issue,
 * and the send that already happened stands (docs/decisions.md).
 *
 * The bus accepts PutEvents from the IAM user in .env (`wt-archive`; the
 * sync stack grants it that and nothing else). Offline (every test), the
 * AWS SDK has no credentials (config.ts), so an unstubbed put fails before
 * it leaves the machine, as the buckets' calls do.
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

import type { EpisodeDoc } from '../../shared/podcast/types.ts';
import { lastSent } from '../../shared/sends.ts';
import { issueUrl } from '../../shared/shares.ts';
import type { Destination, IssueDoc, SendState } from '../../shared/types.ts';
import { config } from '../config.ts';
import { log } from '../log.ts';

export const DETAIL_TYPE = 'published';
export const SOURCE = 'wt-builder';

/** A leg of a send, as the bus names it: the four issue legs and the episode's one. */
export type Leg = Destination | 'another';

export interface Published {
  product: 'weekly-thing' | 'another-thing';
  kind: 'issue' | 'episode';
  /** The item's public id: the issue number, the episode number. */
  id: string;
  title: string;
  /** The item's page. */
  url: string;
  /** The leg that just went, and where it put the item. */
  leg: Leg;
  leg_url?: string;
  /** When the leg went (the send state's time). */
  at: string;
  /** Every leg sent so far, this one included. */
  legs: Partial<Record<Leg, { at: string; url?: string }>>;
}

/** The URL a leg's send state says the item is at, as the bus should carry it. */
function legUrl(doc: IssueDoc, leg: Destination, state: { url?: string; audio?: Record<string, unknown> } | undefined): string | undefined {
  if (!state) return undefined;
  // The website leg's state names the commit; readers want the page.
  if (leg === 'website') return issueUrl(doc);
  if (leg === 'podcast') return (state.audio?.audio_url as string | undefined) ?? state.url;
  if (leg === 'archive') return undefined;
  return state.url;
}

/** The event for an issue leg that just recorded `state` as sent. */
export function issuePublished(doc: IssueDoc, leg: Destination, state: SendState): Published {
  const legs: Published['legs'] = {};
  for (const dest of ['website', 'buttondown', 'podcast', 'archive'] as const) {
    const sent = dest === leg ? state : lastSent(doc.sends?.[dest]);
    if (!sent?.at || sent.status !== 'sent') continue;
    const url = legUrl(doc, dest, sent);
    legs[dest] = { at: sent.at, ...(url ? { url } : {}) };
  }
  const url = legUrl(doc, leg, state);
  return {
    product: 'weekly-thing',
    kind: 'issue',
    id: String(doc.issue.number),
    title: doc.issue.title,
    url: issueUrl(doc),
    leg,
    ...(url ? { leg_url: url } : {}),
    at: state.at!,
    legs,
  };
}

/** The event for an episode whose send just recorded `state` as sent; `url` is the episode's page. */
export function episodePublished(doc: EpisodeDoc, state: SendState, url: string): Published {
  return {
    product: 'another-thing',
    kind: 'episode',
    id: String(doc.episode.number),
    title: doc.episode.title,
    url,
    leg: 'another',
    leg_url: url,
    at: state.at!,
    legs: { another: { at: state.at!, url } },
  };
}

let client: EventBridgeClient | undefined;
const bus = () => (client ??= new EventBridgeClient({ region: config.awsRegion, maxAttempts: 3 }));

/** Put the event on the bus; the event id EventBridge gave it. */
export async function putPublished(event: Published): Promise<string> {
  const result = await bus().send(new PutEventsCommand({
    Entries: [{ EventBusName: config.publishingBus, Source: SOURCE, DetailType: DETAIL_TYPE, Time: new Date(event.at), Detail: JSON.stringify(event) }],
  }));
  const entry = result.Entries?.[0];
  if (result.FailedEntryCount || !entry?.EventId) throw new Error(`the bus refused the event: ${entry?.ErrorCode ?? 'no entry'} ${entry?.ErrorMessage ?? ''}`.trim());
  return entry.EventId;
}

/** How long a send waits on the announcement before going on without it. */
export const ANNOUNCE_TIMEOUT_MS = 10_000;

/**
 * Announce a send on the bus, never gating it: an error, or ten seconds
 * without an answer, is logged and handed to `failed` (which records it on
 * the issue), and the caller goes on. Returns the event id, or null.
 */
export async function announce(event: Published, failed: (message: string) => void): Promise<string | null> {
  if (!config.publishingBus) return null;
  let timer: NodeJS.Timeout | undefined;
  try {
    const eventId = await Promise.race([
      putPublished(event),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer from the bus in ${ANNOUNCE_TIMEOUT_MS / 1000} s`)), ANNOUNCE_TIMEOUT_MS); }),
    ]);
    log.info(`[publishing] ${event.kind} ${event.id} ${event.leg}: ${eventId} on ${config.publishingBus}`);
    return eventId;
  } catch (err) {
    const message = (err as Error).message;
    log.error(`[publishing] ${event.kind} ${event.id} ${event.leg}: not announced — ${message}`);
    failed(message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
