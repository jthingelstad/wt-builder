/**
 * Deliverability on the Send card (2026-10-01). Offline no blocklist is
 * asked, so the lookups are seeded; what is asserted is what the server
 * saved after each click.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, item, reset, store } from './helpers.ts';

const PLAIN = 'http://old.example.net/page';

test.beforeEach(() => {
  reset();
  const doc = store.getIssue(ISSUE)!.doc;
  const link = doc.items['link-flipcash']!;
  link.commentary = `${link.commentary ?? ''} An [older piece](${PLAIN}).`;
  const at = '2026-10-01T12:00:00.000Z';
  doc.domain_check = {
    at,
    results: { 'avc.xyz': { verdict: 'listed', lists: ['URIBL: red list'], asked: ['URIBL'], checked_at: at } },
  };
  store.saveIssue(doc);
});

test('the Send card names a listed domain and a finding, and Keep stops asking about the finding', async ({ page }) => {
  await page.goto(`/${ISSUE}/send`);
  const row = page.locator('.send-mail');
  await expect(row.getByText(/1 domain on a spam blocklist/)).toBeVisible();
  await expect(row.getByText('avc.xyz')).toBeVisible();
  await expect(row.getByText(/A plain http:\/\/ link — old\.example\.net/)).toBeVisible();
  await row.getByRole('button', { name: 'Keep' }).click();
  await expect(row.getByText(/A plain http:\/\/ link/)).toHaveCount(0);
  expect(store.getIssue(ISSUE)!.doc.deliverability!.kept).toEqual([`http:${PLAIN}`]);
  // Keeping a finding changes nothing in the issue itself.
  expect(item('link-flipcash').commentary).toContain(PLAIN);
});
