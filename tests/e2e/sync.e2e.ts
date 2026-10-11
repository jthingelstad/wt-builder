/**
 * The way out of a conflict. The inspector offers Keep mine and Take theirs
 * in place of a retry the source would refuse again (review 2026-09-27,
 * §1.2 follow-on). Offline there is no Pinboard to read, so a choice must
 * change nothing and say why.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, caretAtEnd, commit, item, open, reset, store } from './helpers.ts';

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

// A later save that succeeds clears only an error a failed save put up. The
// refusal here came from the inspector, and an unrelated edit landing wiped
// it before Jamie could read it (review 2026-09-27, §1.4).
test("a save that succeeds leaves an error it did not cause", async ({ page }) => {
  await open(page);
  const row = page.locator('[data-anchor="link-flipcash"]');
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();
  await page.locator('aside.panel').getByRole('button', { name: 'Take theirs' }).click();
  await expect(page.locator('.error-bar')).toContainText('nothing changed');

  const sel = '[data-anchor="link-functions"] .post-body';
  await caretAtEnd(page, sel);
  await page.keyboard.type('Saved meanwhile.');
  await commit(page, () => String(item('link-functions').commentary ?? '').includes('Saved meanwhile.'));
  await page.waitForTimeout(300);
  await expect(page.locator('.error-bar')).toContainText('nothing changed');
});

test('the checklist counts a conflict', async ({ request }) => {
  const { readiness } = await (await request.get(`/api/issues/${ISSUE}`)).json();
  const unit = readiness.units.find((u: { anchor: string; kind: string }) => u.anchor === 'link-flipcash' && u.kind === 'sync');
  expect(unit?.title).toContain('edited here and at Pinboard');
});

test('the Inspector says what a link came in as, once its words differ (2026-10-11)', async ({ page }) => {
  // Moved here from the Source lens when that was removed.
  const doc = store.getIssue(ISSUE)!.doc;
  const link = doc.items['link-functions']!;
  link.source_snapshot = { commentary: 'The words Pinboard had.' };
  doc.items['briefly-forge']!.source_snapshot = { commentary: doc.items['briefly-forge']!.commentary };
  store.saveIssue(doc);
  await open(page);
  const inspect = async (id: string) => {
    const row = page.locator(`[data-anchor="${id}"]`);
    await row.hover();
    await row.getByRole('button', { name: 'Inspect' }).click();
  };
  await inspect('link-functions');
  const panel = page.locator('aside.panel');
  await expect(panel.locator('.kv', { hasText: 'As imported' })).toContainText('“The words Pinboard had.”');
  // Unchanged words say nothing.
  await inspect('briefly-forge');
  await expect(panel.locator('.kv', { hasText: 'As imported' })).toHaveCount(0);
});
