/**
 * Sharing a published issue: the facts both sides agree on
 * (docs/share-plan.md). Two destinations and nothing else: LinkedIn, which
 * Jamie posts himself, and a blog post WT Builder makes on micro.blog.
 */

import type { IssueDoc, ShareDestination } from './types.ts';

export const SITE = 'https://weekly.thingelstad.com';

export const DESTINATIONS: ShareDestination[] = ['linkedin', 'blog'];

export const DESTINATION_NAME: Record<ShareDestination, string> = {
  linkedin: 'LinkedIn',
  blog: 'Blog post',
};

/**
 * Where a visit from each destination comes from, as Tinylytics records the
 * referrer. With the `ref` on the link, this is how an agent sets a share
 * beside the traffic it brought (the MCP's list_shares).
 */
export const REFERRER: Record<ShareDestination, string> = {
  linkedin: 'linkedin.com',
  blog: 'www.thingelstad.com',
};

/** LinkedIn's limit on a post. */
export const LINKEDIN_MAX = 3000;

/**
 * Roughly where LinkedIn folds a post behind "…see more": about three lines,
 * a couple of hundred characters on a desktop feed, fewer on a phone. Only
 * the lines above it are sure to be read, so the editor marks it.
 */
export const LINKEDIN_FOLD = 210;
const FOLD_LINES = 3;

/** The issue's page: the imported record's own address, or the site's pattern. */
export function issueUrl(doc: IssueDoc): string {
  return doc.issue.archive_url || `${SITE}/archive/${doc.issue.number}/`;
}

/**
 * The `ref` a share's link carries: the destination and the issue,
 * `linkedin-wt353` (Jamie, 2026-10-11), so Tinylytics' Sources lists each
 * share's visits on its own row and LinkedIn need not be asked. It names a
 * post, never a person. Shares before WT354 carried the destination alone.
 */
export function shareRef(doc: IssueDoc, destination: ShareDestination): string {
  return `${destination}-wt${doc.issue.number}`;
}

/**
 * The link a share carries: the issue page with `?ref=` (shareRef). The site
 * records `ref` for subscribe attribution, and the page's canonical URL stays
 * the plain one, so the preview card is the issue's own.
 */
export function shareLink(doc: IssueDoc, destination: ShareDestination): string {
  const url = new URL(issueUrl(doc));
  url.searchParams.set('ref', shareRef(doc, destination));
  return url.toString();
}

/**
 * Every link to the issue in the text, made the share's own link: a drafted
 * candidate that wrote it bare, or with another ref, still carries the right
 * one, and once.
 */
export function withShareLink(text: string, doc: IssueDoc, destination: ShareDestination): string {
  const bare = issueUrl(doc).replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(?:https?://)?${bare}(?![\\w.-])/?(?:\\?[^\\s)#]*)?`, 'g'), shareLink(doc, destination));
}

/**
 * The `ref` on the issue link a share's text carries, whatever WT Builder
 * wrote then: the record of what went out, not today's rule.
 */
export function carriedRef(text: string, number: number): string | undefined {
  const m = new RegExp(`/archive/${number}/?\\?(?:[^\\s)#]*&)?ref=([^&\\s)#]+)`).exec(text);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/** A new share starts as its link alone: the words go above it. */
export function startingText(doc: IssueDoc, destination: ShareDestination): string {
  return shareLink(doc, destination);
}

/** Whether the text links the issue at all, with or without the ref. */
export function linksIssue(text: string, doc: IssueDoc): boolean {
  const bare = issueUrl(doc).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return text.includes(bare);
}

/**
 * Where LinkedIn's "…see more" falls in this text, or null when the whole
 * post shows: after the third line or about LINKEDIN_FOLD characters,
 * whichever comes first.
 */
export function foldAt(text: string): number | null {
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n' && ++lines === FOLD_LINES) return i < text.trimEnd().length ? i : null;
  }
  return text.trimEnd().length > LINKEDIN_FOLD ? LINKEDIN_FOLD : null;
}

/**
 * LinkedIn shows Markdown as typed, so a draft for it is plain: a Markdown
 * link keeps its words, emphasis loses its marks.
 */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1$2');
}
