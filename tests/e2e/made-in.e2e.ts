/**
 * The Made in card on the Send view (design D, 2026-10-04). It is meant to
 * be shared, so it shows each day's total and never when a sitting happened
 * (Jamie, 2026-10-04). The timing route is answered here with sittings at
 * known clock times, and none of those times may reach the card.
 */
import { expect, test } from '@playwright/test';
import { open, reset } from './helpers.ts';

test.beforeEach(() => reset());

const M = 60_000;
const day = (d: string, label: string, sittings: number, minutes: number, added: number) =>
  ({ day: d, label, sittings, ms: minutes * M, added });

const timing = {
  // Sittings at 20:47 and 09:13 UTC — 3:47 PM and 4:13 AM Central.
  sessions: [
    { start: '2026-09-28T20:47:00.000Z', end: '2026-09-28T20:50:00.000Z', ms: 3 * M, actions: 4 },
    { start: '2026-09-29T09:13:00.000Z', end: '2026-09-29T09:22:00.000Z', ms: 9 * M, actions: 9 },
    { start: '2026-10-04T14:30:00.000Z', end: '2026-10-04T16:15:00.000Z', ms: 105 * M, actions: 60 },
  ],
  byDay: [
    day('2026-09-25', 'Fri, Sep 25', 0, 0, 6),
    day('2026-09-28', 'Mon, Sep 28', 1, 3, 8),
    day('2026-09-29', 'Tue, Sep 29', 1, 9, 0),
    day('2026-10-04', 'Sun, Oct 4', 1, 105, 0),
  ],
  activeMs: 117 * M,
  actions: 73,
  edits: 40,
  publishedAt: '2026-10-04T16:15:36.423Z',
  sendMs: 3 * M,
  after: { actions: 0, sends: 0, ms: 0 },
  bySection: [{ label: 'Notable', ms: 60 * M }, { label: 'Briefly', ms: 30 * M }, { label: 'Other', ms: 27 * M }],
};

test('the card shows days and totals, never a clock time', async ({ page }) => {
  await page.route('**/api/issues/*/timing', (route) => route.fulfill({
    json: { timing, previous: { number: 349, timing: { ...timing, activeMs: 150 * M } }, shipped: [] },
  }));
  await open(page, '/send');
  const card = page.locator('.send-card.timing');
  await expect(card).toBeVisible();

  await expect(card.locator('.mi-eyebrow')).toHaveText('WHAT IT TOOK · THE WEEKLY THING 350');
  await expect(card.locator('.mi-pill')).toHaveText('33 m less than WT349');
  // No sentence on top (Jamie chose D without it).
  await expect(card.getByText(/Made in/)).toHaveCount(0);

  const values = await card.locator('.mi-value').allInnerTexts();
  const labels = await card.locator('.mi-label').allInnerTexts();
  expect(values[0]).toBe('1 h 57 m');
  expect(labels[0]).toBe('writing, over 3 days');
  expect(values[1]).toBe('3');
  expect(labels[1]).toBe('sittings');
  expect(labels[2]).toMatch(/^pills, (all|\d+) done$/);
  expect(values[3]).toBe('3 m');

  await expect(card.locator('.mi-tile')).toHaveCount(timing.byDay.length);
  expect(await card.locator('.mi-dow').allInnerTexts()).toEqual(['Fri', 'Mon', 'Tue', 'Sun']);
  expect(await card.locator('.mi-tile').allInnerTexts()).toEqual(['', '3 m', '9 m', '1h45']);
  await expect(card.locator('.mi-foot')).toContainText('Sunday turned them into an issue, with nothing to fix after it went.');

  // Every word and every tooltip: no clock time.
  const text = await card.innerText();
  const titles = await card.locator('[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title')).join(' '));
  for (const t of [text, titles]) {
    expect(t).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(t).not.toMatch(/\b(AM|PM)\b/i);
  }
});
