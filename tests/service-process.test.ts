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
import { createServer, type AddressInfo } from 'node:net';
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

describe('the service fails a stranded send before it serves', () => {
  it('a leg left sending by the last process is failed, keeping its last good send, by the time it is listening', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const work = mkdtempSync(join(tmpdir(), 'wt-strand-'));
    const db = join(work, 'strand.db');
    // Seeded from this process, then closed: the service opens it next.
    process.env.WT_BUILDER_DB = db;
    const store = await import('../src/server/db.ts');
    const probe = join(work, 'probe.mjs');
    // Exits the moment the service says it is listening: anything boot does
    // after that line never runs.
    writeFileSync(probe, `
      const log = console.log;
      console.log = (...args) => {
        log(...args);
        if (String(args[0]).startsWith('WT Builder on')) process.exit(0);
      };
    `);
    try {
      store.createIssueRow({
        schema_version: 1, sends: {}, items: {}, nodes: [],
        issue: { id: 'wt990431', number: 990431, title: 'Strand', status: 'draft', publication_date: '2026-11-28', window_days: 7 },
      } as never);
      store.recordSend('wt990431', 'buttondown', { status: 'sent', at: '2026-11-27T12:00:00Z', external_id: 'em-9' });
      store.recordSend('wt990431', 'buttondown', { status: 'sending', at: new Date().toISOString(), external_id: 'em-9' });
      store.closeDb();

      const run = spawnSync(process.execPath, ['--import', 'tsx', '--import', probe, 'src/server/index.ts'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, WT_BUILDER_OFFLINE: '1', WT_BUILDER_PORT: '0', WT_BUILDER_DB: db, WT_BUILDER_TTS_CACHE: join(work, 'tts') },
      });
      expect(run.stdout).toContain('WT Builder on');

      const leg = store.getIssue('wt990431')!.doc.sends!.buttondown!;
      expect(leg).toMatchObject({ status: 'failed', error: 'interrupted by a restart', external_id: 'em-9' });
      expect(leg.last_sent).toMatchObject({ status: 'sent', external_id: 'em-9' });
    } finally {
      store.closeDb();
      rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('only the process that holds the port sweeps', () => {
  it('a second process whose listen fails leaves the live service\'s sending legs alone', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const work = mkdtempSync(join(tmpdir(), 'wt-second-'));
    const db = join(work, 'second.db');
    // db.ts is already loaded by the test above, its path fixed: open this
    // one by name, here and after the child has run.
    const store = await import('../src/server/db.ts');
    store.closeDb();
    store.openDb(db);
    // The live service, as far as the port is concerned.
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
    const port = (holder.address() as AddressInfo).port;
    try {
      store.createIssueRow({
        schema_version: 1, sends: {}, items: {}, nodes: [],
        issue: { id: 'wt990432', number: 990432, title: 'Second', status: 'draft', publication_date: '2026-11-28', window_days: 7 },
      } as never);
      const at = new Date().toISOString();
      store.recordSend('wt990432', 'podcast', { status: 'sending', at });
      store.closeDb();

      // npm run dev, or npm start beside the service: same database, port taken.
      const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, WT_BUILDER_OFFLINE: '1', WT_BUILDER_HOST: '127.0.0.1', WT_BUILDER_PORT: String(port), WT_BUILDER_DB: db, WT_BUILDER_TTS_CACHE: join(work, 'tts') },
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('EADDRINUSE');
      expect(run.stdout).not.toContain('WT Builder on');

      store.openDb(db);
      expect(store.getIssue('wt990432')!.doc.sends!.podcast).toMatchObject({ status: 'sending', at });
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
      store.closeDb();
      rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);
});
