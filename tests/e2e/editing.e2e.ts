/**
 * Typing into the page and reading what the server saved. Each case is a bug
 * Jamie hit while building an issue; the saved Markdown is the assertion.
 */
import { expect, test } from '@playwright/test';
import { caretAtEnd, commit, item, open, reset } from './helpers.ts';

const commentary = (id: string) => `[data-anchor="${id}"] .post-body`;

test.beforeEach(() => reset());

test('a numbered list typed with Enter keeps every line (WT351)', async ({ page }) => {
  await open(page);
  const sel = commentary('link-functions');
  await caretAtEnd(page, sel);
  await page.keyboard.type('Where to focus:');
  for (const line of ['1. Deep knowledge', '2. Wide knowledge', '3. Taste']) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await commit(page, () => String(item('link-functions').commentary ?? '').includes('Taste'));
  expect(item('link-functions').commentary).toBe('Where to focus:\n1. Deep knowledge\n2. Wide knowledge\n3. Taste');
});

test('a quoted list keeps its lines and shows as a list (WT351)', async ({ page }) => {
  await open(page);
  const sel = commentary('link-functions');
  await caretAtEnd(page, sel);
  await page.keyboard.type('His loop:');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  for (const [i, line] of ['> 1. Understand', '> 2. Gather', '> 3. Act'].entries()) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('After.');
  await commit(page, () => String(item('link-functions').commentary ?? '').includes('After.'));
  expect(item('link-functions').commentary).toBe('His loop:\n\n> 1. Understand\n> 2. Gather\n> 3. Act\n\nAfter.');
  await expect(page.locator(`${sel} blockquote ol li`)).toHaveCount(3);
});

test('an existing paragraph break survives an edit in the middle', async ({ page }) => {
  await open(page);
  const sel = commentary('link-flipcash');
  const before = String(item('link-flipcash').commentary);
  await caretAtEnd(page, sel);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A second paragraph.');
  await commit(page, () => String(item('link-flipcash').commentary).includes('second paragraph'));
  expect(item('link-flipcash').commentary).toBe(`${before}\n\nA second paragraph.`);
});

test('Enter at the very end leaves no stray blank lines', async ({ page }) => {
  await open(page);
  const sel = commentary('link-functions');
  await caretAtEnd(page, sel);
  await page.keyboard.type('One line.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await commit(page, () => String(item('link-functions').commentary ?? '').includes('One line.'));
  expect(item('link-functions').commentary).toBe('One line.');
});
