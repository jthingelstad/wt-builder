/**
 * What Jamie types stays on screen until the server has it, whatever the
 * save is doing meanwhile (review 2026-09-27, §1.4). A save is held with
 * page.route so the window a slow write-back opens — 0.5 to 3 s against
 * Pinboard or Micro.blog — can be looked at, and a failure is a real
 * aborted request, the way a restart under `npm run deploy` looks.
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { ISSUE, caretAtEnd, commit, item, open, reset, store } from './helpers.ts';

const commentary = (id: string) => `[data-anchor="${id}"] .post-body`;

test.beforeEach(() => reset());

/** Hold the next request that matches until `release` is called with what to do. */
async function hold(page: Page, url: string, method: string) {
  let release!: (how: 'continue' | 'abort') => void;
  const decided = new Promise<'continue' | 'abort'>((r) => { release = r; });
  let arrived!: () => void;
  const seen = new Promise<void>((r) => { arrived = r; });
  await page.route(url, async (route: Route) => {
    if (route.request().method() !== method) return route.fallback();
    arrived();
    const how = await decided;
    if (how === 'abort') await route.abort('connectionreset');
    else await route.continue();
  });
  return { seen, release };
}

test('typed text stays on screen while its save is pending, and after it fails', async ({ page }) => {
  await open(page);
  const sel = commentary('link-flipcash');
  const before = String(item('link-flipcash').commentary);
  const save = await hold(page, `**/api/issues/${ISSUE}/items/link-flipcash`, 'PATCH');

  await caretAtEnd(page, sel);
  await page.keyboard.type(' Typed while it saves.');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await save.seen;

  // Pending: the old text came back here, and a click in edited it.
  await expect(page.locator(sel)).toContainText('Typed while it saves.');
  await caretAtEnd(page, sel);
  await expect(page.locator(sel)).toHaveText(`${before} Typed while it saves.`);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  save.release('abort');
  await expect(page.locator('.error-bar')).toBeVisible();
  // Failed: still on screen, marked, and nothing reached the server.
  await expect(page.locator(sel)).toContainText('Typed while it saves.');
  await expect(page.locator(sel)).toHaveAttribute('data-unsaved', '');
  expect(item('link-flipcash').commentary).toBe(before);

  // The next blur tries again.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await caretAtEnd(page, sel);
  await commit(page, () => String(item('link-flipcash').commentary).includes('Typed while'));
  expect(item('link-flipcash').commentary).toBe(`${before} Typed while it saves.`);
  await expect(page.locator(sel)).not.toHaveAttribute('data-unsaved', '');
  // The failure's own message goes with it.
  await expect(page.locator('.error-bar')).toHaveCount(0);
});

async function inspect(page: Page, id: string) {
  const row = page.locator(`[data-anchor="${id}"]`);
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();
  return page.locator('aside.panel');
}

test('a save landing while an inspector field is being typed in leaves the typing alone', async ({ page }) => {
  await open(page);
  const titleSave = await hold(page, `**/api/issues/${ISSUE}/items/link-functions`, 'PATCH');
  const panel = await inspect(page, 'link-functions');
  const title = panel.locator('#item-link-functions-title');
  const notes = panel.locator('#item-link-functions-commentary');

  await title.fill('LLMs are functions, not brains. (edited)');
  await notes.click();
  await titleSave.seen;
  await page.keyboard.type('Typed while the title saved.');

  // The title's answer lands and the inspector re-renders mid-typing.
  titleSave.release('continue');
  for (let i = 0; i < 50 && !String(item('link-functions').title).endsWith('(edited)'); i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  await expect(notes).toHaveValue('Typed while the title saved.');

  await panel.locator('h3').first().click();
  for (let i = 0; i < 50 && !item('link-functions').commentary; i++) await page.waitForTimeout(100);
  expect(item('link-functions').commentary).toBe('Typed while the title saved.');
  expect(item('link-functions').title).toBe('LLMs are functions, not brains. (edited)');

  // Not focused, a field still follows what is saved: another item's inspector
  // shows that item.
  await inspect(page, 'link-flipcash');
  await expect(panel.locator('#item-link-flipcash-commentary')).toHaveValue(String(item('link-flipcash').commentary));
  await expect(panel.locator('#item-link-flipcash-title')).toHaveValue(String(item('link-flipcash').title));
});

test('a re-scan landing while an inspector field is being typed in leaves the typing alone', async ({ page }) => {
  const sweep = await hold(page, `**/api/issues/${ISSUE}/sweep`, 'POST');
  await open(page);
  await sweep.seen;
  const panel = await inspect(page, 'link-functions');
  const notes = panel.locator('#item-link-functions-commentary');
  await notes.click();
  await page.keyboard.type('Typed while it scanned.');

  sweep.release('continue');
  await page.waitForResponse(`**/api/issues/${ISSUE}/sweep`);
  await page.waitForTimeout(300);
  await expect(notes).toHaveValue('Typed while it scanned.');

  await panel.locator('h3').first().click();
  for (let i = 0; i < 50 && !item('link-functions').commentary; i++) await page.waitForTimeout(100);
  expect(item('link-functions').commentary).toBe('Typed while it scanned.');
});

// Escape closes the rail, and Safari fires no blur on a field taken out from
// under the caret: the edit went with the panel.
test('Escape in an inspector field saves it, then closes the panel', async ({ page }) => {
  await open(page);
  const panel = await inspect(page, 'link-functions');
  const title = panel.locator('#item-link-functions-title');
  await title.click();
  await title.fill('Functions, not brains');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  for (let i = 0; i < 50 && item('link-functions').title !== 'Functions, not brains'; i++) await page.waitForTimeout(100);
  expect(item('link-functions').title).toBe('Functions, not brains');
});

// A click in and out is not an edit. The read-back trims and collapses
// whitespace, so it differed from a stored hard break ("  \n") and the blur
// wrote the stripped text back to the source.
test('clicking into a block and out again saves nothing', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  const stored = 'First line  \nSecond line, after a hard break\n';
  doc.items['link-flipcash']!.commentary = stored;
  store.saveIssue(doc);
  await open(page);
  const patches: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PATCH') patches.push(r.url()); });

  const sel = commentary('link-flipcash');
  await caretAtEnd(page, sel);
  await expect(page.locator(sel)).toHaveAttribute('data-source', '');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);
  expect(item('link-flipcash').commentary).toBe(stored);
});

// The inspector saved outside run(), so its failure was not one a later
// success could clear: the bar kept saying the save failed after it had
// gone through (Batch 5 review, N6).
test('an inspector save that goes through clears the error its own failure put up', async ({ page }) => {
  await open(page);
  await page.route(`**/api/issues/${ISSUE}/items/currently-building`, (route) =>
    route.request().method() === 'PATCH' ? route.abort('connectionreset') : route.fallback());
  const panel = await inspect(page, 'currently-building');
  const label = panel.locator('#item-currently-building-label');
  await label.fill('Making');
  await panel.locator('h3').first().click();
  await expect(page.locator('.error-bar')).toBeVisible();
  expect(item('currently-building').label).toBe('Building');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await label.click();
  await label.fill('Making it');
  await panel.locator('h3').first().click();
  for (let i = 0; i < 50 && item('currently-building').label !== 'Making it'; i++) await page.waitForTimeout(100);
  expect(item('currently-building').label).toBe('Making it');
  await expect(page.locator('.error-bar')).toHaveCount(0);
});

// The inspector is one instance reused from item to item, and a field
// followed a change of value only. Two items with the same saved text (both
// commentaries empty) meant no change, so the first item's typing stayed in
// the field and a click in and out saved it onto the second (Batch 5
// review, B1).
test("an inspector field never carries one item's typing to the next", async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.items['link-flipcash']!.commentary = '';
  store.saveIssue(doc);
  await open(page);

  let panel = await inspect(page, 'link-functions');
  await panel.locator('#item-link-functions-commentary').click();
  await page.keyboard.type('Bleed text');
  panel = await inspect(page, 'link-flipcash');
  for (let i = 0; i < 50 && item('link-functions').commentary !== 'Bleed text'; i++) await page.waitForTimeout(100);

  const notes = panel.locator('#item-link-flipcash-commentary');
  await expect(notes).toHaveValue('');
  await notes.click();
  await panel.locator('h3').first().click();
  await page.waitForTimeout(500);
  expect(item('link-flipcash').commentary).toBe('');
  expect(item('link-functions').commentary).toBe('Bleed text');
});

// A value the server changes while the field has focus — a date snapped to
// its Saturday — shows once the field lets go.
test('a date the server snaps shows as snapped once the field loses focus', async ({ page }) => {
  await open(page);
  await page.locator('.left-panel .panel-head').getByRole('button', { name: 'Edit' }).click();
  const date = page.locator('.left-panel input[type="date"]');
  await date.fill('2026-10-07');
  for (let i = 0; i < 50 && store.getIssue(ISSUE)!.doc.issue.publication_date !== '2026-10-10'; i++) await page.waitForTimeout(100);
  expect(store.getIssue(ISSUE)!.doc.issue.publication_date).toBe('2026-10-10');
  await page.locator('.left-panel .mono-label').first().click();
  await expect(date).not.toBeFocused();
  await expect(date).toHaveValue('2026-10-10');
});
