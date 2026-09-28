/**
 * The Send view's cards say what the server recorded for each leg: a failed
 * leg still names its last good send (review 2026-09-27 §2.1). The leg
 * states are seeded straight into the throwaway database; nothing here
 * sends anything.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

const card = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.send-card', { has: page.locator('.sc-title', { hasText: name }) });

test('a failed leg names its last good send', async ({ page }) => {
  store.recordSend(ISSUE, 'buttondown', {
    status: 'sent', at: '2026-09-26T14:05:00Z', external_id: 'em-350',
    url: 'https://buttondown.com/weekly-thing/archive/350/', edit_url: 'https://buttondown.com/emails/em-350',
  });
  store.recordSend(ISSUE, 'buttondown', { status: 'failed', at: '2026-09-27T15:00:00Z', error: 'Buttondown /emails/em-350 failed: 503' });

  await page.goto(`/${ISSUE}/send`);
  const mail = card(page, 'Buttondown');
  await expect(mail.locator('.sc-pill').first()).toHaveText('DID NOT SEND');
  const lastGood = mail.locator('.sc-last-good');
  await expect(lastGood).toContainText('Last good:');
  await expect(lastGood.getByRole('link')).toHaveAttribute('href', 'https://buttondown.com/emails/em-350');

  // A leg that never went has nothing to fall back to, and says nothing.
  store.recordSend(ISSUE, 'archive', { status: 'failed', at: '2026-09-27T15:00:00Z', error: 'GitHub failed: 502' });
  await page.reload();
  await expect(card(page, 'Archive').locator('.sc-pill').first()).toHaveText('DID NOT SEND');
  await expect(card(page, 'Archive').locator('.sc-last-good')).toHaveCount(0);
});
