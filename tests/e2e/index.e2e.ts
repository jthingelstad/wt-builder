/**
 * The index: filters, and a row that keeps its title readable however many
 * chips and buttons it carries.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, reset, store } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  reset();
  await page.addInitScript(() => localStorage.clear());
});

function asPublished(asleep: boolean) {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.issue.status = 'published';
  if (asleep) doc.issue.put_to_bed_at = new Date().toISOString();
  else delete doc.issue.put_to_bed_at;
  store.saveIssue(doc);
}

test('put-to-bed issues are hidden by default, and shown on demand', async ({ page }) => {
  asPublished(true);
  await page.goto('/');
  await expect(page.locator('.issue-row', { hasText: 'WT350' })).toHaveCount(0);
  await expect(page.locator('.if-count')).toContainText('1 asleep hidden');
  await page.getByLabel('Hide put to bed').uncheck();
  await expect(page.locator('.issue-row', { hasText: 'WT350' })).toHaveCount(1);
});

test('year and search narrow the list; a miss offers to clear', async ({ page }) => {
  asPublished(false);
  await page.goto('/');
  await page.getByLabel('Year').selectOption('2026');
  await expect(page.locator('.issue-row', { hasText: 'WT350' })).toHaveCount(1);
  await page.getByPlaceholder('Search titles or numbers').fill('wt999');
  await expect(page.locator('.issue-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.issue-row', { hasText: 'WT350' })).toHaveCount(1);
});

test('a row with every chip and button keeps its title on one line', async ({ page }) => {
  asPublished(false);
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto('/');
  const row = page.locator('.issue-row', { hasText: 'WT350' });
  const title = row.locator('.ir-title');
  const box = await title.boundingBox();
  expect(box!.height).toBeLessThan(26); // one line at 19.2px line-height
  await row.screenshot({ path: 'tmp/e2e/index-row.png' });
});

test('the filter bar stays put while the list under it changes', async ({ page }) => {
  asPublished(false);
  await page.goto('/');
  const where = async () => ({
    toggle: await page.locator('.if-toggle').boundingBox(),
    year: await page.getByLabel('Year').boundingBox(),
  });
  const before = await where();
  await page.getByPlaceholder('Search titles or numbers').fill('wt999');
  await expect(page.locator('.issue-row')).toHaveCount(0);
  const empty = await where();
  await page.getByPlaceholder('Search titles or numbers').fill('');
  await page.getByLabel('Year').selectOption('2026');
  const narrowed = await where();
  for (const now of [empty, narrowed]) {
    expect(now.toggle!.x).toBe(before.toggle!.x);
    expect(now.toggle!.y).toBe(before.toggle!.y);
    expect(now.year!.x).toBe(before.year!.x);
  }
});
