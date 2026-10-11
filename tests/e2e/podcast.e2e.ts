/**
 * Another Thing in the browser: the index's link, a new episode, the outline
 * typed and saved (on a slow connection too), the card at the microphone and
 * its session writes in order, and the send refusing an episode with nothing
 * to send. Asserted by what the server saved.
 */
import { expect, test, type Page } from '@playwright/test';
import { store } from './helpers.ts';

const episodes = await import('../../src/server/podcast/store.ts');
const { cleanOutline } = await import('../../src/shared/podcast/outline.ts');

function clear(): void {
  for (const e of episodes.listEpisodes()) episodes.deleteEpisode(e.id);
}

function saved(id: string) {
  return episodes.getEpisode(id)!.doc;
}

async function settle(page: Page, check: () => boolean): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 50 && !check(); i++) await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
  clear();
  void store; // the issue's helpers set the throwaway database first
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
});

test('the index reaches the episodes, and a new episode opens on its outline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Another Thing →' }).click();
  await expect(page).toHaveURL(/\/another$/);
  await expect(page.locator('h1')).toHaveText('Episodes');

  // Episode 1 was published by hand, so the first one here is 2.
  await page.getByRole('button', { name: 'Start AT2' }).click();
  await expect(page).toHaveURL(/\/at2$/);
  await expect(page.locator('.identity .wt')).toHaveText('AT2');
  expect(saved('at2').episode.number).toBe(2);

  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Why a podcast at all');
  await settle(page, () => saved('at2').episode.title === 'Why a podcast at all');
  expect(saved('at2').episode.slug).toBe('why-a-podcast-at-all');
  await expect(page.locator('.pc-ident-title')).toHaveText('Why a podcast at all');

  await page.getByRole('button', { name: 'Segment' }).click();
  await expect(page.locator('.pc-seg')).toHaveCount(1);
  await page.locator('.pc-seg-title').fill('The question');
  await settle(page, () => saved('at2').segments[0]?.title === 'The question');

  await page.locator('.pc-blocks').fill('! the hook\n" Say this exactly.\n> on to the next\n? a cuttable aside');
  await settle(page, () => (saved('at2').segments[0]?.cards[0]?.blocks.length ?? 0) === 4);
  expect(saved('at2').segments[0]!.cards[0]!.blocks.map((b) => b.t)).toEqual(['trigger', 'verbatim', 'bridge', 'cuttable']);
  await expect(page.locator('.pc-blk-verbatim')).toHaveText('Say this exactly.');

  // Back to the list: the row and its strip.
  await page.getByRole('button', { name: 'Episodes' }).click();
  await expect(page.locator('.issue-row', { hasText: 'AT2' })).toContainText('Why a podcast at all');
});

test('a stale outline is refused, not saved over the newer one', async ({ page, request }) => {
  const created = await (await request.post('/api/episodes', { data: { title: 'Stale' } })).json();
  const id = created.episode.episode.id as string;
  await page.goto(`/${id}`);
  await expect(page.locator('.identity .wt')).toHaveText(id.toUpperCase());

  // Another tab adds a segment meanwhile.
  const other = await request.put(`/api/episodes/${id}/outline`, {
    data: { segments: [{ title: 'From the other tab', cards: [] }], base: created.outline_version },
  });
  expect(other.status()).toBe(200);

  // This tab, still on the old version, adds one too: refused, then re-read.
  await page.getByRole('button', { name: 'Segment' }).click();
  await expect(page.locator('.error-bar')).toBeVisible();
  await expect(page.locator('.pc-seg-title')).toHaveValue('From the other tab');
  expect(saved(id).segments.map((s) => s.title)).toEqual(['From the other tab']);
});

test('outline edits made faster than the server answers all land, in order', async ({ page, request }) => {
  const created = await (await request.post('/api/episodes', { data: { title: 'Quick' } })).json();
  const id = created.episode.episode.id as string;
  const segments = cleanOutline([{ title: 'Open', cards: [{ claim: 'First', blocks: [] }] }]);
  expect((await request.put(`/api/episodes/${id}/outline`, { data: { segments, base: created.outline_version } })).status()).toBe(200);
  // A slow connection: each outline save takes most of a second to answer.
  await page.route('**/api/episodes/*/outline', async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });

  await page.goto(`/${id}`);
  await page.locator('.pc-seg-title').fill('Opening');
  await page.locator('.pc-claim').fill('The first thing');
  await page.locator('.pc-blocks').fill('! hook');
  await settle(page, () => saved(id).segments[0]?.cards[0]?.blocks.length === 1);
  const seg = saved(id).segments[0]!;
  expect([seg.title, seg.cards[0]!.claim]).toEqual(['Opening', 'The first thing']);
  await expect(page.locator('.error-bar')).toHaveCount(0);
});

test('a slow start never lands over the take that finished after it', async ({ page, request }) => {
  const created = await (await request.post('/api/episodes', { data: { title: 'Slow' } })).json();
  const id = created.episode.episode.id as string;
  const segments = cleanOutline([
    { title: 'Open', minutes: 1, cards: [{ claim: 'First beat', blocks: [] }] },
    { title: 'Close', minutes: 1, cards: [{ claim: 'Last beat', blocks: [] }] },
  ]);
  expect((await request.put(`/api/episodes/${id}/outline`, { data: { segments, base: created.outline_version } })).status()).toBe(200);
  let first = true;
  await page.route('**/api/episodes/*/session', async (route) => {
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 800));
    }
    await route.continue();
  });

  await page.goto(`/${id}/record`);
  await expect(page.locator('.stage-claim')).toHaveText('First beat');
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.stage-claim')).toHaveText('Last beat');
  await page.keyboard.press('f');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/${id}$`));
  for (let i = 0; i < 50 && saved(id).session?.ended === undefined; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(1000); // long enough for a stray start to have landed, were it unordered
  const session = saved(id).session!;
  expect(session.ended).toBeDefined();
  expect(session.splits.map((s) => s.segmentId)).toEqual(segments.map((s) => s.id));
});

test('the card steps through the beats and leaves a session behind', async ({ page, request }) => {
  const created = await (await request.post('/api/episodes', { data: { title: 'Card' } })).json();
  const id = created.episode.episode.id as string;
  const segments = cleanOutline([
    { title: 'Open', minutes: 1, cards: [{ claim: 'First beat', blocks: [{ t: 'trigger', text: 'hook' }] }, { claim: 'Second beat', blocks: [] }] },
    { title: 'Close', minutes: 1, cards: [{ claim: 'Last beat', blocks: [] }] },
  ]);
  expect((await request.put(`/api/episodes/${id}/outline`, { data: { segments, base: created.outline_version } })).status()).toBe(200);

  await page.goto(`/${id}`);
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page).toHaveURL(new RegExp(`/${id}/record$`));
  await expect(page.locator('.stage-claim')).toHaveText('First beat');
  await expect(page.locator('.card-pos')).toHaveText('1 / 3');

  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.stage-claim')).toHaveText('Second beat');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.stage-claim')).toHaveText('Last beat');

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/${id}$`));
  for (let i = 0; i < 50 && saved(id).session?.ended === undefined; i++) await page.waitForTimeout(100);
  const session = saved(id).session!;
  expect(session.splits.map((s) => s.segmentId)).toEqual(segments.map((s) => s.id));
});

test('an episode with nothing to send is refused before anything is claimed', async ({ request }) => {
  const created = await (await request.post('/api/episodes', { data: { title: 'Unsent' } })).json();
  const id = created.episode.episode.id as string;
  const send = await request.post(`/api/episodes/${id}/send`);
  expect(send.status()).toBe(422);
  expect(saved(id).sends?.another?.status ?? 'none').not.toBe('sending');
});
