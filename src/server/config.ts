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
  githubToken?: string;
  /** Text-to-speech for the audio edition. */
  openaiKey?: string;
}

export const credentials: Credentials = {
  pinboardToken: optional('PINBOARD_API_TOKEN'),
  microblogToken: optional('MICROBLOG_API_KEY'),
  buttondownKey: optional('BUTTONDOWN_API_KEY'),
  githubToken: optional('GITHUB_PAT_TOKEN'),
  openaiKey: optional('OPENAI_API_KEY'),
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
  /** Write-back mutates a real bookmark; explicit opt-in. */
  pinboardWriteBack: optional('WT_BUILDER_PINBOARD_WRITEBACK') === 'true',
  /** Write-back mutates a published post; explicit opt-in. */
  microblogWriteBack: optional('WT_BUILDER_MICROBLOG_WRITEBACK') === 'true',
  blogUrl: optional('MICROBLOG_BLOG_URL') ?? 'https://www.thingelstad.com',

  /** Rehost and resize remote images onto the CDN before sending. */
  rehostImages: optional('WT_BUILDER_REHOST_IMAGES') !== 'false',
  awsRegion: optional('AWS_DEFAULT_REGION') ?? 'us-east-1',

  /**
   * The last issue published before WT Builder. Pre-Builder issues are not
   * imported as items (docs/decisions.md), so this is how issue numbering continues.
   */
  lastPublishedIssue: Number(optional('WT_BUILDER_LAST_PUBLISHED_ISSUE') ?? 0) || 0,

  /** The render surface the website edition is committed to. */
  websiteRepo: optional('GITHUB_REPO_NWO') ?? 'jthingelstad/weekly.thingelstad.com',
  websiteBranch: optional('WT_BUILDER_WEBSITE_BRANCH') ?? 'main',

  /**
   * The archive repository — the corpus the Librarian API answers from. Its
   * CI rebuilds and uploads the corpus on any change under data/issues/, which
   * is what the archive send commits into. Config rather than a constant
   * because a streamline-and-rename of this repository is planned; when it
   * lands, retargeting is one env var.
   */
  archiveRepo: optional('WT_BUILDER_ARCHIVE_REPO') ?? 'jthingelstad/studio-thing',
  archiveBranch: optional('WT_BUILDER_ARCHIVE_BRANCH') ?? 'main',
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
    aws: process.env.AWS_ACCESS_KEY_ID ? 'configured' : 'MISSING',
    github: credentials.githubToken ? 'configured' : 'MISSING',
    openai: credentials.openaiKey ? 'configured' : 'MISSING',
    websiteRepo: config.websiteRepo,
    archiveRepo: config.archiveRepo,
    pinboardWriteBack: config.pinboardWriteBack ? 'enabled' : 'disabled',
    microblogWriteBack: config.microblogWriteBack ? 'enabled' : 'disabled',
    rehostImages: config.rehostImages ? 'enabled' : 'disabled',
  };
}
