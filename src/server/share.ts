/**
 * Sharing a draft: one static, revocable page on the CDN.
 *
 * The builder itself can never be shared — it has no auth layer and holds
 * write credentials — so what leaves is a rendered snapshot at an
 * unguessable URL. The page says DRAFT loudly at the top and again at the
 * bottom, and carries Jamie's note to the person it was shared with: the
 * deterrent against passing it along is social, the revocation is real
 * (`no-store` on the object, deletion on unshare).
 */

import { randomBytes } from 'node:crypto';

import type { DraftShare, IssueDoc } from '../shared/types.ts';
import { render } from '../shared/render/index.ts';
import { longDate, wallClock } from '../shared/dates.ts';
import { markdownInlineToSafeHtml, markdownToSafeHtml } from '../shared/markdown.ts';
import { deleteObject, putHtml } from './integrations/images.ts';

/** Unguessable, and prefixed by issue so stray objects are legible in S3. */
export function shareKey(issueNumber: number, token: string): string {
  return `weekly-thing/drafts/wt${issueNumber}-${token}.html`;
}

/**
 * The share page. Pure, so the DRAFT framing is testable: banner up top,
 * the note, the rendered website edition, and the plea at the bottom.
 */
export function renderShareHtml(doc: IssueDoc, note: string | undefined, at: string): string {
  const n = doc.issue.number;
  const day = wallClock(`${at.slice(0, 10)}T12:00:00`);
  const sharedOn = day ? longDate(day) : at.slice(0, 10);
  const body = markdownToSafeHtml(render(doc, 'website'));
  const noteHtml = note?.trim()
    ? `<aside class="note"><span class="note-from">A note from Jamie</span>${markdownInlineToSafeHtml(note.trim())}</aside>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>DRAFT · WT${n}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #faf9f7; color: #1a1a1a;
    font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .draft-banner { position: sticky; top: 0; z-index: 10; background: #b45309; color: #fff;
    padding: 10px 20px; text-align: center; font-size: 15px; letter-spacing: 0.02em; }
  .draft-banner strong { letter-spacing: 0.14em; margin-right: 10px; }
  main { max-width: 680px; margin: 0 auto; padding: 28px 20px 60px; }
  .note { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px;
    padding: 14px 18px; margin: 0 0 28px; }
  .note-from { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #92400e; margin-bottom: 4px; }
  img { max-width: 100%; height: auto; border-radius: 4px; }
  a { color: #0f62a8; }
  h1, h2, h3 { line-height: 1.25; }
  blockquote { margin: 0; padding: 2px 18px; border-left: 3px solid #d6d3d1; color: #444; }
  hr { border: 0; border-top: 1px solid #e7e5e4; margin: 32px 0; }
  .draft-footer { border-top: 1px solid #e7e5e4; margin-top: 48px; padding-top: 18px;
    font-size: 14px; color: #666; }
</style>
</head>
<body>
<div class="draft-banner"><strong>DRAFT</strong> The Weekly Thing ${n} · unpublished · shared privately on ${sharedOn}</div>
<main>
${noteHtml}
${body}
<div class="draft-footer">This is an <strong>unpublished draft</strong> of The Weekly Thing ${n},
shared with you privately — it may still change before it sends, and it isn't for
passing along. Shared ${sharedOn}.</div>
</main>
</body>
</html>
`;
}

/**
 * Render and upload the share page. Re-sharing keeps the token, so the link
 * a reader already holds shows the refreshed draft.
 */
export async function share(doc: IssueDoc, note: string | undefined): Promise<DraftShare> {
  const token = doc.draft_share?.token ?? randomBytes(12).toString('hex');
  const at = new Date().toISOString();
  const url = await putHtml(shareKey(doc.issue.number, token), renderShareHtml(doc, note, at));
  return { token, url, note: note?.trim() || undefined, at };
}

/** Delete the page. With `no-store` on the object, revocation is prompt. */
export async function unshare(doc: IssueDoc): Promise<void> {
  if (!doc.draft_share) return;
  await deleteObject(shareKey(doc.issue.number, doc.draft_share.token));
}
