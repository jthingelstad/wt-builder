/**
 * Sharing a published issue: the facts both sides agree on
 * (docs/share-plan.md). Two destinations and nothing else: LinkedIn, which
 * Jamie posts himself, and a blog post WT Builder makes on micro.blog.
 */

import type { IssueDoc, ShareDestination } from './types.ts';
import { planEdition } from './render/plan.ts';
import { lastSent } from './sends.ts';

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
 * The `ref` on the issue link a share's text carries, whatever WT Builder
 * wrote then: the record of what went out, not today's rule.
 */
export function carriedRef(text: string, number: number): string | undefined {
  const m = new RegExp(`/archive/${number}/?\\?(?:[^\\s)#]*&)?ref=([^&\\s)#]+)`).exec(text);
  return m ? decodeURIComponent(m[1]!) : undefined;
}

/**
 * A new share starts as a contents template, filled from the issue (Jamie,
 * 2026-10-11): a list of what is in it, which is plainly neither Jamie
 * writing nor a model pretending to be him. Nothing is generated; the share
 * wand is gone (docs/decisions.md). He edits it, or adds a line of his own.
 */
export function startingText(doc: IssueDoc, destination: ShareDestination): string {
  return destination === 'linkedin' ? linkedinContents(doc) : blogContents(doc);
}

const site = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** "a, b, and c" */
function listed(parts: string[]): string {
  if (parts.length < 3) return parts.join(' and ');
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

const counted = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * What the issue holds, for both templates: its Notable links as the pages
 * title them, with their sites, and the rest counted. Null for a
 * pre-Builder record, which has no items (it is never parsed into them).
 */
function contents(doc: IssueDoc): { notable: { title: string; site: string }[]; rest: string } | null {
  if (doc.issue.imported) return null;
  const plan = planEdition(doc, 'website');
  const of = (type: string) => plan.filter((p) => p.node.type === type).flatMap((p) => p.items);
  const notable = of('notable')
    .filter(({ item }) => item.type === 'pinboard_link' && item.title)
    .map(({ item }) => ({ title: String(item.title).trim(), site: site(item.source_url ?? '') }));

  const briefly = of('briefly').length;
  const journal = of('journal').length;
  const audio = Number(lastSent(doc.sends?.podcast)?.audio?.audio_duration_seconds);
  const counts = [
    briefly ? counted(briefly, notable.length ? 'more link' : 'link', notable.length ? 'more links' : 'links') : '',
    journal ? counted(journal, 'journal post', 'journal posts') : '',
    of('photo').length ? 'a photo' : '',
    audio > 0 ? `a ${Math.max(1, Math.round(audio / 60))}-minute audio edition` : '',
  ].filter(Boolean);
  const rest = counts.length ? `${notable.length ? 'Plus' : 'In this issue:'} ${listed(counts)}.` : '';
  return { notable, rest };
}

const entry = (l: { title: string; site: string }, title = l.title) => `- ${title}${l.site ? ` (${l.site})` : ''}`;

/**
 * LinkedIn: the issue's name, its Notable links, a line counting the rest,
 * and the link. Plain text, since LinkedIn shows Markdown as typed. A
 * pre-Builder record is the name, the dek and the link.
 */
export function linkedinContents(doc: IssueDoc): string {
  const n = doc.issue.number;
  // A title that already names the issue ("Weekly Thing for May 13, 2017") is not said twice.
  const title = doc.issue.title?.trim();
  const head = `The Weekly Thing ${n}${title && !/weekly thing/i.test(title) ? `: ${title}` : ''}`;
  const link = shareLink(doc, 'linkedin');
  const c = contents(doc);
  if (!c) return [head, doc.issue.dek?.trim(), link].filter(Boolean).join('\n\n');
  const parts = [head];
  if (c.notable.length) parts.push(`In this issue:\n${c.notable.map((l) => entry(l)).join('\n')}`);
  if (c.rest) parts.push(c.rest);
  parts.push(link);
  return parts.join('\n\n');
}

/** A page's title as Markdown text: its marks shown, never read as emphasis or a link. */
const escaped = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1');

/**
 * The blog post: the same contents as LinkedIn (Jamie, 2026-10-11: "the more
 * thorough description"), in Markdown, ending on a link to the issue. No
 * name line: the post is titled with the issue's subject already. A
 * pre-Builder record is its dek, Jamie's own words, and the link.
 */
export function blogContents(doc: IssueDoc): string {
  const end = `[Weekly Thing ${doc.issue.number}](${shareLink(doc, 'blog')})`;
  const c = contents(doc);
  if (c && (c.notable.length || c.rest)) {
    const parts: string[] = [];
    if (c.notable.length) parts.push('In this issue:', c.notable.map((l) => entry(l, escaped(l.title))).join('\n'));
    if (c.rest) parts.push(c.rest);
    parts.push(end);
    return parts.join('\n\n');
  }
  const dek = doc.issue.dek?.trim() ?? '';
  if (!dek) return end;
  return `${dek}${/[.!?…]$/.test(dek) ? '' : '.'} ${end}`;
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
