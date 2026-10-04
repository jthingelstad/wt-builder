/**
 * A Journal post's video on the canvas (WT352's Beastbox post, the first):
 * a player on the Website lens and the poster linked to the post on the Email
 * lens, never the raw tag as text, and editing the words keeps the tag.
 */
import { expect, test } from '@playwright/test';
import { ISSUE, caretAtEnd, commit, item, open, reset, store } from './helpers.ts';

const VIDEO = '<video controls="controls" playsinline="playsinline" preload="none" width="1920" height="1080" poster="https://cdn.uploads.micro.blog/890/2026/frames/1.jpg" src="https://cdn.uploads.micro.mov/890/2026/abc/playlist.m3u8"></video>';
const POST = 'https://www.thingelstad.com/2026/10/01/beastbox.html';

test.beforeEach(() => {
  reset();
  const doc = store.getIssue(ISSUE)!.doc;
  doc.items['journal-boat']!.body = `Beastbox was an amazing demo.\n\n${VIDEO}`;
  doc.items['journal-boat']!.source_url = POST;
  store.saveIssue(doc);
});

test('the Website lens shows a player, the Email lens the poster linked to the post', async ({ page }) => {
  await open(page);
  const row = page.locator('[data-anchor="journal-boat"]');
  await expect(row.locator('video.post-video')).toHaveAttribute('src', 'https://cdn.uploads.micro.mov/890/2026/abc/playlist.m3u8');
  await expect(row).not.toContainText('<video');

  await page.locator('.segment .seg', { hasText: 'Email' }).click();
  await expect(row.locator('video')).toHaveCount(0);
  await expect(row.locator('.post-video-email img')).toHaveAttribute('src', 'https://cdn.uploads.micro.blog/890/2026/frames/1.jpg');
  await expect(row.locator('.post-video-email a', { hasText: 'Watch the video' })).toHaveAttribute('href', POST);
});

test('editing the words keeps the video tag, byte for byte', async ({ page }) => {
  await open(page);
  await caretAtEnd(page, '[data-anchor="journal-boat"] [contenteditable]');
  await page.keyboard.type(' Wow.');
  await commit(page, () => String(item('journal-boat').body).includes('Wow.'));
  expect(item('journal-boat').body).toBe(`Beastbox was an amazing demo. Wow.\n\n${VIDEO}`);
});
