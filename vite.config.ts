/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
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
});
