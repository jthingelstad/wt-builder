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

export interface Passage {
  issue_number?: number;
  subject?: string;
  publish_date?: string;
  section?: string;
  age?: string;
  score?: number;
  url?: string;
  text?: string;
}

export function isConfigured(): boolean {
  return Boolean(credentials.librarianSecret);
}

/**
 * Top-k archive passages for a query. Throws on any failure — Echoes'
 * quality bar is real semantic retrieval, and the editorial spec says to
 * fail loud rather than degrade silently (docs/service-contracts.md).
 */
export async function retrieve(query: string, k = 12): Promise<Passage[]> {
  const secret = credentials.librarianSecret;
  if (!secret) {
    throw new Error('LIBRARIAN_RETRIEVE_SECRET is not configured — Echoes requires archive retrieval');
  }

  const res = await fetch(`${config.librarianUrl.replace(/\/$/, '')}/retrieve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, k, retrieve_secret: secret }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Librarian retrieve failed: ${res.status} ${res.statusText} ${detail}`);
  }
  const body = (await res.json()) as { passages?: Passage[] };
  return body.passages ?? [];
}
