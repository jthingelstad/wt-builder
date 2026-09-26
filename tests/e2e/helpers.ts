import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// The test process shares the server's throwaway database (WAL mode; the
// server reads fresh on every request), so each test can start from the
// representative issue again.
process.env.WT_BUILDER_OFFLINE = '1';
process.env.WT_BUILDER_DB = `${process.cwd()}/tmp/e2e/e2e.db`;
const store = await import('../../src/server/db.ts');

export const ISSUE = 'fixture-wt350';

export function reset(): void {
  const doc = JSON.parse(readFileSync(new URL('../../fixtures/representative-issue.json', import.meta.url), 'utf8'));
  store.saveIssue(doc);
}

/** What the server holds now — the test's ground truth, not the DOM. */
export function item(id: string): Record<string, unknown> {
  return store.getIssue(ISSUE)!.doc.items[id] as unknown as Record<string, unknown>;
}

export async function open(page: Page): Promise<void> {
  await page.goto(`/${ISSUE}`);
  await page.locator('[data-anchor]').first().waitFor();
}

/** Put the caret at the end of an editable, the way a click past the text does. */
export async function caretAtEnd(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click();
  await page.locator(selector).evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
}

/** Blur commits; wait for the save to land on the server. */
export async function commit(page: Page, check: () => boolean): Promise<void> {
  await page.locator('h1').first().click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 50 && !check(); i++) await page.waitForTimeout(100);
}
