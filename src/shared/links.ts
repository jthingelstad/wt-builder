/**
 * One link, however it was written: the canonicaliser and the key built on it.
 *
 * `canonicalUrl` is the link as a reader should get it: https, the host
 * lowercased and without `www.`, `m.`, `mobile.` or `amp.`, no fragment, no
 * trailing slash, no tracking parameters, and out of any AMP wrapper. It is a
 * suggestion, never applied on its own: the link check (src/server/
 * link-check.ts) offers the page's own canonical or its final URL, and Jamie
 * applies it to the rendered link only. `source_url` is the Pinboard key and
 * is never rewritten (docs/decisions.md).
 *
 * `linkKey` is the canonical URL without its scheme: two links with one key
 * are one link ("linked before", the link check's grouping). The Librarian's
 * `linkUrlKey` (librarian-thing apps/librarian/lambda/shared/
 * archive-tools.mts) must agree on every case in
 * fixtures/canonical-urls.json; the same file is copied into the
 * Librarian's tests so the two cannot drift apart again (plan 2026-10-01 §3).
 */

import type { Item } from './types.ts';

/** The URL an item's link renders with: Jamie's applied canonical, else the bookmark's own. */
export function linkUrl(item: Pick<Item, 'canonical_url' | 'source_url'>): string | undefined {
  return item.canonical_url || item.source_url;
}

/**
 * Query parameters that say where a click came from, not what it points at:
 * campaign tags (utm_*), ad and mail click ids, share tokens. The union of
 * this service's list and the Librarian's (2026-10-01).
 */
const TRACKING =
  /^(?:utm_.*|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|yclid|twclid|igshid|mc_cid|mc_eid|mkt_tok|_hsenc|_hsmi|oly_anon_id|oly_enc_id|ref|ref_src|ref_url|s_cid|smid|si|guccounter|cmpid|vero_id|wickedid|__twitter_impression|smprod)$/i;

/** AMP's own switches in a query string. */
const AMP_PARAM = /^(?:amp|_amp|amp_js_v|usqp)$/i;

/** Host prefixes that are the same site in another dress. */
// Only while a dotted host remains: amp.dev and m.me are sites, not prefixes.
const HOST_PREFIX = /^(?:www\d*|m|mobile|amp)\.(?=[^.]+\.)/;

export function isTrackingParam(name: string, host = ''): boolean {
  return TRACKING.test(name) || (name.toLowerCase() === 's' && /^(?:twitter|x)\.com$/.test(host));
}

/**
 * The page an AMP cache or viewer URL wraps, or the URL itself:
 * `https://www-example-com.cdn.ampproject.org/c/s/www.example.com/a` and
 * `https://www.google.com/amp/s/example.com/a` are both example.com/a.
 */
function unwrapAmpCache(u: URL): URL {
  const host = u.hostname.toLowerCase();
  let inner: RegExpExecArray | null = null;
  if (host.endsWith('.cdn.ampproject.org')) inner = /^\/[a-z](?:\/s)?\/(.+)$/i.exec(u.pathname);
  else if (/^(?:www\.)?google\.[a-z.]+$/.test(host)) inner = /^\/amp\/(?:s\/)?(.+)$/i.exec(u.pathname);
  if (!inner) return u;
  try {
    return new URL(`https://${inner[1]}${u.search}`);
  } catch {
    return u;
  }
}

/**
 * The link as a reader should get it, or null for anything that is not an
 * http(s) URL. The path keeps its case; the remaining query keeps its order.
 */
export function canonicalUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(String(url ?? '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u = unwrapAmpCache(u);
  const host = u.hostname.toLowerCase().replace(HOST_PREFIX, '');
  const kept = [...u.searchParams].filter(([k, v]) =>
    !isTrackingParam(k, host) && !AMP_PARAM.test(k) && !(k === 'outputType' && v === 'amp'));
  const query = kept.length ? `?${new URLSearchParams(kept)}` : '';
  const path = u.pathname
    .replace(/\/amp(?=\/|$)/gi, '')
    .replace(/\.amp(?=\.html?$)/i, '')
    .replace(/\/+$/, '');
  return `https://${host}${u.port ? `:${u.port}` : ''}${path}${query}`;
}

/** The canonical URL without its scheme: one key per link. */
export function linkKey(url: string): string | null {
  return canonicalUrl(url)?.slice('https://'.length) ?? null;
}

/** True when the URL carries a parameter canonicalUrl would drop as tracking. */
export function hasTracking(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(HOST_PREFIX, '');
    return [...u.searchParams.keys()].some((k) => isTrackingParam(k, host));
  } catch {
    return false;
  }
}

/**
 * The URL with only its tracking parameters and fragment dropped: what the
 * site served, minus what says where the click came from. The link check
 * suggests this form, not the full canonical, so a link never moves to a
 * host spelling (`www.`, `m.`) the site does not itself use.
 */
export function withoutTracking(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname.toLowerCase().replace(HOST_PREFIX, '');
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingParam(key, host)) u.searchParams.delete(key);
  }
  u.hash = '';
  return u.toString();
}

/**
 * Every http(s) URL in a run of text: Markdown links, bare URLs, and HTML
 * `href`s alike. One level of parentheses is allowed inside a URL, so a
 * Markdown link to `…/wiki/Foo_(bar)` keeps its `(bar)`.
 */
export function urlsIn(text: string): string[] {
  const found = String(text ?? '').match(/https?:\/\/(?:[^\s<>()[\]"'`]|\([^\s<>()"'`]*\))+/g) ?? [];
  return found.map((u) => u.replace(/[.,;:!?*]+$/, ''));
}
