/**
 * The unit suite cannot reach a live service, by construction.
 *
 * `tests/routes.test.ts` imports the whole server, and the server's config
 * loads the real `.env` — write-back on, every key present — unless
 * `WT_BUILDER_OFFLINE` is set. On otto that is every `npm run deploy`. Until
 * this was pinned, each route test failed before reaching the network only
 * because it was written with care (review 2026-09-27, §1.7).
 */

import { describe, expect, it } from 'vitest';

describe('the unit suite runs offline', () => {
  it('sets WT_BUILDER_OFFLINE for every test file', () => {
    expect(process.env.WT_BUILDER_OFFLINE).toBe('1');
  });

  it('never loads a credential, even one already in the environment', async () => {
    const { OFFLINE, credentials, config } = await import('../src/server/config.ts');
    expect(OFFLINE).toBe(true);
    expect(Object.entries(credentials).filter(([, v]) => v)).toEqual([]);
    expect(process.env.PINBOARD_API_TOKEN ?? '').toBe('');
    expect(config.pinboardWriteBack).toBe(false);
    expect(config.microblogWriteBack).toBe(false);
  });
});
