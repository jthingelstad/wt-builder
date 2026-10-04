/**
 * Pills that wait on the sections they are made from (src/shared/dependencies.ts).
 * The representative issue's Notable commentary and Intro are unfinished, so
 * Title and Outro wait. A wand on a waiting section asks before it drafts;
 * the draft route is intercepted, so no model is called.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, open, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

test('a waiting tick is hollow, says what it waits on, and is counted apart', async ({ page }) => {
  await open(page);
  await expect(page.locator('.tick.waiting')).toHaveCount(2);
  const outro = page.locator('.tick-wrap', { has: page.getByRole('button', { name: 'Outro — waiting' }) });
  await outro.hover();
  await expect(outro.locator('.tip-said')).toHaveText('Waiting on Intro (0 of 1)');
  await expect(outro.locator('.tip-state')).toHaveText('waiting');
  await expect(page.locator('.strip-readout')).toContainText('2 waiting');

  await page.locator('.strip-readout').click();
  const row = page.locator('.cl-row', { hasText: 'Outro' });
  await expect(row.locator('.cl-state')).toHaveText('WAITING');
  await expect(row).toContainText('Waiting on Intro (0 of 1).');
  await page.locator('.strip').screenshot({ path: 'tmp/e2e/strip-waiting.png' });
});

test('the Haiku wand asks before drafting while its inputs are unfinished', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.items['haiku-1']!.body = '';
  store.saveIssue(doc);

  const asked: string[] = [];
  const urls: string[] = [];
  await page.route(`**/api/issues/${ISSUE}/items/haiku-1/draft*`, (r) => {
    urls.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: ['One', 'Two'] }) });
  });
  await open(page);
  const wand = page.locator('[data-anchor="haiku-1"] .row-margin .wand');

  // Declined: nothing is asked of the server.
  page.once('dialog', (d) => { asked.push(d.message()); void d.dismiss(); });
  await wand.click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe("Notable isn't finished yet: Notable (0 of 2). Draft the Haiku anyway?");
  expect(urls).toHaveLength(0);

  // Accepted: drafted with force, and the picker opens.
  page.once('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  await wand.click();
  await expect(page.locator('.draft-picker .dp-option')).toHaveCount(2);
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain('?force=1');
});
