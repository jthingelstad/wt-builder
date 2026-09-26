/**
 * Browser tests: the real server and client, offline, against a throwaway
 * database seeded from the representative issue (tests/e2e/seed.ts).
 * WebKit first — Jamie edits in Safari, and contenteditable is exactly where
 * the engines differ. `npm run test:e2e` builds the client first.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4399;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'tmp/e2e/results',
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1400, height: 1000 } },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 1000 } } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } },
  ],
  webServer: {
    command: 'node --import tsx tests/e2e/seed.ts && node --import tsx src/server/index.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    // Offline, every sweep logs its missing credentials; that is expected noise.
    stdout: 'ignore',
    stderr: 'ignore',
    env: {
      WT_BUILDER_OFFLINE: '1',
      WT_BUILDER_PORT: String(PORT),
      WT_BUILDER_DB: `${process.cwd()}/tmp/e2e/e2e.db`,
      WT_BUILDER_TTS_CACHE: `${process.cwd()}/tmp/e2e/tts`,
    },
  },
});
