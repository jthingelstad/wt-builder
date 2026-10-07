/**
 * The Share view (docs/share-plan.md): once an issue is put to bed, Publish
 * becomes Share, and a share is worked like a task. Asserted by what the
 * server saved. Offline, so a blog post cannot reach micro.blog: it fails,
 * and stays a draft, which is the refusal path this pins.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, open, reset, store } from './helpers.ts';

const shares = () => store.listShares(ISSUE);

function sleeping(): void {
  const doc = store.getIssue(ISSUE)!.doc;
  doc.issue.status = 'published';
  doc.issue.put_to_bed_at = '2026-05-23T20:00:00.000Z';
  store.saveIssue(doc);
}

test.beforeEach(() => {
  reset();
  for (const s of shares()) store.deleteShare(s.id);
});

test('a draft issue offers Publish, not Share', async ({ page }) => {
  await open(page);
  await expect(page.locator('header').getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(page.locator('header').getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
});

test('put to bed, Share opens the view; a LinkedIn share is written, folds, and is marked shared', async ({ page }) => {
  sleeping();
  await open(page);
  await page.locator('header').getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${ISSUE}/share$`));
  await expect(page.locator('.tell-layer h1')).toHaveText('Share');

  await page.getByRole('button', { name: 'LinkedIn' }).click();
  const card = page.locator('.tell-card.dest-li');
  const field = card.locator('textarea');
  await expect(field).toHaveValue(/archive\/350\/\?ref=linkedin$/);
  const link = await field.inputValue();

  const text = `The lead, in Jamie's words.\nA second line.\nA third line.\nBelow the fold.\n\n${link}`;
  await field.fill(text);
  await field.blur();
  await expect.poll(() => shares()[0]?.text).toBe(text);

  await expect(card.locator('.sh-fold')).toContainText('A third line.');
  await expect(card.locator('.sh-fold')).not.toContainText('Below the fold');
  await expect(card.locator('.sh-count')).toHaveText(`${text.length} / 3,000`);

  // Taking the link out says so.
  await field.fill("The lead, in Jamie's words.");
  await expect(card.locator('.sc-evidence.warn')).toContainText('does not link WT350');
  await field.fill(text);

  page.once('dialog', (d) => void d.accept('https://www.linkedin.com/feed/update/urn:li:activity:1/'));
  await card.getByRole('button', { name: 'Mark shared' }).click();
  await expect(card.locator('.sc-pill')).toHaveText('SHARED');
  await expect(card.locator('textarea')).toHaveCount(0);
  await expect(card.locator('.sh-text-shown')).toHaveText(text);
  expect(shares()[0]).toMatchObject({ state: 'shared', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', text });

  // The issue itself is still asleep: the editor's words are not writable.
  expect((await page.request.patch(`/api/issues/${ISSUE}/items/link-functions`, { data: { commentary: 'x' } })).status()).toBe(423);
});

test('a blog post that cannot reach micro.blog stays a draft, and a draft is deleted', async ({ page }) => {
  sleeping();
  await open(page);
  await page.goto(`/${ISSUE}/share`);
  await page.getByRole('button', { name: 'Blog post' }).click();
  const card = page.locator('.tell-card.dest-blog');
  // Titled as the email was, to start.
  await expect(card.locator('input.sh-title')).toHaveValue(/^WT350/);
  await card.locator('input.sh-title').fill('A title');
  await card.locator('textarea').fill(`What it had.\n\n[Weekly Thing 350](${await card.locator('textarea').inputValue()})`);
  await card.locator('textarea').blur();
  await expect.poll(() => shares()[0]?.title).toBe('A title');

  page.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Post to the blog' }).click();
  await expect(card.locator('.sc-evidence.error')).toContainText('MICROBLOG_API_KEY');
  expect(shares()[0]?.state).toBe('draft');

  page.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.tell-card')).toHaveCount(0);
  expect(shares()).toEqual([]);
});

test('Sends crosses to the Send view, and Escape goes back to the issue', async ({ page }) => {
  sleeping();
  await open(page);
  await page.goto(`/${ISSUE}/share`);
  await page.locator('.tell-layer header').getByRole('button', { name: 'Sends' }).click();
  await expect(page).toHaveURL(new RegExp(`/${ISSUE}/send$`));
  await page.goto(`/${ISSUE}/share`);
  await expect(page.locator('.tell-layer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/${ISSUE}$`));
});

test('a put-to-bed row on the index has Share, and it opens the Share view', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wt-builder:index-filters', JSON.stringify({ hideAsleep: false })));
  await page.goto('/');
  const row = page.locator('.issue-row', { hasText: 'WT350' });
  await expect(row.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  sleeping();
  await page.reload();
  await row.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${ISSUE}/share$`));
  await expect(page.locator('.tell-new')).toBeVisible();
});
