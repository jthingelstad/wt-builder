/**
 * Row hints (src/shared/hints.ts) on the canvas: a mark beside the rail for a
 * link finding or an untrimmed title that opens the inspector, and a line
 * under words that stop mid-sentence, hidden while the row has the caret
 * (docs/mcp-ride-along-plan.md, Part B; WT352).
 */
import { expect, test } from '@playwright/test';
import { ISSUE, caretAtEnd, commit, item, open, reset, store } from './helpers.ts';

test.beforeEach(() => {
  reset();
  const doc = store.getIssue(ISSUE)!.doc;
  doc.items['link-flipcash']!.commentary = 'In short, dots feels more';
  doc.items['link-functions']!.title = 'LLMs are functions, not brains | Some Blog';
  const forge = doc.items['briefly-forge']!.source_url!;
  doc.link_check = { at: '2026-10-04T00:00:00Z', results: { [forge]: { verdict: 'dead', status: 404 } }, accepted: [] } as unknown as typeof doc.link_check;
  store.saveIssue(doc);
});

test('a dead link marks its row amber, an untrimmed title faintly, and the mark opens the inspector', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-anchor="briefly-forge"] .row-flag.link')).toBeVisible();
  await expect(page.locator('[data-anchor="link-functions"] .row-flag.title')).toBeVisible();
  await expect(page.locator('[data-anchor="briefly-shortcuts"] .row-flag')).toHaveCount(0);

  await page.locator('[data-anchor="link-functions"] .row-flag').click();
  const inspector = page.locator('aside.panel');
  await expect(inspector).toContainText('Hints');
  await expect(inspector).toContainText('still ends with “| Some Blog”');
});

test('words that stop mid-sentence say so, but not while the caret is in them', async ({ page }) => {
  await open(page);
  const hint = page.locator('[data-anchor="link-flipcash"] .row-hint');
  await expect(hint).toContainText('dots feels more');

  const sel = '[data-anchor="link-flipcash"] .post-body';
  await caretAtEnd(page, sel);
  await expect(hint).toBeHidden();
  await page.keyboard.type(' like a product.');
  await commit(page, () => String(item('link-flipcash').commentary).endsWith('product.'));
  await expect(page.locator('[data-anchor="link-flipcash"] .row-hint')).toHaveCount(0);
  // The pill was never the hint's: nothing here touched readiness.
});

test('editing an untrimmed title, the mark goes: Jamie has looked at it', async ({ page }) => {
  await open(page);
  const title = page.locator('[data-anchor="link-functions"] .link-title-text');
  await caretAtEnd(page, '[data-anchor="link-functions"] .link-title-text');
  for (let i = 0; i < ' | Some Blog'.length; i++) await page.keyboard.press('Backspace');
  await commit(page, () => item('link-functions').title === 'LLMs are functions, not brains');
  expect(item('link-functions').title_edited).toBe(true);
  await expect(title).toHaveText('LLMs are functions, not brains');
  await expect(page.locator('[data-anchor="link-functions"] .row-flag')).toHaveCount(0);
});
