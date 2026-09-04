/** The draft share page. Pure rendering — no S3, no network. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { renderShareHtml, shareKey } from '../src/server/share.ts';

const doc = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;

describe('the share page says DRAFT, twice', () => {
  const html = renderShareHtml(doc, 'Early look — the **Notable** section is still moving.', '2026-09-04T12:00:00Z');

  it('banner up top, plea at the bottom, robots kept out', () => {
    expect(html).toContain('<strong>DRAFT</strong>');
    expect(html).toContain('unpublished draft');
    expect(html).toContain('noindex, nofollow');
    expect(html).toContain('<title>DRAFT · WT350</title>');
  });

  it('carries the note as a note from Jamie, markdown rendered', () => {
    expect(html).toContain('A note from Jamie');
    expect(html).toContain('<strong>Notable</strong>');
  });

  it('renders the actual issue, not a summary', () => {
    expect(html).toContain('The Weekly Thing 350');
    expect(html).toContain('Flipcash');
  });

  it('a share without a note has no empty note box', () => {
    expect(renderShareHtml(doc, undefined, '2026-09-04T12:00:00Z')).not.toContain('A note from Jamie');
    expect(renderShareHtml(doc, '  ', '2026-09-04T12:00:00Z')).not.toContain('A note from Jamie');
  });

  it('a hostile note is escaped, not executed', () => {
    const sharp = renderShareHtml(doc, '<script>alert(1)</script>', '2026-09-04T12:00:00Z');
    expect(sharp).not.toContain('<script>alert');
  });
});

describe('the share key', () => {
  it('is issue-prefixed and token-addressed', () => {
    expect(shareKey(350, 'abc123')).toBe('weekly-thing/drafts/wt350-abc123.html');
  });
});
