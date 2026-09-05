/**
 * One-shot: strip Micro.blog's "Auto-generated description:" prefix from
 * image alt text IN THE POSTS THEMSELVES, via Micropub update.
 *
 * The prefix is UI residue from Micro.blog's alt-text assistant. Jamie's
 * rule is to normalize at the source: the blog is the CMS, so the fix
 * happens there and every downstream consumer — the corpus, Thingy,
 * search engines, screen readers — inherits it. The description text
 * itself is kept; only the label is removed.
 *
 *   node --import tsx scripts/strip-autogen-alt.ts --dry-run
 *   node --import tsx scripts/strip-autogen-alt.ts --one <post-url>
 *   node --import tsx scripts/strip-autogen-alt.ts            # sweep all
 *
 * Affected posts are found from the librarian repo's local blog mirror
 * (the canonical ingest of the same posts), then each edit round-trips
 * through Micropub q=source -> action:update, the same machinery the
 * journal write-back uses.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch { /* already present */ }

const MICROPUB = 'https://micro.blog/micropub';
const TOKEN = process.env.MICROBLOG_API_KEY;
if (!TOKEN) {
  console.error('MICROBLOG_API_KEY is not configured');
  process.exit(1);
}

const BLOG_POSTS = join(ROOT, '..', 'librarian-thing', 'data', 'blog', 'posts');
const PREFIX_RE = /Auto-generated description:\s*/g;

function affectedPostUrls(): string[] {
  const files = execSync(`grep -rl "Auto-generated description:" "${BLOG_POSTS}"`, {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
  const urls: string[] = [];
  for (const file of files) {
    const match = /^url:\s*"([^"]+)"/m.exec(readFileSync(file, 'utf8'));
    if (match) urls.push(match[1]!);
  }
  return urls;
}

async function fetchContent(url: string): Promise<string | null> {
  const q = new URL(MICROPUB);
  q.searchParams.set('q', 'source');
  q.searchParams.set('url', url);
  const res = await fetch(q, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`q=source failed: ${res.status}`);
  const body = (await res.json()) as { properties?: { content?: string[] } };
  return body.properties?.content?.[0] ?? null;
}

async function updateContent(url: string, content: string): Promise<void> {
  const res = await fetch(MICROPUB, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ action: 'update', url, replace: { content: [content] } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`update failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const oneIndex = process.argv.indexOf('--one');
  const only = oneIndex >= 0 ? process.argv[oneIndex + 1] : null;

  const urls = only ? [only] : affectedPostUrls();
  console.log(`${urls.length} post(s) to inspect`);

  let edited = 0;
  let clean = 0;
  let gone = 0;
  for (const url of urls) {
    const content = await fetchContent(url);
    if (content === null) {
      console.log(`GONE   ${url}`);
      gone++;
      continue;
    }
    const matches = content.match(PREFIX_RE)?.length ?? 0;
    if (!matches) {
      clean++;
      continue;
    }
    if (dryRun) {
      console.log(`WOULD  ${url} (${matches} prefix${matches === 1 ? '' : 'es'})`);
      edited++;
      continue;
    }
    await updateContent(url, content.replace(PREFIX_RE, ''));
    console.log(`FIXED  ${url} (${matches})`);
    edited++;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.log(`done: ${edited} ${dryRun ? 'would be ' : ''}edited, ${clean} already clean, ${gone} gone`);
}

await main();
