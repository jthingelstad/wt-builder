/**
 * A published issue: fixes and re-sends follow publishing, so its text stays
 * editable until it is put to bed. What made the edition — its number, date
 * and window — does not (review 2026-09-27, §2.5).
 */
import { expect, test } from '@playwright/test';
import { ISSUE, item, open, reset, store } from './helpers.ts';

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

test('published, the title and dek are edited in the panel and saved', async ({ page }) => {
  publish();
  await open(page);
  const panel = page.locator('.left-panel');
  await panel.getByRole('button', { name: 'Edit' }).click();
  const title = panel.getByLabel('TITLE · IN THE EMAIL SUBJECT');
  const dek = panel.getByLabel('DEK', { exact: true });
  await title.fill('A title fixed after sending');
  await dek.fill('A dek fixed after sending');
  await title.focus(); // blur the dek, which commits it
  await title.blur();
  await expect.poll(() => store.getIssue(ISSUE)!.doc.issue.title).toBe('A title fixed after sending');
  await expect.poll(() => store.getIssue(ISSUE)!.doc.issue.dek).toBe('A dek fixed after sending');
});

// Editable until put to bed (Jamie, 2026-09-28): fixes and re-sends follow
// publishing, and put to bed is the only freeze.
test('published and awake, the canvas still edits and saves; structure is a draft\'s', async ({ page }) => {
  publish();
  await open(page);
  await expect(page.locator('.lens-kicker .kicker')).toHaveText('WEBSITE — PUBLISHED · EDITS NEED A RE-SEND');
  // Structure stays a draft's: no insert points, add chips, or ordering and Echoes wands.
  await expect(page.locator('.insert-point')).toHaveCount(0);
  await expect(page.locator('.ghost-chip')).toHaveCount(0);
  await expect(page.locator('[data-anchor="notable"] .row-margin .wand')).toHaveCount(0);

  // Text affordances stay: the item's rail and its wand.
  await expect(page.locator('[data-anchor="link-functions"] .rail-btn[aria-label="Move up"]')).toHaveCount(1);
  await expect(page.locator('[data-anchor="link-functions"] .wand')).toHaveCount(1);

  const run = page.locator('[data-anchor="link-functions"] .post-body');
  await expect(run).toHaveAttribute('contenteditable', 'plaintext-only');
  await run.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Fixed after sending.');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => String(item('link-functions').commentary)).toContain('Fixed after sending.');
});

test('put to bed, nothing is offered: no editable run, rail, wand, field, or button that changes anything', async ({ page, request }) => {
  publish();
  expect((await request.post(`/api/issues/${ISSUE}/bed`, { data: { asleep: true } })).status()).toBe(200);
  await open(page);
  await expect(page.locator('.bed-bar')).toContainText('Put to bed');
  await expect(page.locator('.lens-kicker .note')).toContainText('Nothing in WT350 can change');

  // The canvas: no editable run anywhere, no rail button but Inspect (which
  // only reads), no wand, no chip.
  await expect(page.locator('[data-anchor="link-functions"] .post-body')).not.toHaveAttribute('contenteditable', /.*/);
  await expect(page.locator('.rows [contenteditable]')).toHaveCount(0);
  await expect(page.locator('.rows .rail-btn:not([aria-label="Inspect"])')).toHaveCount(0);
  await expect(page.locator('[data-anchor="link-functions"] .rail-btn')).toHaveCount(1);
  await expect(page.locator('.rows .wand')).toHaveCount(0);
  await expect(page.locator('.ghost-chip, .insert-point, .photo-actions')).toHaveCount(0);
  await expect(page.locator('.held-strip button')).toHaveCount(0);

  // The panel: no Edit, Re-scan, or Share; the outline only navigates.
  const panel = page.locator('.left-panel');
  for (const name of ['Edit', 'Re-scan', 'Share', '+ Section', '+ Markdown']) {
    await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(panel.locator('.ol-actions, .absent')).toHaveCount(0);
  await expect(panel.locator('.ol-row[draggable="true"]')).toHaveCount(0);

  // Collapse: sections open, nothing moves.
  await page.getByRole('button', { name: 'Collapse' }).click();
  await expect(page.locator('.cv-actions')).toHaveCount(0);
  await expect(page.locator('.cv-row[draggable="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse' }).click();

  // The Inspector: every field read-only, and no button that writes.
  await page.locator('[data-anchor="link-functions"] .rail-btn[aria-label="Inspect"]').click();
  const inspector = page.locator('aside.panel');
  await expect(inspector).toContainText('put to bed');
  await expect(inspector.locator('input:not([readonly]), textarea:not([readonly])')).toHaveCount(0);
  for (const name of ['Hide', 'Retry write to Pinboard', 'Keep mine', 'Take theirs', 'Mark reviewed', 'Mark draft']) {
    await expect(inspector.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(inspector.locator('.edition-buttons button:not([disabled])')).toHaveCount(0);

  // The server is still the backstop.
  const edit = await request.patch(`/api/issues/${ISSUE}/items/link-functions`, { data: { commentary: 'changed' } });
  expect(edit.status()).toBe(423);
});
