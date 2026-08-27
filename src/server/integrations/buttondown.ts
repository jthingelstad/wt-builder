/**
 * Buttondown.
 *
 * Creates or updates a draft and nothing else. Draft creation is distinct from
 * scheduling or sending: if the draft is wrong, nothing has reached a reader
 * (AGENTS.md, the slice).
 */

import { credentials } from '../config.ts';

const API = 'https://api.buttondown.com/v1';

export interface DraftResult {
  id: string;
  url?: string;
  subject: string;
}

function requireKey(): string {
  const key = credentials.buttondownKey;
  if (!key) throw new Error('BUTTONDOWN_API_KEY is not configured');
  return key;
}

async function call(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${requireKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Buttondown ${path} failed: ${res.status} ${res.statusText} ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Create the issue's draft. `status: 'draft'` is what keeps this safe — the
 * email exists in Buttondown for review and is not scheduled or sent.
 */
export async function createDraft(subject: string, body: string): Promise<DraftResult> {
  const created = (await call('/emails', {
    method: 'POST',
    body: JSON.stringify({ subject, body, status: 'draft' }),
  })) as { id: string; absolute_url?: string };

  return { id: created.id, url: created.absolute_url, subject };
}

/** Replace the body of an existing draft, for a re-send after edits. */
export async function updateDraft(id: string, subject: string, body: string): Promise<DraftResult> {
  const updated = (await call(`/emails/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ subject, body }),
  })) as { id: string; absolute_url?: string };

  return { id: updated.id ?? id, url: updated.absolute_url, subject };
}

/** Presence check used by the health route; never returns the key. */
export function isConfigured(): boolean {
  return Boolean(credentials.buttondownKey);
}
