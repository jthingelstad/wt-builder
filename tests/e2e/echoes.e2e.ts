/**
 * The Echoes picker shows what the server's citation check found. The draft
 * route is intercepted with page.route, so no model and no Librarian is
 * called; the offer is hand-built with one grounded echo and one that is not.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, item, open, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

const offer = {
  candidates: [],
  echoes: [
    {
      text: 'The boat went in, as in [WT221](https://weekly.thingelstad.com/archive/221/).',
      archive_references: [{ kind: 'issue', issue: 221, url: 'https://weekly.thingelstad.com/archive/221/' }],
      ask: 'When does the boat go in?',
      grounding: { flags: [] },
    },
    {
      text: 'Invented: [WT199](https://weekly.thingelstad.com/archive/199/).',
      archive_references: [{ kind: 'issue', issue: 199, url: 'https://weekly.thingelstad.com/archive/199/' }],
      ask: 'What was in 199?',
      grounding: { flags: ['WT199 is not among the passages the archive returned'] },
    },
  ],
};

test('an ungrounded echo is flagged in the warning colour, still offered, and the flag is never saved', async ({ page }) => {
  await page.route(`**/api/issues/${ISSUE}/nodes/echoes/echoes/draft`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(offer) }));
  await open(page);
  await page.locator('[data-anchor="echoes"] .row-margin .wand').click();

  const picker = page.locator('.echoes-picker');
  await expect(picker.locator('.dp-option')).toHaveCount(2);
  await expect(picker.locator('.dp-option').nth(0).locator('.dp-flag')).toHaveCount(0);
  const flag = picker.locator('.dp-option').nth(1).locator('.dp-flag');
  await expect(flag).toHaveText('WT199 is not among the passages the archive returned');
  const amber = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--amber').trim());
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  await expect(flag).toHaveCSS('color', rgb(amber));

  // Flagged, not dropped: it can still be picked, and only its words land.
  await picker.locator('.dp-option').nth(1).click();
  await picker.getByRole('button', { name: /^Add 1 echo$/ }).click();
  await expect(picker).toHaveCount(0);
  const echoItems = () => store.getIssue(ISSUE)!.doc.nodes.find((n) => n.id === 'echoes')!.items;
  const before = 2;
  await expect.poll(() => echoItems().length).toBe(before + 1);
  const last = item(echoItems()[before]!);
  expect(last.body).toContain('WT199');
  expect(last).not.toHaveProperty('grounding');
});
