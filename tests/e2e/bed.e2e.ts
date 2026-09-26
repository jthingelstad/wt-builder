/**
 * Put to bed: Jamie's last act on a sent issue. Asleep, the server refuses
 * every change, the index says so, and waking is one deliberate click.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, reset, store } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  reset();
  // These tests look at asleep rows, which the index hides by default.
  await page.addInitScript(() => localStorage.setItem('wt-builder:index-filters', JSON.stringify({ hideAsleep: false })));
});

test('a draft cannot be put to bed', async ({ request }) => {
  const res = await request.post(`/api/issues/${ISSUE}/bed`, { data: { asleep: true } });
  expect(res.status()).toBe(400);
});

test('asleep, the server refuses changes; the index and the issue say so; waking restores', async ({ page, request }) => {
  // Publish the fixture the way the send legs do: status published.
  const doc = store.getIssue(ISSUE)!.doc;
  doc.issue.status = 'published';
  store.saveIssue(doc);

  expect((await request.post(`/api/issues/${ISSUE}/bed`, { data: { asleep: true } })).status()).toBe(200);

  const edit = await request.patch(`/api/issues/${ISSUE}/items/link-functions`, { data: { commentary: 'changed' } });
  expect(edit.status()).toBe(423);
  expect(await edit.text()).toContain('put to bed');
  expect((await request.post(`/api/issues/${ISSUE}/send/website`, { data: {} })).status()).toBe(423);

  await page.goto('/');
  await expect(page.locator('.issue-row.asleep .ir-chip.asleep')).toContainText('PUT TO BED');

  await page.goto(`/${ISSUE}`);
  await expect(page.locator('.bed-bar')).toContainText('Put to bed');
  page.once('dialog', (d) => void d.accept());
  await page.locator('.bed-bar button').click();
  await expect(page.locator('.bed-bar')).toHaveCount(0);

  const after = await request.patch(`/api/issues/${ISSUE}/items/link-functions`, { data: { commentary: 'changed' } });
  expect(after.status()).toBe(200);
});

test('the index puts a published issue to bed, and wakes it', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.issue.status = 'published';
  store.saveIssue(doc);
  await page.goto('/');
  const row = page.locator('.issue-row', { hasText: 'WT350' });
  await row.getByRole('button', { name: 'Put to bed' }).click();
  await expect(row.locator('.ir-chip.asleep')).toContainText('PUT TO BED');
  expect(store.getIssue(ISSUE)!.doc.issue.put_to_bed_at).toBeTruthy();
  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Wake' }).click();
  await expect(row.locator('.ir-chip.asleep')).toHaveCount(0);
  expect(store.getIssue(ISSUE)!.doc.issue.put_to_bed_at).toBeUndefined();
});
