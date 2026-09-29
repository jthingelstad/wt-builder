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
    else await route.fallback(); // to any handler registered before this one, then the network
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
  // Held, so the next item's field is looked at before the first save
  // answers: the blur resync that follows the answer would otherwise
  // correct the field, and the test passed without the Inspector's key
  // (Batch 5 review round 2).
  const save = await hold(page, `**/api/issues/${ISSUE}/items/link-functions`, 'PATCH');

  let panel = await inspect(page, 'link-functions');
  await panel.locator('#item-link-functions-commentary').click();
  await page.keyboard.type('Bleed text');
  panel = await inspect(page, 'link-flipcash');
  await save.seen;

  const notes = panel.locator('#item-link-flipcash-commentary');
  await expect(notes).toHaveValue('');
  await page.waitForTimeout(300);
  await expect(notes).toHaveValue('');
  save.release('continue');
  for (let i = 0; i < 50 && item('link-functions').commentary !== 'Bleed text'; i++) await page.waitForTimeout(100);
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

// The date saves on change and had no commit on blur, so the blur resynced
// at once: with its save out the field showed the old date, and after a
// failed save the typed date was gone (Batch 5 review round 2). It waits on
// its save, as every other field does.
test('a typed date stays in the field while its save is out, and after it fails', async ({ page }) => {
  await open(page);
  const saved = store.getIssue(ISSUE)!.doc.issue.publication_date;
  await page.locator('.left-panel .panel-head').getByRole('button', { name: 'Edit' }).click();
  const date = page.locator('.left-panel input[type="date"]');
  const save = await hold(page, `**/api/issues/${ISSUE}/settings`, 'POST');
  await date.fill('2026-10-07');
  await save.seen;
  await page.locator('.left-panel .mono-label').first().click();
  await expect(date).not.toBeFocused();
  await page.waitForTimeout(300);
  await expect(date).toHaveValue('2026-10-07');

  save.release('abort');
  await expect(page.locator('.error-bar')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(date).toHaveValue('2026-10-07');
  expect(store.getIssue(ISSUE)!.doc.issue.publication_date).toBe(saved);
});

/** Select [start, end) of an editable's single text node — its source after the swap. */
async function selectIn(page: Page, sel: string, start: number, end: number) {
  await page.locator(sel).evaluate((el, [a, b]) => {
    const node = el.firstChild!;
    const r = document.createRange();
    r.setStart(node, a!);
    r.setEnd(node, b!);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  }, [start, end]);
}

// The read-back stripped every space before a newline: a real edit took the
// hard breaks out of the whole field, and one that only added or removed a
// hard break was not saved at all (Batch 5 review, N3).
test.describe('a Markdown hard break', () => {
  const put = (commentary: string) => {
    const doc = store.getIssue(ISSUE)!.doc;
    doc.items['link-flipcash']!.commentary = commentary;
    store.saveIssue(doc);
  };
  const saved = () => String(item('link-flipcash').commentary);
  const sel = commentary('link-flipcash');

  test('survives a real edit elsewhere in the field', async ({ page }) => {
    put('First line  \nSecond line');
    await open(page);
    await caretAtEnd(page, sel);
    await page.keyboard.type(' More.');
    await commit(page, () => saved().endsWith('More.'));
    expect(saved()).toBe('First line  \nSecond line More.');
  });

  test('added on its own is saved', async ({ page }) => {
    put('Line one\nLine two');
    await open(page);
    await caretAtEnd(page, sel);
    await selectIn(page, sel, 8, 8);
    await page.keyboard.type('  ');
    await commit(page, () => saved() !== 'Line one\nLine two');
    expect(saved()).toBe('Line one  \nLine two');
  });

  test('removed on its own is saved', async ({ page }) => {
    put('Line one  \nLine two');
    await open(page);
    await caretAtEnd(page, sel);
    await selectIn(page, sel, 8, 10);
    await page.keyboard.press('Backspace');
    await commit(page, () => saved() !== 'Line one  \nLine two');
    expect(saved()).toBe('Line one\nLine two');
  });
});

// The re-scan used to wait, invisibly, for any focused input to blur —
// a checkbox, a file input, a field WebKit removed without a blur, and then
// never (Batch 5 review, N4). Applied as it landed, it moved rows out from
// under the caret (round 2). It waits only for a field that takes typing,
// says so, and is applied when the field lets go.
async function sweepRetitling(page: Page) {
  await page.route(`**/api/issues/${ISSUE}/sweep`, async (route) => {
    const res = await route.fetch();
    // What the scan found, on the server as well as in its answer.
    const doc = store.getIssue(ISSUE)!.doc;
    doc.items['link-flipcash']!.title = 'Swept in while typing';
    store.saveIssue(doc);
    const body = await res.json();
    body.issue.items['link-flipcash'].title = 'Swept in while typing';
    await route.fulfill({ response: res, json: body });
  });
  return hold(page, `**/api/issues/${ISSUE}/sweep`, 'POST');
}

test('a re-scan that lands while a field is typed in waits for it, visibly, then is applied', async ({ page }) => {
  const sweep = await sweepRetitling(page);
  await open(page);
  await sweep.seen;
  const panel = await inspect(page, 'link-functions');
  const notes = panel.locator('#item-link-functions-commentary');
  await notes.click();
  await page.keyboard.type('Still typing');

  sweep.release('continue');
  await expect(page.getByRole('button', { name: 'Re-scan waiting…' })).toBeVisible();
  await expect(notes).toBeFocused();
  await expect(notes).toHaveValue('Still typing');
  const flipcash = page.locator('[data-anchor="link-flipcash"]').first();
  await expect(flipcash).not.toContainText('Swept in while typing');

  await notes.blur();
  await expect.poll(() => item('link-functions').commentary).toBe('Still typing');
  await expect(flipcash).toContainText('Swept in while typing');
  await expect(page.getByRole('button', { name: 'Re-scan', exact: true })).toBeEnabled();
  await expect(notes).toHaveValue('Still typing');
});

test('a re-scan that lands while a button has focus is applied at once', async ({ page }) => {
  const sweep = await sweepRetitling(page);
  await open(page);
  await sweep.seen;
  const panel = await inspect(page, 'link-functions');
  await panel.getByRole('button').first().focus();

  sweep.release('continue');
  await expect(page.locator('[data-anchor="link-flipcash"]').first()).toContainText('Swept in while typing');
  await expect(page.getByRole('button', { name: 'Re-scan waiting…' })).toHaveCount(0);
});

test('a re-scan that lands while a block is being typed in leaves the typing alone', async ({ page }) => {
  const sweep = await hold(page, `**/api/issues/${ISSUE}/sweep`, 'POST');
  await open(page);
  await sweep.seen;
  const sel = commentary('link-flipcash');
  const before = String(item('link-flipcash').commentary);
  await caretAtEnd(page, sel);
  await page.keyboard.type(' Typed while it scanned.');
  sweep.release('continue');
  await page.waitForResponse(`**/api/issues/${ISSUE}/sweep`);
  await page.waitForTimeout(300);
  await page.keyboard.type(' And after.');
  await commit(page, () => String(item('link-flipcash').commentary).endsWith('And after.'));
  expect(item('link-flipcash').commentary).toBe(`${before} Typed while it scanned. And after.`);
});

// A re-scan applied as it landed moved the row being typed in when it
// reordered the section (a Pinboard retag, a Journal re-sort): WebKit fired
// no blur, and the typing sat unsaved, unmarked and dead; Chromium blurred,
// and the rest of the typing was lost (Batch 5 review round 2). The scan
// now waits, visibly, for the field to let go.
test('a re-scan that moves the row being typed in waits, and the typing is saved whole', async ({ page }) => {
  const order = () => store.getIssue(ISSUE)!.doc.nodes.find((n) => n.id === 'notable')!.items;
  const reversed = [...order()].reverse();
  await page.route(`**/api/issues/${ISSUE}/sweep`, async (route) => {
    const res = await route.fetch();
    // What the scan found: Notable in the other order, on the server too.
    const doc = store.getIssue(ISSUE)!.doc;
    doc.nodes.find((n) => n.id === 'notable')!.items.reverse();
    store.saveIssue(doc);
    const body = await res.json();
    body.issue.nodes.find((n: { id: string }) => n.id === 'notable').items.reverse();
    await route.fulfill({ response: res, json: body });
  });
  const sweep = await hold(page, `**/api/issues/${ISSUE}/sweep`, 'POST');
  await open(page);
  await sweep.seen;
  const sel = commentary('link-flipcash');
  const before = String(item('link-flipcash').commentary);
  await caretAtEnd(page, sel);
  await page.keyboard.type(' Typed before the scan.');

  sweep.release('continue');
  await page.waitForResponse(`**/api/issues/${ISSUE}/sweep`);
  await expect(page.getByRole('button', { name: 'Re-scan waiting…' })).toBeVisible();
  await expect(page.locator(sel)).toBeFocused();
  await page.keyboard.type(' And after it.');
  await commit(page, () => String(item('link-flipcash').commentary).endsWith('And after it.'));
  expect(item('link-flipcash').commentary).toBe(`${before} Typed before the scan. And after it.`);
  expect(order()).toEqual(reversed);

  // Let go, the scan is applied: the rows are in the new order.
  await expect(page.getByRole('button', { name: 'Re-scan', exact: true })).toBeVisible();
  const shown = () => page.locator(reversed.map((id) => `.row[data-anchor="${id}"]`).join(', '))
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-anchor')));
  await expect.poll(shown).toEqual(reversed);
  await expect(page.locator(sel)).toContainText('And after it.');
});
