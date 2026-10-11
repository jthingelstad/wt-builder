/**
 * The tripwire behind the vendored parser: when the sibling checkout of
 * another.thingelstad.com is present, extract parseFrontmatter and
 * computePermalink from its live lib/loadEpisodes.js and prove they still
 * behave exactly like our vendored copies. If Another's parser changes,
 * this fails here before a subscriber's client finds out.
 *
 * Skipped (cleanly, by name) when the sibling repo is not on disk — CI
 * checks out this repo alone.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { computePermalink, parseFrontmatter } from './podcast-vendored-parser.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const livePath = resolve(
  __dirname,
  '../../another.thingelstad.com/lib/loadEpisodes.js',
);

// Slices a top-level `function name(...) { ... }` out of the source by brace
// counting. The parser functions contain no unbalanced braces in strings or
// regexes; if that ever changes the instantiation below throws, which is
// itself the drift signal.
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) {
    throw new Error(
      `function ${name} not found in loadEpisodes.js — Another refactored; re-vendor tests/podcast-vendored-parser.ts`,
    );
  }
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`function ${name} in loadEpisodes.js has unbalanced braces`);
}

function instantiate<T>(source: string, name: string): T {
  return new Function(`return (${extractFunction(source, name)});`)() as T;
}

describe.runIf(existsSync(livePath))(
  'vendored parser matches the live another.thingelstad.com parser',
  () => {
    // Deferred to beforeAll: the describe body executes at collection time
    // even when runIf skips the suite, and the sibling repo is absent in CI.
    let liveParseFrontmatter: typeof parseFrontmatter;
    let liveComputePermalink: typeof computePermalink;

    beforeAll(() => {
      const liveSource = readFileSync(livePath, 'utf-8');
      liveParseFrontmatter = instantiate(liveSource, 'parseFrontmatter');
      liveComputePermalink = instantiate(liveSource, 'computePermalink');
    });

    const frontmatterFixtures: Record<string, string> = {
      'a full episode header': [
        '---',
        'title: What does an archive owe its author?',
        'number: 2',
        'slug: what-does-an-archive-owe',
        'date: 2026-09-14T19:30:00-05:00',
        'audio: /uploads/2026/another-thing-2.mp3',
        'transcript: 002-what-does-an-archive-owe.txt',
        'summary: Nine years of newsletters, one corpus.',
        'guid: https://another.thingelstad.com/2026/09/15/what-does-an-archive-owe.html',
        'guidIsPermalink: true',
        '---',
        '',
        'Show notes body.',
      ].join('\n'),
      'quoted and typed values': [
        '---',
        'double: "quoted value"',
        "single: 'quoted value'",
        'yes: true',
        'no: false',
        'count: 42',
        'negative: -7',
        'notNumber: 1.5',
        'empty:',
        '# a comment line',
        '',
        'url: https://example.com/a:b',
        '---',
        'body',
      ].join('\n'),
      'crlf line endings': '---\r\ntitle: CRLF\r\nnumber: 3\r\n---\r\nbody\r\n',
      'no frontmatter at all': 'Just a body with --- inside it.\n',
      'key without colon ignored': '---\ntitle: ok\nmalformed line\n---\nbody',
    };

    it('parses frontmatter identically', () => {
      for (const [label, raw] of Object.entries(frontmatterFixtures)) {
        expect(parseFrontmatter(raw), label).toEqual(liveParseFrontmatter(raw));
      }
    });

    it('derives permalinks identically, including the UTC day roll', () => {
      const cases: Array<[string, string]> = [
        ['2026-09-14T19:30:00-05:00', 'evening-central-rolls-to-next-utc-day'],
        ['2026-01-05T10:00:00Z', 'single-digit-month-and-day'],
        ['2026-12-31T23:30:00-01:00', 'year-boundary'],
        ['2026-06-15T00:00:00Z', 'midnight-utc'],
      ];
      for (const [iso, slug] of cases) {
        const date = new Date(iso);
        expect(computePermalink(date, slug), iso).toBe(
          liveComputePermalink(date, slug),
        );
      }
    });
  },
);
