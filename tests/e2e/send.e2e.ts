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
