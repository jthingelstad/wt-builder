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
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // Neither test may reach this checkout's data/, even with the guard broken:
  // on otto, npm run deploy runs npm test in the live checkout, and a boot
  // there would migrate the live database and could finish a stranded write
  // offline, turning a 'syncing' item 'local'.

  it('the check refuses the live path and nothing else', async () => {
    // Pure: it only compares paths. openDb is never called on the live path.
    const { refuseLiveDbOffline } = await import('../src/server/db.ts');
    const { LIVE_DB_PATH } = await import('../src/server/config.ts');
    expect(() => refuseLiveDbOffline(LIVE_DB_PATH)).toThrow(/WT_BUILDER_DB/);
    expect(() => refuseLiveDbOffline(join(tmpdir(), 'wt-throwaway.db'))).not.toThrow();
  });

  it('a server with no WT_BUILDER_DB of its own refuses to start', () => {
    // Booted from a throwaway copy of the server, so its "live" database is
    // the copy's data/. Before the guard, this booted: migrations and
    // finishStrandedWrites ran, and it listened until the timeout killed it.
    const root = fileURLToPath(new URL('..', import.meta.url));
    const copy = mkdtempSync(join(tmpdir(), 'wt-offline-boot-'));
    try {
      for (const p of ['src', 'prompts', 'assets', 'package.json', 'tsconfig.json']) {
        cpSync(join(root, p), join(copy, p), { recursive: true });
      }
      symlinkSync(join(root, 'node_modules'), join(copy, 'node_modules'));
      const env: NodeJS.ProcessEnv = { ...process.env, WT_BUILDER_OFFLINE: '1', WT_BUILDER_PORT: '0' };
      delete env.WT_BUILDER_DB;
      delete env.WT_BUILDER_TTS_CACHE;
      const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
        cwd: copy, env, encoding: 'utf8', timeout: 15_000,
      });
      expect(run.signal).toBeNull();
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('refuses the live database');
      expect(existsSync(join(copy, 'data', 'wt-builder.db'))).toBe(false);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }, 20_000);
});
