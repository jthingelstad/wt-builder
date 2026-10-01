/**
 * The link check's findings in the inspector and on the Send card (plan
 * 2026-10-01 §3). Offline nothing is fetched, so the check's results are
 * seeded; what is asserted is what the server saved after each click.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, item, open, reset, store } from './helpers.ts';

const LINK = 'https://avc.xyz/create-your-own-currency-with-flipcash';
const SUGGESTED = 'https://avc.xyz/2026/05/flipcash';
const DEAD = 'https://james-pritchard.com/blog/llms-are-functions';

test.beforeEach(() => {
  reset();
  const doc = store.getIssue(ISSUE)!.doc;
  const at = '2026-10-01T12:00:00.000Z';
  doc.link_check = {
    at,
    results: {
      [LINK]: { verdict: 'moved', status: 200, canonical_hint: SUGGESTED, suggestion: SUGGESTED, checked_at: at },
      [DEAD]: { verdict: 'dead', status: 404, checked_at: at },
    },
  };
  store.saveIssue(doc);
});

const inspect = async (page: import('@playwright/test').Page, anchor: string) => {
  const row = page.locator(`[data-anchor="${anchor}"]`);
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();
  return page.locator('aside.panel');
};

test('use the suggested link prints it, and the bookmark keeps its own URL', async ({ page }) => {
  await open(page);
  const panel = await inspect(page, 'link-flipcash');
  await expect(panel.getByText('Moved — the page names another as its own')).toBeVisible();
  await panel.getByRole('button', { name: 'Use the suggested link' }).click();
  await expect(panel.getByRole('button', { name: "Back to the bookmark's link" })).toBeVisible();
  expect(item('link-flipcash').canonical_url).toBe(SUGGESTED);
  expect(item('link-flipcash').source_url).toBe(LINK);
  // The canvas prints the new link.
  await expect(page.locator(`[data-anchor="link-flipcash"] a[href="${SUGGESTED}"]`).first()).toBeVisible();
});

test('keep as it is stops asking about a dead link', async ({ page }) => {
  await open(page);
  const panel = await inspect(page, 'link-functions');
  await expect(panel.getByText('Dead (404)')).toBeVisible();
  await panel.getByRole('button', { name: 'Keep as it is' }).click();
  await expect(panel.getByText('Dead (404)')).toHaveCount(0);
  expect(store.getIssue(ISSUE)!.doc.link_check!.accepted).toEqual([DEAD]);
});

test('the Send card says what the check found and offers to check again', async ({ page }) => {
  await page.goto(`/${ISSUE}/send`);
  await expect(page.getByText(/Links: 1 dead, 1 moved or shortened/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
});
