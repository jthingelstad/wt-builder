/**
 * Pinboard write-back, with fetch stubbed: exactly what posts/add is sent.
 *
 * posts/add replaces the whole bookmark, and anything not sent resets to
 * Pinboard's default — public and read. That has already published a
 * private bookmark once (AGENTS.md, Things that will bite), and until
 * these tests nothing pinned the parameters (review 2026-09-27, Batch 2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Item } from '../src/shared/types.ts';
import { config, credentials } from '../src/server/config.ts';
import { writeBack } from '../src/server/integrations/pinboard.ts';

const URL_A = 'https://example.com/private-unread';

/** A private, unread bookmark as the last scan left it. */
const link = (over: Partial<Item> = {}): Item => ({
  type: 'pinboard_link', authorship: 'syndicated', source: 'Pinboard',
  channels: { website: true, email: true, audio: true },
  source_url: URL_A, title: 'A private link', commentary: 'Edited here.', tags: ['tools', '_brief'],
  source_snapshot: { title: 'A private link', commentary: 'As scanned.', tags: ['tools', '_brief'] },
  source_flags: { toread: 'yes', shared: 'no' },
  sync_state: 'syncing',
  ...over,
});

/** What Pinboard holds now; `get` null means deleted, a number means that HTTP status. */
let bookmark: Record<string, string> | null | number;
let calls: { path: string; params: URLSearchParams }[];

beforeEach(() => {
  credentials.pinboardToken = 'test-token';
  config.pinboardWriteBack = true;
  calls = [];
  bookmark = {
    href: URL_A, description: 'A private link', extended: 'As scanned.', tags: 'tools _brief',
    time: '2026-09-01T14:00:00Z', toread: 'yes', shared: 'no',
  };
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname !== 'api.pinboard.in') throw new Error(`unexpected fetch ${url}`);
    const path = url.pathname.replace(/^\/v1/, '');
    calls.push({ path, params: url.searchParams });
    if (path === '/posts/get') {
      if (typeof bookmark === 'number') return new Response('down', { status: bookmark });
      return Response.json({ posts: bookmark ? [bookmark] : [] });
    }
    if (path === '/posts/add') return Response.json({ result_code: 'done' });
    throw new Error(`unexpected Pinboard call ${path}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  credentials.pinboardToken = undefined;
  config.pinboardWriteBack = false;
});

const adds = () => calls.filter((c) => c.path === '/posts/add');

describe('a failed compare-and-set read writes nothing', () => {
  it('Pinboard unreachable for the read: failed, the edit kept, and no posts/add', async () => {
    bookmark = 503;
    const result = await writeBack(link());
    expect(result.sync_state).toBe('failed');
    expect(result.error).toContain('could not read the bookmark first');
    expect(result.error).toContain('your edit is kept');
    expect(adds()).toHaveLength(0);
  });
});
