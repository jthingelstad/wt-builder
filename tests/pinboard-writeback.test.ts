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

describe('what posts/add is sent', () => {
  it('a private, unread bookmark stays private and unread: every parameter, exactly', async () => {
    const result = await writeBack(link());
    expect(result).toEqual({ sync_state: 'synced', flags: { toread: 'yes', shared: 'no' } });
    expect(adds()).toHaveLength(1);
    expect(Object.fromEntries(adds()[0]!.params)).toEqual({
      auth_token: 'test-token',
      format: 'json',
      url: URL_A,
      description: 'A private link',
      extended: 'Edited here.',
      tags: 'tools _brief',
      toread: 'yes',
      shared: 'no',
      replace: 'yes',
    });
  });

  it('reads the bookmark before it writes it', async () => {
    await writeBack(link());
    expect(calls.map((c) => c.path)).toEqual(['/posts/get', '/posts/add']);
    expect(calls[0]!.params.get('url')).toBe(URL_A);
  });

  it("the bookmark's flags as they are now win over the scan's", async () => {
    // Since the scan, Jamie marked it read and made it public at Pinboard.
    bookmark = { ...(bookmark as Record<string, string>), toread: 'no', shared: 'yes' };
    const result = await writeBack(link({ source_flags: { toread: 'yes', shared: 'no' } }));
    expect(adds()[0]!.params.get('toread')).toBe('no');
    expect(adds()[0]!.params.get('shared')).toBe('yes');
    expect(result.flags).toEqual({ toread: 'no', shared: 'yes' });
  });

  it('flags missing everywhere default to private and unread, never to Pinboard’s public and read', async () => {
    const { toread: _t, shared: _s, ...bare } = bookmark as Record<string, string>;
    bookmark = bare;
    await writeBack(link({ source_flags: undefined }));
    expect(adds()[0]!.params.get('toread')).toBe('yes');
    expect(adds()[0]!.params.get('shared')).toBe('no');
  });
});

describe('when it does not write', () => {
  it('conflict: the bookmark moved since the scan, and nothing is sent', async () => {
    bookmark = { ...(bookmark as Record<string, string>), extended: 'Rewritten at Pinboard.' };
    const result = await writeBack(link());
    expect(result.sync_state).toBe('conflict');
    expect(result.error).toContain('nothing was written');
    expect(adds()).toHaveLength(0);
  });

  it('a tag changed at Pinboard is a conflict too', async () => {
    bookmark = { ...(bookmark as Record<string, string>), tags: 'tools' };
    expect((await writeBack(link())).sync_state).toBe('conflict');
    expect(adds()).toHaveLength(0);
  });

  it('gone: the bookmark was deleted, and is not recreated', async () => {
    bookmark = null;
    const result = await writeBack(link());
    expect(result.sync_state).toBe('gone');
    expect(result.error).toContain('not recreating');
    expect(adds()).toHaveLength(0);
  });

  it('write-back switched off: local, and Pinboard is not called at all', async () => {
    config.pinboardWriteBack = false;
    const result = await writeBack(link());
    expect(result.sync_state).toBe('local');
    expect(calls).toHaveLength(0);
  });
});

describe('when the write fails, the edit is kept', () => {
  it('Pinboard refuses the add: failed, with its result code', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname.replace(/^\/v1/, ''), params: url.searchParams });
      if (url.pathname.endsWith('/posts/get')) return Response.json({ posts: [bookmark] });
      return Response.json({ result_code: 'item already exists' });
    });
    const item = link();
    const result = await writeBack(item);
    expect(result).toEqual({ sync_state: 'failed', error: 'item already exists' });
    expect(item.commentary).toBe('Edited here.');
  });

  it('Pinboard errors on the add: failed, with the status', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/posts/get')) return Response.json({ posts: [bookmark] });
      return new Response('rate limited', { status: 429, statusText: 'Too Many Requests' });
    });
    const item = link();
    const result = await writeBack(item);
    expect(result.sync_state).toBe('failed');
    expect(result.error).toContain('429');
    expect(item.commentary).toBe('Edited here.');
  });
});
