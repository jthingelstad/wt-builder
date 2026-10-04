/**
 * Deliverability on the rows that print it, and in the Send view's one line
 * (plan before WT353, item 1). Offline no blocklist is asked and the check
 * on arrival is off, so the lookups are seeded; what is asserted is what the
 * server saved after each click.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, item, open, reset, store } from './helpers.ts';
import { rowName } from '../../src/shared/hints.ts';

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

test('the row says what a filter holds against it, and Keep stops saying it', async ({ page }) => {
  await open(page);
  const notes = page.locator('[data-anchor="link-flipcash"] .row-mail-note');
  await expect(notes.filter({ hasText: 'avc.xyz is on a spam blocklist' })).toBeVisible();
  const http = notes.filter({ hasText: /A plain http:\/\/ link — old\.example\.net/ });
  await expect(http).toBeVisible();
  await http.getByRole('button', { name: 'Keep as it is' }).click();
  await expect(http).toHaveCount(0);
  expect(store.getIssue(ISSUE)!.doc.deliverability!.kept).toEqual([`http:${PLAIN}`]);
  // Keeping a finding changes nothing in the issue itself.
  expect(item('link-flipcash').commentary).toContain(PLAIN);
  // A listed domain has no Keep: the email asks before it goes.
  await expect(notes.filter({ hasText: 'avc.xyz' }).getByRole('button')).toHaveCount(0);
});

test('the Send line names the row, and the email still asks before going with a listed domain', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  await open(page, '/send');
  const line = page.locator('.send-checks.send-warn');
  await expect(line.getByRole('button', { name: rowName(doc, 'link-flipcash') })).toBeVisible();
  await expect(line).toContainText('domain on a spam blocklist');
  await expect(line).toContainText('plain-http link');
  await expect(page.locator('.send-mail')).toHaveCount(0);
  await expect(page.locator('.send-card', { has: page.locator('.sc-title', { hasText: 'Buttondown' }) }).locator('.sc-head .btn').first())
    .toHaveText(/blocklisted domain…|without|anyway…/);
});
