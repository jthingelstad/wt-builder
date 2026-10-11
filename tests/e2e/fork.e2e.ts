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
  // The row says so beside the rail, at full strength, not only in the Inspector.
  await expect(row.locator('.row-flag.forked')).toBeVisible();
  await expect(page.locator('.row-flag.forked')).toHaveCount(1);

  const heading = '[data-anchor="promoted-post"] h2 [contenteditable]';
  await caretAtEnd(page, heading);
  await page.keyboard.type(', for the newsletter');
  await commit(page, () => item().title === 'Minnesota Technology Council, for the newsletter');
  expect(item().sync_state).toBe('forked');
});

test("the fork is in the item's History at once, and in the Log under what Jamie did", async ({ page }, info) => {
  // WT353: the fork was found only after the fact (docs/event-log.md).
  await open(page);
  const row = page.locator('[data-anchor="journal-long"]');
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();
  const panel = page.locator('aside.panel');
  await panel.getByRole('button', { name: 'Fork for the newsletter' }).click();
  await expect.poll(() => store.getIssue(ISSUE)!.doc.items['journal-long']!.sync_state).toBe('forked');

  const history = panel.locator('details.history');
  await history.locator('summary').click();
  const forked = history.locator('.log-row', { hasText: 'Forked for the newsletter' }).first();
  await expect(forked).toBeVisible();
  await expect(forked).not.toHaveClass(/auto/);

  // A row the service made, in the Log beside it, and the filter that hides it.
  // The browsers share one database, so the row names its run.
  const written = `Write to Pinboard succeeded — e2e ${info.project.name} ${Date.now()}`;
  store.record(ISSUE, { kind: 'write', anchor: 'link-flipcash', summary: written });
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  const sheet = page.locator('.log-sheet');
  await expect(sheet.locator('.log-row.auto', { hasText: written })).toBeVisible();
  await sheet.getByLabel('Only what you did').check();
  await expect(sheet.getByText(written)).toHaveCount(0);
  await expect(sheet.locator('.log-row', { hasText: 'Forked for the newsletter' }).first()).toBeVisible();
});
