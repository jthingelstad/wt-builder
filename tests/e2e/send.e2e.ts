/**
 * The Send view cannot surprise (review 2026-09-27 §2.4). Every request to a
 * send leg is intercepted with page.route, so nothing here reaches a real
 * handler: each test decides what the leg answers, and what the server
 * recorded is seeded straight into the throwaway database.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { ISSUE, open, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

const AT = '2026-09-26T14:05:00Z';
const AUDIO = { audio_url: 'https://files.thingelstad.com/weekly-thing/audio/wt350.mp3' };

const card = (page: Page, name: string) =>
  page.locator('.send-card', { has: page.locator('.sc-title', { hasText: name }) });

/** The podcast has gone, so a bulk run has the text legs left to send. */
function podcastSent(): void {
  store.recordSend(ISSUE, 'podcast', { status: 'sent', at: AT, url: AUDIO.audio_url, audio: AUDIO });
}

/**
 * Intercept every send leg. `answer` decides each one; by default a leg
 * answers as sent, with the issue as the server holds it.
 */
async function interceptSends(
  page: Page,
  answer?: (leg: string, route: Route) => Promise<void>,
): Promise<string[]> {
  const posted: string[] = [];
  await page.route('**/api/issues/*/send/*', async (route) => {
    const leg = new URL(route.request().url()).pathname.split('/').pop()!;
    posted.push(leg);
    if (answer) return answer(leg, route);
    await route.fulfill({ json: { issue: store.getIssue(ISSUE)!.doc, send: { status: 'sent' } } });
  });
  return posted;
}

test('a double-click on Publish asks before it sends anything', async ({ page }) => {
  podcastSent();
  const posted = await interceptSends(page);
  const asked: string[] = [];
  page.on('dialog', (d) => { asked.push(d.message()); void d.dismiss(); });

  await open(page);
  const publish = page.locator('.app .header').getByRole('button', { name: 'Publish' });
  const box = (await publish.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Two clicks a double-click apart: the second lands on whatever the Send
  // view has put under the pointer.
  await page.mouse.click(x, y);
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);

  await expect(page.locator('.send-layer')).toBeVisible();
  await page.waitForTimeout(400);
  expect(posted).toEqual([]);
  // It landed on the bulk button, which asked, naming what it would send.
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('Website, Buttondown and Archive');
});

test('"← Issue" stops a bulk run after the leg that is out', async ({ page }) => {
  podcastSent();
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const posted = await interceptSends(page, async (leg, route) => {
    if (leg === 'website') await held;
    await route.fulfill({ json: { issue: store.getIssue(ISSUE)!.doc, send: { status: 'sent' } } });
  });
  page.on('dialog', (d) => void d.accept());

  await page.goto(`/${ISSUE}/send`);
  await page.getByRole('button', { name: 'Send the rest' }).click();
  await expect.poll(() => posted).toEqual(['website']);

  await page.locator('.send-layer .header').getByRole('button', { name: 'Issue' }).click();
  await expect(page.locator('.send-layer')).toHaveCount(0);
  release();
  await page.waitForTimeout(500);
  expect(posted).toEqual(['website']);
});

test('a re-send that fails shows DID NOT SEND, not the last SENT and its VERIFIED', async ({ page }) => {
  podcastSent();
  store.recordSend(ISSUE, 'website', { status: 'sent', at: AT, external_id: 'f00d', url: 'https://github.com/x/y/commit/f00d' });
  store.recordVerify(ISSUE, 'website', { status: 'passed', at: AT, checks: [] });
  // The leg fails the way the server records it: the state, then the refusal.
  await interceptSends(page, async (_leg, route) => {
    store.recordSend(ISSUE, 'website', { status: 'failed', at: new Date().toISOString(), error: 'GitHub failed: 502' });
    await route.fulfill({ status: 502, json: { error: 'GitHub failed: 502' } });
  });

  await page.goto(`/${ISSUE}/send`);
  const site = card(page, 'Website');
  await expect(site.locator('.sc-pill').first()).toHaveText('SENT');
  await site.locator('.sc-head .btn.primary').click();

  await expect(site.locator('.sc-pill').first()).toHaveText('DID NOT SEND');
  await expect(site.locator('.sc-verify')).toHaveCount(0);
  await expect(site.locator('.sc-evidence.error')).toHaveText('GitHub failed: 502');
  await expect(site.locator('.sc-last-good')).toContainText('f00d');
});

test('a leg the server has out reads as sending, cannot be pressed, and lands on its own', async ({ page }) => {
  podcastSent();
  // Sent from another tab, or before this one reloaded: only the server knows.
  store.recordSend(ISSUE, 'website', { status: 'sending', at: new Date().toISOString() });
  const posted = await interceptSends(page);

  await page.goto(`/${ISSUE}/send`);
  const site = card(page, 'Website');
  await expect(site.locator('.sc-pill').first()).toHaveText('SENDING');
  await expect(site.locator('.sc-head .btn.primary')).toHaveText('Sending…');
  await expect(site.locator('.sc-head .btn.primary')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send the rest' })).toBeDisabled();

  store.recordSend(ISSUE, 'website', { status: 'sent', at: new Date().toISOString(), external_id: 'f00d', url: 'https://github.com/x/y/commit/f00d' });
  await expect(site.locator('.sc-pill').first()).toHaveText('SENT', { timeout: 10_000 });
  await expect(site.locator('.sc-head .btn.primary')).toBeEnabled();
  expect(posted).toEqual([]);
});

test('the Send view reads the issue again when it opens', async ({ page }) => {
  await interceptSends(page);
  const swept = page.waitForResponse((r) => r.url().endsWith(`/api/issues/${ISSUE}/sweep`));
  await open(page);
  await swept;

  // A leg lands while the editor is open (another tab, a send still out).
  podcastSent();
  await page.locator('.app .header').getByRole('button', { name: 'Publish' }).click();
  await expect(card(page, 'Podcast').locator('.sc-pill').first()).toHaveText('SENT');
});

test('a late answer for the issue left behind neither replaces the one on screen nor re-scans it', async ({ page }) => {
  // A second issue to go to: WT349, published, so it opens without a scan.
  const other = store.getIssue(ISSUE)!.doc;
  other.issue = { ...other.issue, id: 'fixture-wt349', number: 349, publication_date: '2026-05-16', status: 'published' };
  store.saveIssue(other);
  try {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let sweeps = 0;
    await page.route(`**/api/issues/${ISSUE}/sweep`, async (route) => {
      sweeps += 1;
      if (sweeps === 1) await held; else await page.waitForTimeout(200);
      const res = await page.request.get(`/api/issues/${ISSUE}`);
      await route.fulfill({ json: await res.json() });
    });

    await open(page);
    await expect.poll(() => sweeps).toBe(1);
    // The browser's Forward, say: straight to the other issue.
    await page.evaluate(() => {
      history.pushState({}, '', '/fixture-wt349');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    const wt = page.locator('.app .header .wt');
    await expect(wt).toHaveText('WT349');

    release();
    await page.waitForTimeout(1500);
    await expect(wt).toHaveText('WT349');
    expect(sweeps).toBe(1);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    store.deleteIssue('fixture-wt349');
  }
});

test('a trip to Send and back keeps the editor as it was, and does not scan again', async ({ page }) => {
  await interceptSends(page);
  let sweeps = 0;
  page.on('request', (r) => { if (r.url().endsWith(`/api/issues/${ISSUE}/sweep`)) sweeps += 1; });
  const swept = page.waitForResponse((r) => r.url().endsWith(`/api/issues/${ISSUE}/sweep`));
  await open(page);
  await swept;

  const header = page.locator('.app .header');
  const row = page.locator('[data-anchor="link-functions"]');
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.locator('aside.panel')).toBeVisible();
  await header.getByRole('button', { name: 'Audio' }).click();

  await header.getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('.send-layer')).toBeVisible();
  // Keys pressed in the Send view are not the editor's: Escape would close
  // its inspector underneath, ⌘/ open its shortcut card.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+/');
  await page.locator('.send-layer .header').getByRole('button', { name: 'Issue' }).click();

  await expect(page.locator('.send-layer')).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Audio' })).toHaveClass(/\bon\b/);
  await expect(page.locator('aside.panel')).toBeVisible();
  await expect(page.locator('.hint-card')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(sweeps).toBe(1);
});
