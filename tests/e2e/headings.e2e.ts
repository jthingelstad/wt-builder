/**
 * Section headings typed on the canvas. An ad hoc heading was editable and
 * its commit was a no-op ("renamed from the outline", which has no rename),
 * so the edit looked saved and every edition published the old `## Section`
 * (review 2026-09-27, §1.5). The saved node or item is the assertion.
 */
import { expect, test, type Page } from '@playwright/test';
import { addSection } from '../../src/server/issue.ts';
import { renderWebsite } from '../../src/shared/render/website.ts';
import { ISSUE, caretAtEnd, commit, open, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

const heading = (anchor: string) => `[data-anchor="${anchor}"] h2 [contenteditable]`;

async function retype(page: Page, sel: string, text: string) {
  await caretAtEnd(page, sel);
  const old = (await page.locator(sel).textContent()) ?? '';
  for (let i = 0; i < old.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

test('an ad hoc heading typed on the canvas is saved as the section label', async ({ page }) => {
  store.saveIssue(addSection(store.getIssue(ISSUE)!.doc, {
    type: 'ad_hoc', label: 'Section', id: 'reading', before: 'briefly',
  }));
  const label = () => store.getIssue(ISSUE)!.doc.nodes.find((n) => n.id === 'reading')?.label;
  await open(page);

  await retype(page, heading('reading'), 'Reading list');
  await commit(page, () => label() === 'Reading list');
  expect(label()).toBe('Reading list');
  await expect(page.locator(heading('reading'))).toHaveText('Reading list');
});

// A promoted post's heading is its title: that is what the renderers print,
// and what writes back to Micro.blog. The node's label is only where the
// title stood when it was promoted.
test("a promoted post's heading shows and saves the post's title", async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.items['journal-long']!.title = 'Minnesota Technology Council, revisited';
  store.saveIssue(doc);
  const title = () => store.getIssue(ISSUE)!.doc.items['journal-long']!.title;
  await open(page);

  await expect(page.locator(heading('promoted-post'))).toHaveText('Minnesota Technology Council, revisited');
  await retype(page, heading('promoted-post'), 'The Tech Council');
  await commit(page, () => title() === 'The Tech Council');
  expect(title()).toBe('The Tech Council');
});

// An emptied heading published as "## ". For a promoted post the empty title
// was saved, and the Micro.blog write left the name out, so the post read
// synced while Micro.blog kept the old title (Batch 5 review, B2). Emptied,
// a heading goes back to what is saved, and nothing is sent.
test('an emptied heading goes back to its saved text and saves nothing', async ({ page }) => {
  store.saveIssue(addSection(store.getIssue(ISSUE)!.doc, {
    type: 'ad_hoc', label: 'Section', id: 'reading', before: 'briefly',
  }));
  await open(page);
  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`); });

  for (const anchor of ['reading', 'promoted-post']) {
    const before = (await page.locator(heading(anchor)).textContent()) ?? '';
    await retype(page, heading(anchor), '   ');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.locator(heading(anchor))).toHaveText(before);
  }
  await page.waitForTimeout(500);
  expect(sent.filter((r) => /rename|journal-long/.test(r))).toEqual([]);
  const doc = store.getIssue(ISSUE)!.doc;
  expect(doc.nodes.find((n) => n.id === 'reading')?.label).toBe('Section');
  expect(doc.items['journal-long']!.title).toBe('Minnesota Technology Council');
});

// The same heading, cleared from the Inspector's Title field, was saved as ''
// and the website edition printed a bare "## " (Batch 5 review round 2, B2).
// The field goes back to the saved title, as the canvas heading does, and
// nothing is sent.
test("a promoted post's Title cleared in the Inspector goes back and saves nothing", async ({ page }) => {
  await open(page);
  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`); });

  const row = page.locator('[data-anchor="journal-long"]');
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();
  const field = page.locator('aside.panel').getByLabel('Title');
  await expect(field).toHaveValue('Minnesota Technology Council');
  await field.fill('  ');
  await field.blur();

  await expect(field).toHaveValue('Minnesota Technology Council');
  await page.waitForTimeout(500);
  expect(sent.filter((r) => /journal-long/.test(r))).toEqual([]);
  expect(store.getIssue(ISSUE)!.doc.items['journal-long']!.title).toBe('Minnesota Technology Council');
  expect(renderWebsite(store.getIssue(ISSUE)!.doc)).toContain('## Minnesota Technology Council');
});
