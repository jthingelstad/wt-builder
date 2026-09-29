/**
 * A published issue: fixes and re-sends follow publishing, so its text stays
 * editable until it is put to bed. What made the edition — its number, date
 * and window — does not (review 2026-09-27, §2.5).
 */
import { expect, test } from '@playwright/test';
import { ISSUE, open, reset, store } from './helpers.ts';

test.beforeEach(() => {
  reset();
});

function publish(): void {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.issue.status = 'published';
  store.saveIssue(doc);
}

test('published, the number, date and window are facts, and there is no Re-scan', async ({ page }) => {
  publish();
  await open(page);
  const panel = page.locator('.left-panel');
  await expect(panel.locator('.meta-card').first()).toContainText('Publishes');
  await expect(panel.getByRole('button', { name: 'Re-scan' })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Edit' }).click();
  const meta = panel.locator('.meta-card.edit');
  await expect(meta).toContainText('fixed');
  await expect(meta.locator('input[type="number"], input[type="date"]')).toHaveCount(0);
  await expect(meta.locator('.chip')).toHaveCount(0);
  await expect(meta.getByRole('button', { name: 'Re-scan' })).toHaveCount(0);
});

test('a draft still edits its number, date and window, and re-scans', async ({ page }) => {
  await open(page);
  const panel = page.locator('.left-panel');
  await expect(panel.getByRole('button', { name: 'Re-scan' })).toHaveCount(1);
  await panel.getByRole('button', { name: 'Edit' }).click();
  const meta = panel.locator('.meta-card.edit');
  await expect(meta.locator('input[type="number"]').first()).toBeVisible();
  await expect(meta.locator('input[type="date"]')).toBeVisible();
});
