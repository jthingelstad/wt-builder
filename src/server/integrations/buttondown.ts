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
  /** The public archive URL, once Buttondown has one. */
  url?: string;
  /** The editor, where the draft is reviewed and scheduled. */
  edit_url: string;
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
 * Tells Buttondown the body is Markdown for its plaintext editor. Without
 * it the draft opened in the rich-text editor with every newline collapsed
 * (WT350, 2026-09-20). Buttondown documents the marker for exactly this:
 * https://docs.buttondown.com/api-emails-create
 */
export const EDITOR_MODE_MARKER = '<!-- buttondown-editor-mode: plaintext -->';

/** Where Jamie opens the draft to review and schedule it — not its public archive URL. */
export function editUrl(id: string): string {
  return `https://buttondown.com/emails/${id}`;
}

function markdownBody(body: string): string {
  return body.startsWith(EDITOR_MODE_MARKER) ? body : `${EDITOR_MODE_MARKER}\n${body}`;
}

/**
 * Create the issue's draft. `status: 'draft'` is what keeps this safe — the
 * email exists in Buttondown for review and is not scheduled or sent.
 */
export async function createDraft(subject: string, body: string): Promise<DraftResult> {
  const created = (await call('/emails', {
    method: 'POST',
    body: JSON.stringify({ subject, body: markdownBody(body), status: 'draft' }),
  })) as { id: string; absolute_url?: string };

  return { id: created.id, url: usableArchiveUrl(created.absolute_url), edit_url: editUrl(created.id), subject };
}

/**
 * A draft created before it had a subject gets Buttondown's placeholder slug
 * — `…/archive/untitled/` — and WT350's website front matter recorded that
 * as the issue's email URL (2026-09-20). A placeholder is not a URL worth
 * keeping: the website leg falls back to the numbered archive URL it already
 * knows, and the next re-send records the real one.
 */
export function usableArchiveUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /\/archive\/untitled(?:-\d+)?\/?$/i.test(url) ? undefined : url;
}

/** Replace the body of an existing draft, for a re-send after edits. */
export async function updateDraft(id: string, subject: string, body: string): Promise<DraftResult> {
  const updated = (await call(`/emails/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ subject, body: markdownBody(body) }),
  })) as { id: string; absolute_url?: string };

  return { id: updated.id ?? id, url: usableArchiveUrl(updated.absolute_url), edit_url: editUrl(updated.id ?? id), subject };
}

/** Presence check used by the health route; never returns the key. */
export function isConfigured(): boolean {
  return Boolean(credentials.buttondownKey);
}
