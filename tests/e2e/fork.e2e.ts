/**
 * Forking a promoted post for the newsletter (Jamie, 2026-10-10): "fork the
 * content that the newsletter will get so edit this but DO NOT change the
 * blog post it is sourced from." The saved item is the assertion: forked,
 * edits keep it forked, and no write-back is queued.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, caretAtEnd, commit, open, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

test('Fork for the newsletter keeps later edits off the blog', async ({ page }) => {
  const item = () => store.getIssue(ISSUE)!.doc.items['journal-long']!;
  await open(page);

  const row = page.locator('[data-anchor="journal-long"]');
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();
  const panel = page.locator('aside.panel');
  await panel.getByRole('button', { name: 'Fork for the newsletter' }).click();
  await expect.poll(() => item().sync_state).toBe('forked');
  await expect(panel.getByRole('button', { name: 'Rejoin the blog post' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Retry write/ })).toHaveCount(0);

  const heading = '[data-anchor="promoted-post"] h2 [contenteditable]';
  await caretAtEnd(page, heading);
  await page.keyboard.type(', for the newsletter');
  await commit(page, () => item().title === 'Minnesota Technology Council, for the newsletter');
  expect(item().sync_state).toBe('forked');
});
