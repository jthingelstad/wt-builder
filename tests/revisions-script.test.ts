/**
 * `npm run revisions` is the way back from a delete (DELETE /api/issues/:id
 * keeps the document as it stood among its revisions). It must still read an
 * issue whose row is gone, and bring it back when asked. Run as a script,
 * against a throwaway database.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const work = mkdtempSync(join(tmpdir(), 'wt-revisions-'));
process.env.WT_BUILDER_DB = join(work, 'revisions.db');

const store = await import('../src/server/db.ts');
const issues = await import('../src/server/issue.ts');

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'scripts/revisions.ts', ...args], {
    cwd: root, encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, WT_BUILDER_OFFLINE: '1', WT_BUILDER_DB: process.env.WT_BUILDER_DB },
  });

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('npm run revisions brings a deleted draft back', () => {
  const doc = issues.createIssue({ number: 990101, publication_date: '2026-12-05', window_days: 7 });
  const id = doc.issue.id;

  it('lists the versions of an issue whose row is gone, and says how to restore it', () => {
    store.saveIssue(doc);
    doc.items['intro-1']!.body = 'The first thing it said.';
    store.saveIssue(doc);
    doc.items['intro-1']!.body = 'The last thing it said.';
    doc.issue.title = 'Kept';
    store.saveIssue(doc);
    store.deleteIssue(id);
    expect(store.getIssue(id)).toBeNull();

    const listed = run(id, 'intro-1');
    expect(listed.stderr).not.toContain('no issue');
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain('The first thing it said.');
    expect(listed.stdout).toContain('The last thing it said.');
    expect(listed.stdout).toContain('--restore');
    expect(store.getIssue(id)).toBeNull(); // listing never writes
  }, 30_000);

  it('--restore recreates the row from the newest revision', () => {
    const restored = run(id, '--restore');
    expect(restored.status).toBe(0);
    const row = store.getIssue(id);
    expect(row?.doc.issue.title).toBe('Kept');
    expect(row?.doc.items['intro-1']?.body).toBe('The last thing it said.');
    expect(store.listEvents(id).some((e) => e.summary.includes('Restored'))).toBe(true);
  }, 30_000);

  it('--restore refuses an issue that is not deleted', () => {
    const again = run(id, '--restore');
    expect(again.status).not.toBe(0);
    expect(again.stderr).toContain('not deleted');
  }, 30_000);
});
