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

test('a link finding is said under its own row, and the issue-wide summary is not pinned to one row', async ({ page }) => {
  await open(page);
  const note = page.locator('[data-anchor="briefly-forge"] .row-link-note');
  await expect(note).toContainText('A dead link (404)');
  await expect(page.locator('.row-owed', { hasText: 'The inspector has each one' })).toHaveCount(0);
  await expect(page.locator('[data-anchor="briefly-shortcuts"] .row-link-note')).toHaveCount(0);

  await note.click();
  await expect(page.locator('aside.panel')).toContainText('Dead (404)');
  await expect(page.locator('aside.panel')).toContainText('Keep as it is');
});

test('a haiku that is not 5-7-5 says what it counted, and a fix clears it (plan item 2)', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.items['haiku-1']!.body = 'Summer pages turn\nEach item finds a place\nOld echoes return';
  store.saveIssue(doc);
  await open(page);
  await expect(page.locator('[data-anchor="haiku-1"] .row-flag.link')).toBeVisible();
  const hint = page.locator('[data-anchor="haiku-1"] .row-hint');
  await expect(hint).toContainText('Counted 5-6-5 syllables, not 5-7-5');

  await page.locator('[data-anchor="haiku-1"] .row-flag').click();
  await expect(page.locator('aside.panel')).toContainText('Counted 5-6-5 syllables');

  // A hint, never a gate: the words save as typed, and the count follows them.
  const line = page.locator('[data-anchor="haiku-1"] .haiku');
  await line.click();
  await page.evaluate(() => {
    const el = document.querySelector('[data-anchor="haiku-1"] .haiku')!;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent!.indexOf('finds a');
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(n, at + 'finds '.length);
        range.setEnd(n, at + 'finds a'.length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        return;
      }
    }
  });
  await page.keyboard.type('its own');
  await commit(page, () => String(item('haiku-1').body).includes('finds its own place'));
  expect(item('haiku-1').body).toBe('Summer pages turn\nEach item finds its own place\nOld echoes return');
  await expect(page.locator('[data-anchor="haiku-1"] .row-hint')).toHaveCount(0);
  await expect(page.locator('[data-anchor="haiku-1"] .row-flag')).toHaveCount(0);
});
