/**
 * The service, as a process, survives an error nothing awaited.
 *
 * `logStrayErrors` is tested against a stand-in in tests/routes.test.ts; this
 * proves the running service installs it. The server is booted offline
 * against a throwaway database, with a probe preloaded that throws and
 * rejects once the service says it is listening. Without the handler the
 * process dies of the first; with it, both are logged and it keeps running.
 * (That a service which cannot boot still exits is held in offline.test.ts.)
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('the running service logs a stray error and keeps running', () => {
  it('an uncaught exception and an unhandled rejection after boot do not end it', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const work = mkdtempSync(join(tmpdir(), 'wt-stray-'));
    const probe = join(work, 'probe.mjs');
    writeFileSync(probe, `
      const log = console.log;
      let armed = false;
      console.log = (...args) => {
        log(...args);
        if (armed || !String(args[0]).startsWith('WT Builder on')) return;
        armed = true;
        setTimeout(() => { throw new Error('stray-probe-exception'); }, 0);
        setTimeout(() => { Promise.reject(new Error('stray-probe-rejection')); }, 50);
        setTimeout(() => { log('probe: still running'); process.exit(0); }, 300);
      };
    `);
    try {
      const run = spawnSync(process.execPath, ['--import', 'tsx', '--import', probe, 'src/server/index.ts'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          ...process.env,
          WT_BUILDER_OFFLINE: '1',
          WT_BUILDER_PORT: '0',
          WT_BUILDER_DB: join(work, 'stray.db'),
          WT_BUILDER_TTS_CACHE: join(work, 'tts'),
        },
      });
      expect(run.stdout).toContain('WT Builder on');
      expect(run.stderr).toContain('uncaught exception, still running');
      expect(run.stderr).toContain('stray-probe-exception');
      expect(run.stderr).toContain('unhandled rejection, still running');
      expect(run.stderr).toContain('stray-probe-rejection');
      expect(run.stdout).toContain('probe: still running');
      expect(run.status).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);
});
