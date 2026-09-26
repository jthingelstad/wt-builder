/**
 * The progress strip, as a map of the issue: each finished tick in the hue
 * of what it is, its tooltip carrying the first words, and the readout
 * saying how long the issue runs aloud.
 */
import { expect, test } from '@playwright/test';
import { open, reset } from './helpers.ts';

test.beforeEach(() => reset());

test('finished ticks take the hue of what they are, and say what they hold', async ({ page }) => {
  await open(page);
  await expect(page.locator('.tick.done.hue-link').first()).toBeVisible();
  await expect(page.locator('.tick.done.hue-journal').first()).toBeVisible();
  const link = page.locator('.tick-wrap', { has: page.locator('.tick.done.hue-link') }).first();
  await link.hover();
  await expect(link.locator('.tip-said')).not.toBeEmpty();
  await expect(page.locator('.strip-readout')).toContainText('min aloud');
  await page.locator('.strip').screenshot({ path: 'tmp/e2e/strip.png' });
});
