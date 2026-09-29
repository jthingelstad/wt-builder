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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  // After a deploy, an open tab asks for the chunks of the build it was
  // loaded from. Answered with index.html, a lazy import parsed HTML as
  // JavaScript; a 404 fails it plainly (review 2026-09-27 §2.4).
  it('a missing asset is a 404, not the shell', async () => {
    const res = await fetch(`${base}/assets/gone-0a1b2c3d.js`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<title>e2e build</title>');
  });
});

describe('npm run test:e2e serves the client it built', () => {
  // The server above honours WT_BUILDER_DIST; this holds the wiring around
  // it. Drop --outDir and the suite overwrites the live dist/ again; drop
  // WT_BUILDER_DIST and it tests whatever stale build is in dist/.
  const root = fileURLToPath(new URL('..', import.meta.url));

  it('builds into the directory Playwright hands the server, which is not dist/', async () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const script: string = pkg.scripts['test:e2e'];
    const build = script.split('&&')[0]!.trim();
    expect(build).toMatch(/^vite build\b/);
    expect(build).toContain('--emptyOutDir');
    const outDir = /--outDir\s+(\S+)/.exec(build)?.[1];
    expect(outDir).toBeDefined();

    const { default: pw } = await import('../playwright.config.ts');
    const webServer = Array.isArray(pw.webServer) ? pw.webServer[0] : pw.webServer;
    const served = webServer?.env?.WT_BUILDER_DIST;
    expect(served).toBeDefined();

    // Playwright runs from the repository root, as npm does.
    expect(resolve(root, served!)).toBe(resolve(root, outDir!));
    expect(resolve(root, outDir!)).not.toBe(resolve(root, 'dist'));
  });
});
