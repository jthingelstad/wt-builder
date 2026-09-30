/**
 * The link wand says when this exact link was in an earlier issue. The draft
 * route is intercepted with page.route, so no model is called; the answer is
 * hand-built the way the server shapes it (src/server/linked-before.ts).
 */
import { expect, test } from '@playwright/test';
import { ISSUE, item, open, reset } from './helpers.ts';

test.beforeEach(() => reset());

const route = `**/api/issues/${ISSUE}/items/link-flipcash/draft`;

test('the picker names the earlier issues in the attention colour, and a pick writes only the words', async ({ page }) => {
  await page.route(route, (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      candidates: ['First way of saying it.', 'Second way of saying it.'],
      linked_before: [
        { number: 274, publication_date: '2024-01-27' },
        { number: 120, publication_date: '2020-02-01' },
      ],
    }),
  }));
  await open(page);
  await page.locator('[data-anchor="link-flipcash"] .row-margin .wand').click();

  const linked = page.locator('.draft-picker .dp-linked');
  await expect(linked).toHaveText('Linked before in WT274 (2024-01-27), WT120 (2020-02-01)');
  await expect(linked.getByRole('link', { name: 'WT274' })).toHaveAttribute('href', 'https://weekly.thingelstad.com/archive/274/');
  const amber = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--amber').trim());
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  await expect(linked).toHaveCSS('color', rgb(amber));

  await page.locator('.draft-picker .dp-option').first().click();
  await expect.poll(() => String(item('link-flipcash').commentary)).toBe('First way of saying it.');
});

test('a link no earlier issue carried shows no such line', async ({ page }) => {
  await page.route(route, (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ candidates: ['Only way of saying it.'] }),
  }));
  await open(page);
  await page.locator('[data-anchor="link-flipcash"] .row-margin .wand').click();
  await expect(page.locator('.draft-picker .dp-option')).toHaveCount(1);
  await expect(page.locator('.draft-picker .dp-linked')).toHaveCount(0);
});
