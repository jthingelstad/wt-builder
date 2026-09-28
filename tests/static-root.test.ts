/**
 * The server's static root is configurable, so the browser suite can build
 * and serve its own client instead of overwriting the dist/ the live service
 * serves. `npm run test:e2e` once rebuilt dist/ in place: an untested client
 * could reach Jamie mid-session before `npm test` had run (review 2026-09-27,
 * §1.7).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Both must be decided before the server's config module loads.
const work = mkdtempSync(join(tmpdir(), 'wt-static-'));
const dist = join(work, 'dist');
mkdirSync(join(dist, 'assets'), { recursive: true });
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>e2e build</title>');
writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("e2e build");');
process.env.WT_BUILDER_DB = join(work, 'static.db');
process.env.WT_BUILDER_DIST = dist;

const { server } = await import('../src/server/index.ts');

let base = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  rmSync(work, { recursive: true, force: true });
});

describe('WT_BUILDER_DIST is the static root', () => {
  it('serves the shell from it', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(readFileSync(join(dist, 'index.html'), 'utf8'));
  });

  it('serves an asset from it', async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('e2e build');
  });

  it('an app route falls back to its shell', async () => {
    const res = await fetch(`${base}/wt999`);
    expect(await res.text()).toContain('<title>e2e build</title>');
  });
});
