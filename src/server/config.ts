/**
 * Server configuration.
 *
 * Every credential is server-side (AGENTS.md, Stack). Nothing here is ever
 * serialized to the client, and values are never logged — `describeConfig()`
 * reports only whether a credential is present.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));

if (existsSync(ENV_PATH)) {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch (err) {
    console.warn(`[config] could not load .env: ${(err as Error).message}`);
  }
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export interface Credentials {
  pinboardToken?: string;
  microblogToken?: string;
  buttondownKey?: string;
}

export const credentials: Credentials = {
  pinboardToken: optional('PINBOARD_API_TOKEN'),
  microblogToken: optional('MICROBLOG_API_KEY'),
  buttondownKey: optional('BUTTONDOWN_API_KEY'),
};

export const config = {
  port: Number(optional('WT_BUILDER_PORT') ?? 4317),
  /**
   * Loopback by default. The service is reached over Tailscale, which
   * terminates identity before anything reaches this process; binding wider
   * than the tailnet interface would expose an unauthenticated editor.
   */
  host: optional('WT_BUILDER_HOST') ?? '127.0.0.1',
  dbPath: optional('WT_BUILDER_DB') ?? fileURLToPath(new URL('../../data/wt-builder.db', import.meta.url)),
  /** Pinboard write-back is real and destructive; off unless explicitly enabled. */
  pinboardWriteBack: optional('WT_BUILDER_PINBOARD_WRITEBACK') === 'true',
  microblogHost: optional('MICROBLOG_HOST') ?? 'https://micro.blog',
  blogUrl: optional('MICROBLOG_BLOG_URL') ?? 'https://www.thingelstad.com',
};

/** Safe to log: presence only, never values. */
export function describeConfig(): Record<string, string> {
  return {
    port: String(config.port),
    host: config.host,
    db: config.dbPath,
    pinboard: credentials.pinboardToken ? 'configured' : 'MISSING',
    microblog: credentials.microblogToken ? 'configured' : 'MISSING',
    buttondown: credentials.buttondownKey ? 'configured' : 'MISSING',
    pinboardWriteBack: config.pinboardWriteBack ? 'enabled' : 'disabled',
  };
}
