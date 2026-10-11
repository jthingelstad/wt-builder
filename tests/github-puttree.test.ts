/**
 * putTree against a fake GitHub: what it adds, what it leaves alone, and
 * what it takes away when asked (a re-sent episode's cleared transcript).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.WT_BUILDER_DB ??= '/tmp/wt-puttree-never-opened.db';
const github = await import('../src/server/integrations/github.ts');

const REPO = 'example/puttree-test';
github.useToken(REPO, () => 'test-token', 'TEST_TOKEN');

const remote = new Map<string, string>([
  ['content/episodes/002-x.md', github.blobSha('old page')],
  ['content/episodes/002-x.txt', github.blobSha('old transcript')],
]);
let trees: unknown[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const path = String(input).replace(`https://api.github.com/repos/${REPO}`, '');
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (path === '/git/ref/heads/main') return json({ object: { sha: 'parent' } });
  if (path === '/git/commits/parent') return json({ tree: { sha: 'base' } });
  if (path === '/git/trees/base?recursive=1') return json({ tree: [...remote].map(([p, sha]) => ({ path: p, sha, type: 'blob' })) });
  if (path === '/git/blobs') return json({ sha: `blob-${trees.length}` });
  if (path === '/git/trees') {
    trees.push(JSON.parse(String(init?.body)).tree);
    return json({ sha: 'tree' });
  }
  if (path === '/git/commits') return json({ sha: 'commit' });
  if (path === '/git/refs/heads/main') return json({});
  return new Response('not found', { status: 404 });
}) as typeof fetch;

afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { trees = []; });

describe('putTree', () => {
  const target = { repo: REPO, branch: 'main' };

  it('takes away a path it is asked to, in the same commit', async () => {
    const r = await github.putTree([{ path: 'content/episodes/002-x.md', content: 'new page' }], 'm', target, ['content/episodes/002-x.txt']);
    expect(r.committed).toBe(true);
    expect(r.changed).toEqual(['content/episodes/002-x.md', 'content/episodes/002-x.txt']);
    expect(trees[0]).toEqual([
      { path: 'content/episodes/002-x.md', mode: '100644', type: 'blob', sha: 'blob-0' },
      { path: 'content/episodes/002-x.txt', mode: '100644', type: 'blob', sha: null },
    ]);
  });

  it('a removal of a path that is not there is nothing to commit', async () => {
    const r = await github.putTree([{ path: 'content/episodes/002-x.md', content: 'old page' }], 'm', target, ['content/episodes/002-gone.txt']);
    expect(r.committed).toBe(false);
    expect(trees).toEqual([]);
  });

  it('never removes a path it is also writing', async () => {
    await github.putTree([{ path: 'content/episodes/002-x.txt', content: 'new transcript' }], 'm', target, ['content/episodes/002-x.txt']);
    expect(trees[0]).toEqual([{ path: 'content/episodes/002-x.txt', mode: '100644', type: 'blob', sha: 'blob-0' }]);
  });
});
