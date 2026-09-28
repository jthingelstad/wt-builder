/**
 * Section headings typed on the canvas. An ad hoc heading was editable and
 * its commit was a no-op ("renamed from the outline", which has no rename),
 * so the edit looked saved and every edition published the old `## Section`
 * (review 2026-09-27, §1.5). The saved node or item is the assertion.
 */
import { expect, test, type Page } from '@playwright/test';
import { addSection } from '../../src/server/issue.ts';
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
