/**
 * One link, however it was written (src/shared/links.ts). The cases are the
 * contract with the Librarian's linkUrlKey: fixtures/canonical-urls.json is
 * copied into librarian-thing's Lambda tests, so the two keys cannot drift
 * apart again (plan 2026-10-01 §3).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { canonicalUrl, hasTracking, linkKey, linkUrl, withoutTracking } from '../src/shared/links.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/canonical-urls.json', import.meta.url), 'utf8')) as {
  cases: { url: string; key: string; canonical: string }[];
  different: [string, string][];
};

describe('the shared canonical-URL fixtures', () => {
  for (const c of fixture.cases) {
    it(c.url, () => {
      expect(linkKey(c.url)).toBe(c.key);
      expect(canonicalUrl(c.url)).toBe(c.canonical);
    });
  }
  for (const [a, b] of fixture.different) {
    it(`${a} and ${b} are two links`, () => {
      expect(linkKey(a)).not.toBe(linkKey(b));
    });
  }
});

describe('canonicalUrl', () => {
  it('is null for anything that is not a web link', () => {
    expect(canonicalUrl('mailto:jamie@example.com')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
    expect(linkKey('')).toBeNull();
  });
});

describe('the link an item renders with', () => {
  it('is the applied canonical, else the bookmark', () => {
    expect(linkUrl({ source_url: 'https://t.co/x' })).toBe('https://t.co/x');
    expect(linkUrl({ source_url: 'https://t.co/x', canonical_url: 'https://example.com/a' })).toBe('https://example.com/a');
  });
});

describe('tracking', () => {
  it('drops tracking and the fragment, and nothing else', () => {
    expect(withoutTracking('https://www.example.com/a/?utm_source=x&id=2#top')).toBe('https://www.example.com/a/?id=2');
    expect(hasTracking('https://example.com/a?utm_medium=email')).toBe(true);
    expect(hasTracking('https://example.com/a?id=2')).toBe(false);
  });
});
