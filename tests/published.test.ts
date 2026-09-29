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

  // Batch 4 carried a leg's last good send through a failed re-send, but
  // the derivation still read `status === 'sent'`: an email sent, then a
  // failed update of its draft, then the website, and the issue stayed a
  // draft, with Batch 7's locks, put to bed and the Archive all off.
  it('a leg that has sent counts, though a re-send of it failed since', () => {
    store.saveIssue(createIssue({ number: 990012, publication_date: '2026-09-19' }));
    store.recordSend('wt990012', 'buttondown', sent());
    store.recordSend('wt990012', 'buttondown', failed());
    const row = store.recordSend('wt990012', 'website', sent());
    expect(row!.doc.issue.status).toBe('published');
    expect(row!.status).toBe('published');
  });

  // The other side of the same rule: a leg that has only ever failed has
  // never gone out, whatever else has.
  it('website sent and Buttondown only ever failed is still a draft', () => {
    store.saveIssue(createIssue({ number: 990013, publication_date: '2026-09-26' }));
    store.recordSend('wt990013', 'buttondown', failed());
    store.recordSend('wt990013', 'buttondown', failed());
    const row = store.recordSend('wt990013', 'website', sent());
    expect(row!.doc.issue.status).toBe('draft');
    expect(row!.status).toBe('draft');
  });

  it('publishing never runs backwards', () => {
    // A later failed re-send does not un-publish; the archive owns the truth.
    const row = store.recordSend('wt990010', 'website', failed());
    expect(row!.doc.issue.status).toBe('published');
  });
});
