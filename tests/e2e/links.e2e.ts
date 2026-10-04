/**
 * The link check's findings on their rows and in the inspector, and the
 * Send view's one line (plan before WT353, item 1). Offline nothing is
 * fetched and the check on arrival is off, so the results are seeded; what
 * is asserted is what the server saved after each click.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, item, open, reset, store } from './helpers.ts';
import { rowName } from '../../src/shared/hints.ts';
import { issueLinks } from '../../src/shared/link-findings.ts';

const LINK = 'https://avc.xyz/create-your-own-currency-with-flipcash';
const SUGGESTED = 'https://avc.xyz/2026/05/flipcash';
const DEAD = 'https://james-pritchard.com/blog/llms-are-functions';
const AT = '2026-10-01T12:00:00.000Z';

test.beforeEach(() => {
  reset();
  const doc = store.getIssue(ISSUE)!.doc;
  doc.link_check = {
    at: AT,
    results: {
      [LINK]: { verdict: 'moved', status: 200, canonical_hint: SUGGESTED, suggestion: SUGGESTED, checked_at: AT },
      [DEAD]: { verdict: 'dead', status: 404, checked_at: AT },
    },
  };
  store.saveIssue(doc);
});

const inspect = async (page: import('@playwright/test').Page, anchor: string) => {
  const row = page.locator(`[data-anchor="${anchor}"]`);
  await row.hover();
  await row.getByRole('button', { name: 'Inspect' }).click();
  return page.locator('aside.panel');
};

test('a row says its dead link while editing, and nothing offers to check links', async ({ page }) => {
  await open(page);
  const note = page.locator('[data-anchor="link-functions"] .row-link-note');
  await expect(note).toContainText(`A dead link (404): ${DEAD}`);
  await expect(page.locator('[data-anchor="link-flipcash"] .row-link-note')).toContainText(`moved to ${SUGGESTED}`);
  await expect(page.getByRole('button', { name: /Check links|Check again/ })).toHaveCount(0);
  // The note opens the inspector, where it is fixed or kept.
  await note.click();
  await expect(page.locator('aside.panel').getByText('Dead (404)')).toBeVisible();
});

test('a site that would not answer gets no mark', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.link_check!.results[DEAD] = { verdict: 'unchecked', status: 403, checked_at: AT };
  store.saveIssue(doc);
  await open(page);
  await expect(page.locator('[data-anchor="link-functions"] .row-link-note')).toHaveCount(0);
  await expect(page.locator('[data-anchor="link-functions"] .row-flag')).toHaveCount(0);
});

test('use the suggested link prints it, and the bookmark keeps its own URL', async ({ page }) => {
  await open(page);
  const panel = await inspect(page, 'link-flipcash');
  await expect(panel.getByText('Moved — the page names another as its own')).toBeVisible();
  await panel.getByRole('button', { name: 'Use the suggested link' }).click();
  await expect(panel.getByRole('button', { name: "Back to the bookmark's link" })).toBeVisible();
  expect(item('link-flipcash').canonical_url).toBe(SUGGESTED);
  expect(item('link-flipcash').source_url).toBe(LINK);
  // The canvas prints the new link.
  await expect(page.locator(`[data-anchor="link-flipcash"] a[href="${SUGGESTED}"]`).first()).toBeVisible();
});

test('keep as it is stops asking about a dead link', async ({ page }) => {
  await open(page);
  const panel = await inspect(page, 'link-functions');
  await expect(panel.getByText('Dead (404)')).toBeVisible();
  await panel.getByRole('button', { name: 'Keep as it is' }).click();
  await expect(panel.getByText('Dead (404)')).toHaveCount(0);
  await expect(page.locator('[data-anchor="link-functions"] .row-link-note')).toHaveCount(0);
  expect(store.getIssue(ISSUE)!.doc.link_check!.accepted).toEqual([DEAD]);
});

test('the Send view: one amber line naming each row, and its jump goes back to the row', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  await open(page, '/send');
  const line = page.locator('.send-checks');
  await expect(line).toHaveCount(1);
  await expect(line).toHaveClass(/send-warn/);
  await expect(line).toContainText('dead link');
  await expect(page.getByRole('button', { name: /Check links|Check again/ })).toHaveCount(0);
  const jump = line.getByRole('button', { name: rowName(doc, 'link-functions') });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page).toHaveURL(new RegExp(`/${ISSUE}$`));
  await expect(page.locator('.send-layer')).toHaveCount(0);
  await expect(page.locator('[data-anchor="link-functions"]')).toHaveClass(/\barrived\b/);
  await expect(page.locator('[data-anchor="link-functions"]')).toBeInViewport();
});

test('the Send view: one green line when nothing is open', async ({ page }) => {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.link_check = { at: AT, results: Object.fromEntries(issueLinks(doc).map((l) => [l.url, { verdict: 'ok' as const, checked_at: AT }])) };
  store.saveIssue(doc);
  await open(page, '/send');
  const line = page.locator('.send-checks');
  await expect(line).toHaveCount(1);
  await expect(line).toHaveClass(/send-clear/);
  await expect(line).toHaveText('Links and email: nothing to act on.');
  await expect(page.locator('.send-warn.send-checks')).toHaveCount(0);
});

test('a gift link says when it ran out, and keep as it is stops asking (2026-10-04)', async ({ page }) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const GIFT = `https://www.theverge.com/a?view_token=${b64({ alg: 'HS256' })}.${b64({ exp: 1790701400 })}.c2ln`;
  const doc = store.getIssue(ISSUE)!.doc;
  doc.items['link-functions']!.source_url = GIFT;
  doc.link_check!.results[GIFT] = { verdict: 'ok', status: 200, checked_at: doc.link_check!.at };
  store.saveIssue(doc);
  await open(page);
  await expect(page.locator('[data-anchor="link-functions"] .row-link-note')).toContainText('expired Sep 29');
  const panel = await inspect(page, 'link-functions');
  await expect(panel.getByText('A gift link (view_token) that expired Sep 29: readers will hit the paywall.')).toBeVisible();
  await panel.getByRole('button', { name: 'Keep as it is' }).click();
  await expect(panel.getByText(/A gift link/)).toHaveCount(0);
  expect(store.getIssue(ISSUE)!.doc.link_check!.accepted).toEqual([GIFT]);
});
