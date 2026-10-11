/**
 * The Stats view's What's in it and Across issues cards (2026-10-11), on the
 * representative issue: drawn from the server's own count, beside Made in.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, open, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

test("What's in it and Across issues follow Made in, counted from the issue", async ({ page }) => {
  await open(page, '/stats');
  const n = store.getIssue(ISSUE)!.doc.issue.number;

  const inIt = page.locator('.stats-card.in-it');
  await expect(inIt.locator('.mi-eyebrow')).toHaveText(`WHAT'S IN IT · THE WEEKLY THING ${n}`);
  const labels = await inIt.locator('.mi-label').allInnerTexts();
  expect(labels[0]).toMatch(/^words, \d+ minutes? to read$/);
  expect(labels[1]).toMatch(/^links?, (all|\d+) new$|^links$/);
  await expect(inIt.locator('.mi-bar span').first()).toBeVisible();
  await expect(inIt.getByText('WHERE IT CAME FROM')).toBeVisible();

  const across = page.locator('.stats-card.across');
  await expect(across.locator('.st-strip')).toHaveCount(3);
  // This issue is marked on the words strip, and is its own row in the table.
  await expect(across.locator('.st-strip').first().locator('.st-here')).toBeVisible();
  await expect(across.locator('.st-table tr.current td').first()).toHaveText(`WT${n}`);

  // In the order Jamie asked for: what it took first. Made in is its card
  // or its empty line, as the shared test database's event log has it.
  await expect(page.locator('.send-card.timing, .stats-empty')).toBeVisible();
  const order = await page.locator('.stats-layer .send-body > :not(h1):not(.lede)')
    .evaluateAll((els) => els.map((e) => e.className.split(' ').pop()));
  expect(['timing', 'stats-empty']).toContain(order[0]);
  expect(order.slice(1)).toEqual(['in-it', 'across']);
});
