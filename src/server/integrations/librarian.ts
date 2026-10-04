/**
 * The Librarian — the archive's retrieval API.
 *
 * Echoes is grounded here: the same Bedrock-embed → vector-search → rerank
 * pipeline Thingy answers from, exposed as a passages-only endpoint. The
 * corpus is citation-ready, so every passage arrives with its issue number
 * and URL — which is what makes Echoes' citations reviewable.
 *
 * Service auth is a shared secret in the request body (the Lambda's
 * LIBRARIAN_RETRIEVE_SECRET), not a per-reader token: the caller is this
 * service, not a subscriber.
 */

import { config, credentials } from '../config.ts';

// The /retrieve request/response shape this client codes against, from
// librarian-thing/apps/librarian/contracts/librarian-api.json. Bump when
// adopting a new major - and this client is a REGISTERED consumer in the
// Librarian's SUPPORTED_CONTRACT_MAJORS comment, so a major drop checks
// here first. Verified against 4.12.0 (2026-09-30): passages carry a label
// and an absolute url, and the scope/filters/caller below are 4.11 request
// fields plus 4.12's `calendar` (Echoes' this-week-in-past-years hint).
// Since 4.11 the corpus holds no Thingy-bylined text, so nothing here
// filters Thingy's words out of what comes back.
const LIBRARIAN_CONTRACT_MAJOR = '4.12.0';

export interface Passage {
  id?: string;
  issue_number?: number;
  /** weekly_thing, blog, podcast (or site_page / faq for the weekly site's own pages). */
  source_kind?: string;
  /** How to cite it: WT312, AT1, or a blog post's title. */
  label?: string;
  subject?: string;
  publish_date?: string;
  section?: string;
  age?: string;
  score?: number;
  /** Absolute since 4.11. */
  url?: string;
  show?: string;
  episode_number?: number | string;
  /** Issues whose Journal also carried this blog post. */
  also_in_issues?: (number | string)[];
  text?: string;
}

export interface RetrieveOptions {
  /** Which corpora to search. The Librarian defaults to weekly_thing. */
  scope?: 'weekly_thing' | 'blog' | 'podcast' | 'both' | 'all';
  filters?: {
    sourceKinds?: string[];
    excludeSourceKinds?: string[];
    excludeIssues?: number[];
    before?: string;
    issueNumber?: number;
    /**
     * 4.12: only sources published within `window_days` (the server caps it
     * at 7) of this month-day in an EARLIER year. A malformed date is a 400.
     */
    calendar?: { date: string; window_days?: number };
  };
}

export function isConfigured(): boolean {
  return Boolean(credentials.librarianSecret);
}

/**
 * How many retrievals WT Builder keeps in flight. The Librarian's stream
 * Lambda serves /retrieve alongside Thingy's chat and the MCP under a
 * reserved concurrency of 5 (librarian-thing apps/librarian/AGENTS.md).
 * Echoes asks once per Notable anchor, all at once: WT352's nine Notable
 * items and the calendar anchor made ten, the Lambda answered 429
 * ReservedFunctionConcurrentInvocationLimitExceeded, and the draft failed
 * three times running. Two at a time leaves room for everyone else.
 */
export const MAX_IN_FLIGHT = 2;
/** A 429 is the Lambda being busy, not a failure: wait and ask again, this many times. */
export const RETRIES_ON_429 = 3;

let inFlight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await run();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/** Waits between 429 retries; a test hands in its own to run without sleeping. */
export let backoff = (attempt: number) => new Promise<void>((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
export function setBackoff(fn: (attempt: number) => Promise<void>): void {
  backoff = fn;
}

/**
 * Top-k archive passages for a query. Throws on any failure — Echoes'
 * quality bar is real semantic retrieval, and the editorial spec says to
 * fail loud rather than degrade silently (docs/service-contracts.md). A 429
 * is retried after a wait before it counts as one.
 */
export async function retrieve(query: string, k = 12, options: RetrieveOptions = {}): Promise<Passage[]> {
  const secret = credentials.librarianSecret;
  if (!secret) {
    throw new Error('LIBRARIAN_RETRIEVE_SECRET is not configured — Echoes requires archive retrieval');
  }
  for (let attempt = 0; ; attempt++) {
    const res = await slot(() => retrieveOnce(query, k, options, secret));
    if (res.status === 429 && attempt < RETRIES_ON_429) {
      await backoff(attempt);
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`Librarian retrieve failed: ${res.status} ${res.statusText} ${detail}`);
    }
    const body = (await res.json()) as { passages?: Passage[] };
    return body.passages ?? [];
  }
}

async function retrieveOnce(query: string, k: number, options: RetrieveOptions, secret: string): Promise<Response> {
  return fetch(`${config.librarianUrl.replace(/\/$/, '')}/retrieve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Participate in contract negotiation: the Librarian answers 409 for
      // majors it no longer serves, which beats silently-missing fields.
      'x-librarian-contract-version': LIBRARIAN_CONTRACT_MAJOR,
    },
    body: JSON.stringify({
      query,
      k,
      scope: options.scope,
      filters: options.filters,
      caller: 'wt-builder',
      retrieve_secret: secret,
    }),
    signal: AbortSignal.timeout(30_000),
  });
}
