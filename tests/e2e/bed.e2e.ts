/**
 * Put to bed: Jamie's last act on a sent issue. Asleep, the server refuses
 * every change, the index says so, and waking is one deliberate click.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

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
