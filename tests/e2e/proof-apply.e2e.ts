/**
 * Review → Apply (2026-10-04): a PROOF note's fix made with one click in the
 * review panel, the note gone by itself, Undo putting the words back, and
 * Apply all reporting what it could not apply. The review is seeded into the
 * store; nothing calls the model. Asserted by what the server saved.
 */
import { expect, test, type Page } from '@playwright/test';
import { ISSUE, item, open, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

const INTRO = { kind: 'PROOF', item_id: 'intro-1', text: 'INTRO-NOTE: it was the summer break.', was: 'Welcome back from summer break', now: 'Welcome back from the summer break' };
const OUTRO = { kind: 'PROOF', item_id: 'outro-1', text: 'OUTRO-NOTE: outdoors reads better.', was: 'head outside.', now: 'head outdoors.' };
const BUILDING = { kind: 'PROOF', item_id: 'currently-building', text: 'BUILDING-NOTE: making, not creating.', was: 'for creating The', now: 'for making The' };

function seed(notes: unknown[]): void {
  const { doc } = store.getIssue(ISSUE)!;
  doc.review = { summary: 'Mechanical errors.', at: new Date().toISOString(), passes: { proof: true, judgement: false }, notes };
  store.saveIssue(doc);
}

/** Open the issue, let the opening scan land, and open the review panel. */
async function openReview(page: Page): Promise<void> {
  const swept = page.waitForResponse((r) => r.url().endsWith('/sweep'));
  await open(page);
  await swept;
  await page.getByRole('button', { name: /^Review/ }).click();
  await expect(page.locator('.review-panel')).toBeVisible();
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
}

test('Apply in the review panel makes the fix, the note goes, and Undo puts it back', async ({ page }) => {
  seed([INTRO, OUTRO]);
  await openReview(page);
  const panel = page.locator('.review-panel');
  await expect(panel.locator('.rp-body', { hasText: 'INTRO-NOTE' })).toBeVisible();

  const apply = panel.getByRole('button', { name: /^Apply: Welcome back from summer break/ });
  await expect(apply).toContainText('add "the"');
  await apply.click();

  await until(() => String(item('intro-1').body).includes('the summer break'));
  expect(item('intro-1').body).toBe('Welcome back from the summer break. This issue is being assembled item by item in WT Builder.');
  await expect(panel.locator('.rp-body', { hasText: 'INTRO-NOTE' })).toHaveCount(0);
  await expect(panel.locator('.rp-body', { hasText: 'OUTRO-NOTE' })).toBeVisible();
  expect(store.allEvents(ISSUE).some((e) => e.kind === 'edit' && e.summary.startsWith('Applied proof fix') && e.anchor === 'intro-1')).toBe(true);

  const toast = page.locator('.proof-toast');
  await expect(toast).toContainText('Applied add "the"');
  await toast.getByRole('button', { name: 'Undo' }).click();

  await until(() => !String(item('intro-1').body).includes('the summer break'));
  expect(item('intro-1').body).toBe('Welcome back from summer break. This issue is being assembled item by item in WT Builder.');
  await expect(panel.locator('.rp-body', { hasText: 'INTRO-NOTE' })).toBeVisible();
  await expect(toast).toHaveCount(0);
});

test('Apply in the margin makes the same fix', async ({ page }) => {
  seed([OUTRO]);
  await openReview(page);
  await page.locator('.note').getByRole('button', { name: /^Apply: head outside/ }).click();
  await until(() => String(item('outro-1').body).includes('outdoors'));
  expect(item('outro-1').body).toBe('Time to head outdoors. I hope you have a wonderful weekend.');
  await expect(page.locator('.note-body', { hasText: 'OUTRO-NOTE' })).toHaveCount(0);
  // Gone because its words are, not because this tab remembers the click.
  await page.reload();
  await page.locator('[data-anchor]').first().waitFor();
  await expect(page.locator('.count-badge')).toHaveCount(0);
});

test('a note whose words occur twice offers only Show me', async ({ page }) => {
  seed([{ kind: 'PROOF', item_id: 'outro-1', text: 'TWICE-NOTE: which one?', was: 'e', now: 'E' }]);
  await openReview(page);
  const note = page.locator('.review-panel .rp-note', { hasText: 'TWICE-NOTE' });
  await expect(note.getByRole('button', { name: 'Show me' })).toBeVisible();
  await expect(note.getByRole('button', { name: /^Apply/ })).toHaveCount(0);
});

test('Apply all applies each fix and says which it could not', async ({ page }) => {
  seed([INTRO, OUTRO, BUILDING]);
  await openReview(page);
  // The outro changes behind the page's back, so its fix no longer applies.
  const { doc } = store.getIssue(ISSUE)!;
  doc.items['outro-1']!.body = 'Time to go outside. I hope you have a wonderful weekend.';
  store.saveIssue(doc);

  await page.locator('.review-panel').getByRole('button', { name: 'Apply all' }).click();
  const toast = page.locator('.proof-toast');
  await expect(toast).toContainText('Applied 2 fixes. 1 could not be applied');
  await expect(toast).toContainText('"head outside." is no longer there');

  expect(item('intro-1').body).toContain('Welcome back from the summer break');
  expect(item('currently-building').body).toBe('A focused tool for making The Weekly Thing.');
  expect(item('outro-1').body).toBe('Time to go outside. I hope you have a wonderful weekend.');
  // The refused note is gone too once the page has the issue as it is.
  await expect(page.locator('.review-panel .rp-body', { hasText: 'OUTRO-NOTE' })).toHaveCount(0);
  await expect(page.locator('.review-panel .rp-body')).toHaveCount(0);
});
