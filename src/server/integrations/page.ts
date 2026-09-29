/**
 * Reading a web page for the link wand, on the service's own network.
 *
 * The URL is a bookmark's, so anyone's page can name it, and the service
 * runs on otto, inside the tailnet, next to its own loopback listener. So
 * the read follows redirects by hand and refuses, at every hop, a host that
 * is or resolves to a loopback, private, link-local, CGNAT (the tailnet's
 * 100.64/10) or otherwise non-public address; and it stops reading at
 * PAGE_BYTES however much the server sends (review 2026-09-27, §5).
 *
 * The name is resolved here and again by fetch, so a host that answers
 * differently the second time (DNS rebinding) is not caught. The page is
 * read, never executed, and the text only reaches the model, fenced as
 * untrusted (editorial.ts, linkGrounding); this closes the plain redirect
 * and the plain private name, which is what was open.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** How much of a page is read at most. The wand keeps 7,000 characters of text. */
export const PAGE_BYTES = 2_000_000;
/** Redirects followed at most. */
export const PAGE_HOPS = 5;

function v4(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** True for any address a public web page has no business resolving to. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  const four = v4(ip);
  if (four) {
    const [a, b] = four as [number, number, number, number];
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127) // CGNAT; the tailnet lives here
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && four[2] === 0)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224; // multicast, reserved, broadcast
  }
  if (isIP(ip) !== 6) return true; // not an address at all: refuse
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]!);
  if (ip === '::' || ip === '::1') return true;
  const head = parseInt(ip.split(':')[0] || '0', 16);
  return (head & 0xfe00) === 0xfc00 // fc00::/7, unique local (and the tailnet's fd7a:)
    || (head & 0xffc0) === 0xfe80 // fe80::/10, link-local
    || (head & 0xff00) === 0xff00; // ff00::/8, multicast
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${url.protocol} is not a web page`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new Error(`${host} is not a public address`);
  }
}

/**
 * GET a public page, following up to PAGE_HOPS redirects by hand and
 * checking every hop. Throws on a refused hop or too many redirects.
 */
export async function fetchPublic(url: string, init: RequestInit = {}): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; hop <= PAGE_HOPS; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    await res.body?.cancel().catch(() => {});
    current = new URL(location, current);
  }
  throw new Error(`more than ${PAGE_HOPS} redirects`);
}

/** The body as text, reading no more than `max` bytes of it. */
export async function readCapped(res: Response, max = PAGE_BYTES): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = max - total;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    total += Math.min(value.byteLength, room);
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}
