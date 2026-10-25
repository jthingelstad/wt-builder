/**
 * The Quote on the canvas: the words, who said them, and Jamie's line under
 * it, each typed in place and asserted by what the server saved (WT354).
 */
import { expect, test } from '@playwright/test';
import { caretAtEnd, commit, item, open, reset } from './helpers.ts';

const quote = '[data-anchor="quote-kay"]';

test.beforeEach(() => reset());

test('the name and the line show at rest and save what is typed', async ({ page }) => {
  await open(page);
  await expect(page.locator(`${quote} .pull-quote-who`)).toHaveText('Alan Kay');
  await expect(page.locator(`${quote} .pull-quote-line`)).toHaveText('A design rule I keep coming back to.');

  await caretAtEnd(page, `${quote} .pull-quote-who`);
  await page.keyboard.type(', 1971');
  await commit(page, () => item('quote-kay').attribution === 'Alan Kay, 1971');
  expect(item('quote-kay').attribution).toBe('Alan Kay, 1971');

  await caretAtEnd(page, `${quote} .pull-quote-line`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('And a second paragraph.');
  await commit(page, () => String(item('quote-kay').commentary ?? '').includes('second'));
  expect(item('quote-kay').commentary).toBe('A design rule I keep coming back to.\n\nAnd a second paragraph.');
});

test('a linked name reads as a link at rest', async ({ page }) => {
  await open(page);
  await caretAtEnd(page, `${quote} .pull-quote-who`);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('[Alan Kay](https://example.com/kay)');
  await commit(page, () => String(item('quote-kay').attribution ?? '').startsWith('['));
  expect(item('quote-kay').attribution).toBe('[Alan Kay](https://example.com/kay)');
  await expect(page.locator(`${quote} .pull-quote-who a`)).toHaveAttribute('href', 'https://example.com/kay');
});

test('the outline offers Quote back once it is removed', async ({ page }) => {
  await open(page);
  const row = page.locator('.ol-row', { hasText: 'Quote' });
  await row.hover();
  await row.locator('button[title="Remove section"]').click();
  const chip = page.locator('.absent .chip', { hasText: 'Quote' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.locator(`${quote} .pull-quote-who`)).toHaveText('Alan Kay');
});
