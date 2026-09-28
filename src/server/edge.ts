/**
 * The edge: what the service refuses before it routes anything.
 *
 * There is no authentication inside WT Builder. Tailscale terminates identity
 * in front of it, and it binds loopback. That trusts the network, not the
 * browser: a page on any site, open in Jamie's Safari, can send a CORS-simple
 * POST (a text/plain body, no preflight) to the tailnet URL, and readBody
 * parses it as JSON regardless. Offline, such a request saved an attacker's
 * title and got a forced website send past the podcast gate (review
 * 2026-09-27, §1.6). So every write must come from the app's own origin.
 *
 * DNS rebinding is the same attack by another road: a page whose name
 * resolves to 127.0.0.1 reaches the loopback listener as its own origin, with
 * every method. The browser still sends that page's name as the Host, so the
 * service answers only to its own names, for reads as much as writes.
 *
 * Every refusal is logged with the header value it refused, and both lists
 * extend from .env (WT_BUILDER_ALLOWED_HOSTS, WT_BUILDER_ALLOWED_ORIGINS,
 * comma-separated) without a code change, so a proxy that sends something
 * unexpected shows up in the log and can be let in the same minute.
 */

import type { IncomingHttpHeaders } from 'node:http';

/** The tailnet name `tailscale serve --https=10001` answers on. */
export const TAILNET_HOST = 'otto.tail09aaf9.ts.net';
export const TAILNET_ORIGIN = `https://${TAILNET_HOST}:10001`;
/** Vite's dev server (vite.config.ts), which proxies /api here. */
const DEV_CLIENT_PORT = 5317;

/**
 * Origins allowed to write. `port` is the port this server is actually
 * listening on (server.address()), not the configured one: the route tests
 * listen on port 0 and the browser suite on 4399.
 */
export function allowedOrigins(port: number, extra: readonly string[] = []): Set<string> {
  return new Set(
    [
      TAILNET_ORIGIN,
      `http://localhost:${DEV_CLIENT_PORT}`,
      `http://127.0.0.1:${DEV_CLIENT_PORT}`,
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      ...extra,
    ].map((o) => o.toLowerCase()),
  );
}

/**
 * Host values this service answers to. Tailscale Serve may pass the tailnet
 * Host through (with or without its port) or rewrite it to the loopback
 * target, so both are here. The Vite dev proxy sets changeOrigin, which
 * sends the loopback Host of its target, the service's own port.
 */
export function allowedHosts(port: number, extra: readonly string[] = []): Set<string> {
  return new Set(
    [
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      TAILNET_HOST,
      `${TAILNET_HOST}:10001`,
      ...extra,
    ].map((h) => h.toLowerCase()),
  );
}

/** Why a request is refused as addressed to some other name, or null. */
export function hostRefusal(headers: IncomingHttpHeaders, allowed: ReadonlySet<string>): string | null {
  const host = headers.host;
  if (host === undefined) return 'a request with no Host is refused';
  if (!allowed.has(host.toLowerCase())) return `Host ${host} is not this service`;
  return null;
}

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v.join(', ') : v);

/**
 * Why a write is refused as cross-site, or null to let it through. Reads
 * (GET, HEAD) are never refused here. A browser marks every request it sends
 * with Sec-Fetch-Site, and with Origin on anything but a GET; scripts/ and
 * curl send neither, and pass.
 */
export function crossSiteRefusal(
  method: string,
  headers: IncomingHttpHeaders,
  allowed: ReadonlySet<string>,
): string | null {
  if (method === 'GET' || method === 'HEAD') return null;
  const site = one(headers['sec-fetch-site']);
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return `cross-site request refused (Sec-Fetch-Site: ${site})`;
  }
  const origin = one(headers.origin);
  if (origin !== undefined && !allowed.has(origin.toLowerCase())) {
    return `requests from ${origin} are refused`;
  }
  return null;
}
