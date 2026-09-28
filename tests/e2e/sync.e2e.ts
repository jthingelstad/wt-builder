/**
 * The way out of a conflict. The inspector offers Keep mine and Take theirs
 * in place of a retry the source would refuse again (review 2026-09-27,
 * §1.2 follow-on). Offline there is no Pinboard to read, so a choice must
 * change nothing and say why.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, item, open, reset, store } from './helpers.ts';

test.beforeEach(() => {
  reset();
  const doc = store.getIssue(ISSUE)!.doc;
  const link = doc.items['link-flipcash']!;
  link.sync_state = 'conflict';
  link.sync_error = 'edited both here and at Pinboard (commentary); your copy is kept until you choose';
  store.saveIssue(doc);
});

test('a conflicted link offers Keep mine and Take theirs, and an unreadable source changes nothing', async ({ page }) => {
  await open(page);
  const row = page.locator('[data-anchor="link-flipcash"]');
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();

  const panel = page.locator('aside.panel');
  await expect(panel.getByRole('button', { name: 'Keep mine' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Take theirs' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Retry write/ })).toHaveCount(0);

  const commentary = item('link-flipcash').commentary;
  await panel.getByRole('button', { name: 'Take theirs' }).click();
  await expect(page.locator('.error-bar')).toContainText('nothing changed');
  expect(item('link-flipcash').sync_state).toBe('conflict');
  expect(item('link-flipcash').commentary).toBe(commentary);
});

test('the checklist counts a conflict', async ({ request }) => {
  const { readiness } = await (await request.get(`/api/issues/${ISSUE}`)).json();
  const unit = readiness.units.find((u: { anchor: string; kind: string }) => u.anchor === 'link-flipcash' && u.kind === 'sync');
  expect(unit?.title).toContain('edited here and at Pinboard');
});
