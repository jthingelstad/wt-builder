/**
 * The Send view's cards say what the server recorded for each leg: a failed
 * leg still names its last good send (review 2026-09-27 §2.1). The leg
 * states are seeded straight into the throwaway database; nothing here
 * sends anything.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, open, reset, store } from './helpers.ts';
import { refusedNotDraft } from '../../src/shared/sends.ts';

test.beforeEach(() => reset());

const card = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.send-card', { has: page.locator('.sc-title', { hasText: name }) });

test('a failed leg names its last good send', async ({ page }) => {
  store.recordSend(ISSUE, 'buttondown', {
    status: 'sent', at: '2026-09-26T14:05:00Z', external_id: 'em-350',
    url: 'https://buttondown.com/weekly-thing/archive/350/', edit_url: 'https://buttondown.com/emails/em-350',
  });
  store.recordSend(ISSUE, 'buttondown', { status: 'failed', at: '2026-09-27T15:00:00Z', error: 'Buttondown /emails/em-350 failed: 503' });

  await open(page, '/send');
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

// A text leg has gone out once it has ever sent: a failed re-send of the
// draft still leaves the email Buttondown holds. The Archive and put to bed
// read that, not the latest status (cross-batch review: Batch 4 x Batch 7).
test('the Archive and put to bed follow the legs that have gone out, not their latest status', async ({ page }) => {
  const at = '2026-09-26T14:05:00Z';
  store.recordSend(ISSUE, 'buttondown', { status: 'sent', at, external_id: 'em-350', edit_url: 'https://buttondown.com/emails/em-350' });
  store.recordSend(ISSUE, 'buttondown', { status: 'failed', at: '2026-09-26T15:00:00Z', error: 'Buttondown /emails/em-350 failed: 503' });
  store.recordSend(ISSUE, 'website', { status: 'sent', at: '2026-09-26T15:05:00Z', external_id: 'f00d', url: 'https://github.com/x/y/commit/f00d' });

  await open(page, '/send');
  await expect(card(page, 'Buttondown').locator('.sc-pill').first()).toHaveText('DID NOT SEND');
  await expect(card(page, 'Archive').locator('.sc-blocker')).toHaveCount(0);
  const bed = page.locator('.send-card.bed');
  await expect(bed.getByRole('button', { name: 'Put to bed' })).toBeEnabled();
  await expect(bed.locator('.sc-blocker')).toContainText('Not sent: Podcast, Archive.');
  await expect(bed.locator('.sc-blocker')).not.toContainText('Not sent: Buttondown');
  // Counted as gone out, the failed re-send is still said: a warning beside
  // the others, never a gate.
  await expect(bed.locator('.sc-blocker')).toContainText('Last attempt failed: Buttondown.');
  await expect(bed.locator('.sc-blocker')).toContainText('It can still go to bed.');
});

test('the website card waits for an audio reference, not a podcast status', async ({ page }) => {
  const audio = { audio_url: 'https://files.thingelstad.com/weekly-thing/audio/wt350.mp3' };
  store.recordSend(ISSUE, 'podcast', { status: 'sent', at: '2026-09-26T13:00:00Z', url: audio.audio_url, audio });
  store.recordSend(ISSUE, 'podcast', { status: 'failed', at: '2026-09-27T13:00:00Z', error: 'chapter art did not load' });

  await open(page, '/send');
  await expect(card(page, 'Podcast').locator('.sc-pill').first()).toHaveText('DID NOT SEND');
  // The last episode is still on the CDN, and the server will embed it.
  await expect(card(page, 'Website').locator('.sc-blocker')).toHaveCount(0);

  reset();
  await page.reload();
  await expect(card(page, 'Website').locator('.sc-blocker')).toContainText('podcast runs first');
});

/** Records each send the view posts, leg and query, and answers as the server holds the issue. */
async function recordSends(page: import('@playwright/test').Page): Promise<string[]> {
  const posted: string[] = [];
  await page.route('**/api/issues/*/send/*', async (route) => {
    const url = new URL(route.request().url());
    posted.push(url.pathname.split('/').pop()! + url.search);
    await route.fulfill({ json: { issue: store.getIssue(ISSUE)!.doc, send: { status: 'sent' } } });
  });
  return posted;
}

// Jamie, 2026-09-29: nothing in their own tool they cannot override. Once
// the email is not a draft, the Buttondown card says what an update would
// do, and its action is "Update anyway…" — plain, not primary — which asks.
// The bulk runs still leave it out, and say so.
test('once the email is not a draft, the Buttondown card warns and offers "Update anyway…", and Re-send all sent leaves it out', async ({ page }) => {
  const at = '2026-09-26T14:05:00Z';
  store.recordSend(ISSUE, 'website', { status: 'sent', at, external_id: 'f00d', url: 'https://github.com/x/y/commit/f00d' });
  store.recordSend(ISSUE, 'buttondown', { status: 'sent', at, external_id: 'em-350', edit_url: 'https://buttondown.com/emails/em-350' });
  store.recordSend(ISSUE, 'archive', { status: 'sent', at, external_id: 'abc1234', url: 'https://github.com/x/z/commit/abc1234' });
  // What the Buttondown check last read back: the email went out.
  store.recordVerify(ISSUE, 'buttondown', { status: 'passed', at, checks: [], remote_status: 'sent' });

  // No request reaches a real send handler: each is recorded and answered
  // with the issue as the server holds it.
  const posted = await recordSends(page);

  await open(page, '/send');
  const mail = card(page, 'Buttondown');
  await expect(mail.locator('.sc-head .btn.primary')).toHaveCount(0);
  const update = mail.locator('.sc-head .btn');
  await expect(update).toHaveText('Update anyway…');
  await expect(mail.locator('.sc-locked')).toContainText('"sent", no longer a draft');
  await expect(mail.locator('.sc-locked')).toContainText('nothing is sent again');
  await expect(page.getByRole('button', { name: /web copy/i })).toHaveCount(0);

  // Every bulk run asks first, naming its legs (review 2026-09-27 §2.4):
  // one dialog, required, not only checked if it comes.
  const asked: string[] = [];
  page.once('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  await page.getByRole('button', { name: 'Re-send all sent' }).click();
  await expect.poll(() => posted).toEqual(['website', 'archive']);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('Website and Archive');
  expect(asked[0]).toContain('Buttondown is left out: the email is "sent"');

  // The override asks, with what an update would do; a no sends nothing.
  page.once('dialog', (d) => { asked.push(d.message()); void d.dismiss(); });
  await update.click();
  await expect.poll(() => asked).toHaveLength(2);
  expect(asked[1]).toContain('WT350\'s email is "sent", not a draft');
  expect(asked[1]).toContain('Update it anyway?');
  expect(posted).toEqual(['website', 'archive']);

  page.once('dialog', (d) => void d.accept());
  await update.click();
  await expect.poll(() => posted).toEqual(['website', 'archive', 'buttondown?force=1']);
});

test('a scheduled or going-out email warns for what it is, and a draft keeps "Update draft"', async ({ page }) => {
  const at = '2026-09-26T14:05:00Z';
  store.recordSend(ISSUE, 'buttondown', { status: 'sent', at, external_id: 'em-350', edit_url: 'https://buttondown.com/emails/em-350' });
  store.recordVerify(ISSUE, 'buttondown', { status: 'waiting', at, checks: [], remote_status: 'scheduled' });
  await open(page, '/send');
  const mail = card(page, 'Buttondown');
  await expect(mail.locator('.sc-locked')).toContainText('"scheduled", no longer a draft');
  await expect(mail.locator('.sc-locked')).toContainText('it stays scheduled');
  await expect(mail.locator('.sc-head .btn.primary')).toHaveCount(0);
  await expect(mail.locator('.sc-head .btn')).toHaveText('Update anyway…');

  store.recordVerify(ISSUE, 'buttondown', { status: 'waiting', at, checks: [], remote_status: 'in_flight' });
  await page.reload();
  await expect(mail.locator('.sc-locked')).toContainText('races the delivery');

  store.recordVerify(ISSUE, 'buttondown', { status: 'passed', at, checks: [], remote_status: 'draft' });
  await page.reload();
  await expect(mail.locator('.sc-locked')).toHaveCount(0);
  await expect(mail.locator('.sc-head .btn.primary')).toHaveText('Update draft');
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
      await route.fulfill({ status: 409, json: { error: 'WT350\'s email is no longer a draft on Buttondown (it is "sent"), so it can\'t be edited safely — nothing was changed.', code: 'not_draft' } });
      return;
    }
    await route.fulfill({ json: { issue: store.getIssue(ISSUE)!.doc, send: { status: 'sent' } } });
  });

  await open(page, '/send');
  const button = card(page, 'Buttondown').locator('.sc-head .btn.primary');
  await expect(button).toHaveText('Update draft');

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Re-send all sent' }).click();
  await expect.poll(() => posted).toEqual(['website', 'buttondown', 'archive']);
  await expect(button).toHaveCount(0);
  await expect(card(page, 'Buttondown').locator('.sc-locked')).toBeVisible();
  await expect(card(page, 'Buttondown').locator('.sc-head .btn')).toHaveText('Update anyway…');
});

test('an email refused as sent with no check behind it is not counted as verified', async ({ page }) => {
  const at = '2026-09-26T14:05:00Z';
  store.recordSend(ISSUE, 'podcast', { status: 'sent', at, url: 'https://files.thingelstad.com/a.mp3', audio: { audio_url: 'https://files.thingelstad.com/a.mp3' } });
  store.recordSend(ISSUE, 'website', { status: 'sent', at, external_id: 'f00d', url: 'https://github.com/x/y/commit/f00d' });
  store.recordSend(ISSUE, 'buttondown', { status: 'sent', at, external_id: 'em-350', edit_url: 'https://buttondown.com/emails/em-350' });
  store.recordSend(ISSUE, 'archive', { status: 'sent', at, external_id: 'abc1234', url: 'https://github.com/x/z/commit/abc1234' });
  for (const leg of ['podcast', 'website', 'archive'] as const) store.recordVerify(ISSUE, leg, { status: 'passed', at, checks: [] });
  // Exactly what the server records when it refuses a re-send and no check has run.
  store.recordVerify(ISSUE, 'buttondown', refusedNotDraft(at, 'sent'));

  await open(page, '/send');
  const mail = card(page, 'Buttondown');
  await expect(mail.locator('.sc-head .btn.primary')).toHaveCount(0);
  await expect(mail.locator('.sc-verify .sc-pill')).not.toHaveText('VERIFIED');
  await expect(page.getByText(/Not verified yet: Buttondown\./)).toBeVisible();
});

// Jamie, 2026-09-29: once an mp3 has gone out, re-sending the podcast asks
// for no second approval, even after a failed attempt.
test('a podcast that went out once is not gated again after a failed re-send', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  delete doc.script_review;
  store.saveIssue(doc);
  const audio = { audio_url: 'https://files.thingelstad.com/weekly-thing/audio/wt350.mp3' };
  store.recordSend(ISSUE, 'podcast', { status: 'sent', at: '2026-09-26T13:00:00Z', url: audio.audio_url, audio });
  store.recordSend(ISSUE, 'podcast', { status: 'failed', at: '2026-09-27T13:00:00Z', error: 'OpenAI TTS failed: 500' });

  await open(page, '/send');
  const podcast = card(page, 'Podcast');
  await expect(podcast.locator('.sc-pill').first()).toHaveText('DID NOT SEND');
  await expect(podcast.locator('.sc-head .btn.primary')).toHaveText('Try again');

  // Never sent: the gate still stands.
  reset();
  const fresh = store.getIssue(ISSUE)!.doc;
  delete fresh.script_review;
  store.saveIssue(fresh);
  store.recordSend(ISSUE, 'podcast', { status: 'failed', at: '2026-09-27T13:00:00Z', error: 'OpenAI TTS failed: 500' });
  await page.reload();
  await expect(podcast.locator('.sc-head .btn.primary')).toHaveCount(0);
  await expect(podcast.locator('.sc-head .btn')).toHaveText('Send without approval…');
});

// Jamie, 2026-09-29: the podcast's approval can be skipped on purpose. The
// card's action becomes the override, and it asks first.
test('an unapproved podcast offers "Send without approval…", which asks and then forces', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  delete doc.script_review;
  store.saveIssue(doc);
  const posted = await recordSends(page);

  await open(page, '/send');
  const podcast = card(page, 'Podcast');
  await expect(podcast.locator('.sc-pill').first()).toHaveText('NEEDS YOU');
  // Reading and approving stay in the step row, as before.
  await expect(podcast.getByRole('button', { name: 'Have it read' })).toBeVisible();
  const override = podcast.locator('.sc-head .btn');
  await expect(override).toHaveText('Send without approval…');
  await expect(override).not.toHaveClass(/\bprimary\b/);

  const asked: string[] = [];
  page.once('dialog', (d) => { asked.push(d.message()); void d.dismiss(); });
  await override.click();
  await expect.poll(() => asked).toHaveLength(1);
  expect(asked[0]).toContain('WT350\'s podcast script has not been read or approved');
  expect(posted).toEqual([]);

  page.once('dialog', (d) => void d.accept());
  await override.click();
  await expect.poll(() => posted).toEqual(['podcast?force=1']);
});

// The website's audio gate, the same way: "Commit without audio…" asks, and
// an issue with audio commits plainly, with no question.
test('a website with no audio offers "Commit without audio…", and one with audio commits without asking', async ({ page }) => {
  const posted = await recordSends(page);
  await open(page, '/send');
  const website = card(page, 'Website');
  await expect(website.locator('.sc-blocker')).toContainText('Committing without it asks first');
  const override = website.locator('.sc-head .btn');
  await expect(override).toHaveText('Commit without audio…');

  const asked: string[] = [];
  page.once('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  await override.click();
  await expect.poll(() => posted).toEqual(['website?force=1']);
  expect(asked[0]).toContain('WT350 has no podcast audio recorded');

  const audio = { audio_url: 'https://files.thingelstad.com/weekly-thing/audio/wt350.mp3' };
  store.recordSend(ISSUE, 'podcast', { status: 'sent', at: '2026-09-26T13:00:00Z', url: audio.audio_url, audio });
  await page.reload();
  await expect(website.locator('.sc-head .btn.primary')).toHaveText('Commit');
  await website.locator('.sc-head .btn.primary').click();
  await expect.poll(() => posted).toEqual(['website?force=1', 'website']);
  expect(asked).toHaveLength(1);
});

// The dead-link ask stays on the cards (plan before WT353, item 1): the
// findings moved to their rows, and the website and email still ask before
// going with a dead link, then force.
test('a dead link: the website offers "Commit with dead links…", which asks and then forces', async ({ page }) => {
  const DEAD = 'https://james-pritchard.com/blog/llms-are-functions';
  const doc = store.getIssue(ISSUE)!.doc;
  const at = '2026-10-04T12:00:00.000Z';
  doc.link_check = { at, results: { [DEAD]: { verdict: 'dead', status: 404, checked_at: at } } };
  store.saveIssue(doc);
  const audio = { audio_url: 'https://files.thingelstad.com/weekly-thing/audio/wt350.mp3' };
  store.recordSend(ISSUE, 'podcast', { status: 'sent', at: '2026-09-26T13:00:00Z', url: audio.audio_url, audio });
  const posted = await recordSends(page);

  await open(page, '/send');
  const override = card(page, 'Website').locator('.sc-head .btn').first();
  await expect(override).toHaveText('Commit with dead links…');
  const asked: string[] = [];
  page.once('dialog', (d) => { asked.push(d.message()); void d.dismiss(); });
  await override.click();
  await expect.poll(() => asked).toHaveLength(1);
  expect(asked[0]).toContain(`1 dead link: ${DEAD}`);
  expect(posted).toEqual([]);

  page.once('dialog', (d) => void d.accept());
  await override.click();
  await expect.poll(() => posted).toEqual(['website?force=1']);
});
