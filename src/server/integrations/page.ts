/**
 * Reading a web page for the link wand, on the service's own network.
 *
 * The URL is a bookmark's, so anyone's page can name it, and the service
 * runs on otto, inside the tailnet, next to its own loopback listener. So
 * the read follows redirects by hand and refuses, at every hop, a host that
 * is or resolves to a loopback, private, link-local, CGNAT (the tailnet's
 * 100.64/10) or otherwise non-public address, in any IPv6 spelling of it;
 * and it stops reading at PAGE_BYTES however much the server sends (review
 * 2026-09-27, §5).
 *
 * The name is resolved here and again by fetch, so a host that answers
 * differently the second time (DNS rebinding) is not caught. The page is
 * read, never executed, and the text only reaches the model, fenced as
 * untrusted (editorial.ts, linkGrounding); this closes the plain redirect
 * and the plain private name, which is what was open.
 */

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** How much of a page is read at most. The wand keeps 7,000 characters of text. */
export const PAGE_BYTES = 2_000_000;
/** Redirects followed at most. */
export const PAGE_HOPS = 5;

function v4(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** IPv4 ranges a public page never lives in (RFC 6890 and its neighbours). */
const V4_BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10] /* CGNAT: the tailnet */, ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3] /* multicast to broadcast */,
] as const) V4_BLOCKED.addSubnet(net, prefix, 'ipv4');

/**
 * An IPv6 address as its eight 16-bit groups, whatever the spelling:
 * `::` compression, a trailing dotted quad, or the hex groups WHATWG URL
 * writes a mapped address in (`[::ffff:127.0.0.1]` becomes `[::ffff:7f00:1]`).
 */
function hextets(ip: string): number[] | null {
  let text = ip;
  const quad = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (quad) {
    const four = v4(quad[1]!);
    if (!four) return null;
    text = `${text.slice(0, -quad[1]!.length)}${((four[0]! << 8) | four[1]!).toString(16)}:${((four[2]! << 8) | four[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 1 ? gap !== 0 : gap < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? gap : 0).fill('0'), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

/**
 * True for any address a public web page has no business resolving to.
 *
 * IPv6 is allowed only inside global unicast (2000::/3), less the ranges in
 * it that are not the open internet or that carry an IPv4 address inside
 * (6to4, Teredo, documentation). So all of ::/8 is refused, and with it
 * every loopback spelling and the IPv4-compatible `::7f00:1`; only the
 * IPv4-mapped `::ffff:a.b.c.d` (in either spelling) is unwrapped, and then
 * judged as the IPv4 address it is. NAT64's 64:ff9b:: sits outside 2000::/3
 * and is refused with the rest (review 2026-09-27, Batch 8 round 1, B1).
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  if (isIP(ip) === 4) return !v4(ip) || V4_BLOCKED.check(ip, 'ipv4');
  if (isIP(ip) !== 6) return true; // not an address at all: refuse
  const g = hextets(ip);
  if (!g) return true;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return isPrivateAddress([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff].join('.'));
  }
  const [a, b] = g as [number, number];
  if ((a & 0xe000) !== 0x2000) return true; // outside 2000::/3: ::/8, fc00::/7, fe80::/10, ff00::/8 and the rest
  return a === 0x2002 // 6to4, an IPv4 address inside
    || (a === 0x2001 && b === 0) // Teredo
    || (a === 0x2001 && b === 0x0db8) // documentation
    || (a === 0x3fff && b <= 0x0fff); // documentation (RFC 9637)
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
