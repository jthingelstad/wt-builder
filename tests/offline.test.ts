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
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

describe('offline never opens the live database', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const live = join(root, 'data', 'wt-builder.db');

  it('openDb refuses the default live path', async () => {
    const store = await import('../src/server/db.ts');
    expect(() => store.openDb(live)).toThrow(/WT_BUILDER_DB/);
  });

  it('the server refuses to start without its own WT_BUILDER_DB', () => {
    // Before the guard, this booted: migrations and finishStrandedWrites ran
    // against data/, and it listened until the timeout killed it.
    const env: NodeJS.ProcessEnv = { ...process.env, WT_BUILDER_OFFLINE: '1', WT_BUILDER_PORT: '0' };
    delete env.WT_BUILDER_DB;
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
      cwd: root, env, encoding: 'utf8', timeout: 15_000,
    });
    expect(run.signal).toBeNull();
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('WT_BUILDER_DB');
  }, 20_000);
});
