/**
 * Getting around the page: navigation scrolls, and never opens the
 * inspector unless the item itself was clicked (Jamie, WT351).
 */
import { expect, test } from '@playwright/test';
import { open, reset } from './helpers.ts';

test.beforeEach(() => reset());

const scrollTop = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.querySelector('.canvas')!.scrollTop);

test('a progress-strip pill scrolls to its item and opens nothing', async ({ page }) => {
  await open(page);
  const ticks = page.locator('.strip button');
  const n = await ticks.count();
  const before = await scrollTop(page);
  await ticks.nth(n - 3).click();
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + 200);
  await expect(page.locator('.row.selected')).toHaveCount(0);
  await expect(page.getByText('PROVENANCE')).toHaveCount(0);
});

test('a file held over the photo shows the drop is received', async ({ page }) => {
  await open(page);
  const zone = page.locator('.photo-set, .photo-drop').first();
  await zone.scrollIntoViewIfNeeded();
  const prevented = await zone.evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
    el.dispatchEvent(over);
    return over.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(zone).toHaveClass(/over/);
});

test('a file dropped off the photo zone does not navigate away', async ({ page }) => {
  await open(page);
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    document.body.dispatchEvent(drop);
    return drop.defaultPrevented;
  });
  expect(prevented).toBe(true);
});

test('the wand is not offered on the intro or outro', async ({ page }) => {
  await open(page);
  // A link has one — so the selector is right and the absence below means it.
  await expect(page.locator('[data-anchor="link-functions"] .wand')).toHaveCount(1);
  for (const id of ['intro-1', 'outro-1']) {
    await expect(page.locator(`[data-anchor="${id}"] .wand`)).toHaveCount(0);
  }
});
