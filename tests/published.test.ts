/**
 * Published is derived, never clicked: an issue is published the moment its
 * two reader-facing text legs — website and buttondown — have both gone out.
 * Before this derivation existed, nothing ever set the status, the next-issue
 * sheet offered the same number twice, and a sent issue vanished from the
 * website's prior-issues index.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const work = mkdtempSync(join(tmpdir(), 'wt-published-'));
process.env.WT_BUILDER_DB = join(work, 'published.db');

const store = await import('../src/server/db.ts');
const { createIssue } = await import('../src/server/issue.ts');

afterAll(() => {
  store.closeDb();
  rmSync(work, { recursive: true, force: true });
});

const sent = () => ({ status: 'sent' as const, at: new Date().toISOString() });
const failed = () => ({ status: 'failed' as const, at: new Date().toISOString(), error: 'x' });

describe('published derives from the sends', () => {
  it('one text leg alone is still a draft', () => {
    store.saveIssue(createIssue({ number: 990010, publication_date: '2026-09-05' }));
    const row = store.recordSend('wt990010', 'buttondown', sent());
    expect(row!.doc.issue.status).toBe('draft');
  });

  it('website + buttondown sent → published, logged, and counted', () => {
    const row = store.recordSend('wt990010', 'website', sent());
    expect(row!.doc.issue.status).toBe('published');
    expect(row!.status).toBe('published'); // the derived column agrees
    expect(store.lastPublishedNumber()).toBe(990010);
    const events = store.listEvents('wt990010');
    expect(events.some((e) => e.summary === 'Published — WT990010')).toBe(true);
  });

  it('a failed leg publishes nothing', () => {
    store.saveIssue(createIssue({ number: 990011, publication_date: '2026-09-12' }));
    store.recordSend('wt990011', 'buttondown', sent());
    const row = store.recordSend('wt990011', 'website', failed());
    expect(row!.doc.issue.status).toBe('draft');
  });

  it('publishing never runs backwards', () => {
    // A later failed re-send does not un-publish; the archive owns the truth.
    const row = store.recordSend('wt990010', 'website', failed());
    expect(row!.doc.issue.status).toBe('published');
  });
});
