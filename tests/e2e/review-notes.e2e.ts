/**
 * A PROOF note anchored in a photo's caption or an echo's Ask question is
 * shown, not pruned. The notes panel used to test only title, body,
 * commentary and label, so these notes vanished before Jamie saw them and
 * the typo shipped (review 2026-09-27, §5). The review is seeded into the
 * store; nothing calls the model.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, open, reset, store } from './helpers.ts';

test.beforeEach(() => reset());

test('caption, place and Ask-question PROOF notes reach the margin', async ({ page }) => {
  const { doc } = store.getIssue(ISSUE)!;
  doc.review = {
    summary: 'Three mechanical errors.',
    at: new Date().toISOString(),
    passes: { proof: true, judgement: false },
    notes: [
      { kind: 'PROOF', item_id: 'photo-1', text: 'CAPTION-NOTE: "sun coming down" reads oddly.', was: 'sun coming down', now: 'sun going down' },
      { kind: 'PROOF', item_id: 'photo-1', text: 'PLACE-NOTE: check the town.', was: 'Warsaw, MN', now: 'Warsaw, Minnesota' },
      { kind: 'PROOF', item_id: 'echo-building', text: 'ASK-NOTE: "about" reads better as "on".', was: 'thinking about building', now: 'thinking on building' },
    ],
  };
  store.saveIssue(doc);

  await open(page);
  await expect(page.locator('.count-badge')).toHaveText('3');
  await page.getByRole('button', { name: /^Review/ }).click();
  for (const text of ['CAPTION-NOTE', 'PLACE-NOTE', 'ASK-NOTE']) {
    await expect(page.locator('.note-body', { hasText: text }).first()).toBeVisible();
  }
});
