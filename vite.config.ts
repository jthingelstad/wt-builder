/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Each build names itself, twice: in the client (`__WT_BUILD_ID__`) and in
 * `build-id.txt` beside it, which the server sends on every API answer. A
 * tab left open across a deploy sees the two differ and offers a reload
 * (review 2026-09-27 §2.4). Builds only: under the dev server and vitest
 * the name is undefined and nothing is compared.
 */
const BUILD_ID = `${new Date().toISOString().replace(/[-:.]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;

export default defineConfig(({ command }) => ({
  plugins: [
    preact(),
    {
      name: 'wt-build-id',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-id.txt', source: `${BUILD_ID}\n` });
      },
    },
  ],
  define: command === 'build' ? { __WT_BUILD_ID__: JSON.stringify(BUILD_ID) } : {},
  root: '.',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5317,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
  },
  test: {
    // Offline by construction: config.ts never loads .env, blanks every
    // credential already in the environment, and points AWS at nothing. The
    // route tests import the whole server; on otto, without this, they would
    // run with write-back on and every key present (review 2026-09-27, §1.7).
    // A test that needs a service stubs fetch.
    env: { WT_BUILDER_OFFLINE: '1' },
  },
}));
