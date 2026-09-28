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

test('the website card waits for an audio reference, not a podcast status', async ({ page }) => {
  const audio = { audio_url: 'https://files.thingelstad.com/weekly-thing/audio/wt350.mp3' };
  store.recordSend(ISSUE, 'podcast', { status: 'sent', at: '2026-09-26T13:00:00Z', url: audio.audio_url, audio });
  store.recordSend(ISSUE, 'podcast', { status: 'failed', at: '2026-09-27T13:00:00Z', error: 'chapter art did not load' });

  await page.goto(`/${ISSUE}/send`);
  await expect(card(page, 'Podcast').locator('.sc-pill').first()).toHaveText('DID NOT SEND');
  // The last episode is still on the CDN, and the server will embed it.
  await expect(card(page, 'Website').locator('.sc-blocker')).toHaveCount(0);

  reset();
  await page.reload();
  await expect(card(page, 'Website').locator('.sc-blocker')).toContainText('podcast runs first');
});

test('once the email has gone, Buttondown offers only a confirmed web-copy update, and Re-send all sent leaves it out', async ({ page }) => {
  const at = '2026-09-26T14:05:00Z';
  store.recordSend(ISSUE, 'website', { status: 'sent', at, external_id: 'f00d', url: 'https://github.com/x/y/commit/f00d' });
  store.recordSend(ISSUE, 'buttondown', { status: 'sent', at, external_id: 'em-350', edit_url: 'https://buttondown.com/emails/em-350' });
  store.recordSend(ISSUE, 'archive', { status: 'sent', at, external_id: 'abc1234', url: 'https://github.com/x/z/commit/abc1234' });
  // What the Buttondown check last read back: the email went out.
  store.recordVerify(ISSUE, 'buttondown', { status: 'passed', at, checks: [], remote_status: 'sent' });

  // No request reaches a real send handler: each is recorded and answered
  // with the issue as the server holds it.
  const posted: string[] = [];
  await page.route('**/api/issues/*/send/*', async (route) => {
    posted.push(new URL(route.request().url()).pathname.split('/').pop()! + new URL(route.request().url()).search);
    await route.fulfill({ json: { issue: store.getIssue(ISSUE)!.doc, send: { status: 'sent' } } });
  });

  await page.goto(`/${ISSUE}/send`);
  const mail = card(page, 'Buttondown');
  const button = mail.locator('.sc-head .btn.primary');
  await expect(button).toHaveText('Update web copy…');

  page.once('dialog', (d) => void d.dismiss());
  await button.click();
  await expect.poll(() => posted.length).toBe(0);

  page.once('dialog', (d) => void d.accept());
  await button.click();
  await expect.poll(() => posted).toEqual(['buttondown?web_copy=1']);

  posted.length = 0;
  await page.getByRole('button', { name: 'Re-send all sent' }).click();
  await expect.poll(() => posted).toEqual(['website', 'archive']);
});

test('a verify record older than remote_status: the refusal switches the card, and Re-send all sent carries on to the archive', async ({ page }) => {
  const at = '2026-09-26T14:05:00Z';
  store.recordSend(ISSUE, 'website', { status: 'sent', at, external_id: 'f00d', url: 'https://github.com/x/y/commit/f00d' });
  store.recordSend(ISSUE, 'buttondown', { status: 'sent', at, external_id: 'em-350', edit_url: 'https://buttondown.com/emails/em-350' });
  store.recordSend(ISSUE, 'archive', { status: 'sent', at, external_id: 'abc1234', url: 'https://github.com/x/z/commit/abc1234' });
  // WT350 and WT351: checked before the check read Buttondown's status back.
  store.recordVerify(ISSUE, 'buttondown', { status: 'passed', at, checks: [] });

  // The Buttondown leg answers as the server does once the email has gone:
  // it records what Buttondown said and refuses with a code.
  const posted: string[] = [];
  await page.route('**/api/issues/*/send/*', async (route) => {
    const leg = new URL(route.request().url()).pathname.split('/').pop()!;
    posted.push(leg);
    if (leg === 'buttondown') {
      store.recordVerify(ISSUE, 'buttondown', { status: 'passed', at, checks: [], remote_status: 'sent' });
      await route.fulfill({ status: 409, json: { error: "WT350's email has already gone to readers — nothing was changed.", code: 'email_sent' } });
      return;
    }
    await route.fulfill({ json: { issue: store.getIssue(ISSUE)!.doc, send: { status: 'sent' } } });
  });

  await page.goto(`/${ISSUE}/send`);
  const button = card(page, 'Buttondown').locator('.sc-head .btn.primary');
  await expect(button).toHaveText('Update draft');

  await page.getByRole('button', { name: 'Re-send all sent' }).click();
  await expect.poll(() => posted).toEqual(['website', 'buttondown', 'archive']);
  await expect(button).toHaveText('Update web copy…');
});
