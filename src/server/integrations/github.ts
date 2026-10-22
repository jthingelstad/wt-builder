/**
 * Committing generated files to a GitHub repository.
 *
 * Two legs commit through this: the website handoff and an Another Thing
 * episode's send, each pointed at its own repository through `RepoTarget`.
 * The archive leg only knocks (`dispatch`): the library pulls the issue
 * itself. The episode's commit carries its mp3, so a file's content
 * may be a Buffer, uploaded as a base64 blob. A handoff must land as one
 * commit: a half-applied set would leave the render surface with an archive
 * page whose index entry is missing, or an episode with no audio. This builds
 * blobs, then a tree, then a commit, then moves the ref — the same
 * mechanism Studio uses, so the two produce identical history.
 *
 * Idempotent: files already matching the branch tree are skipped, and a push
 * where nothing changed creates no commit.
 */

import { createHash } from 'node:crypto';

import { config, credentials } from '../config.ts';

const API = 'https://api.github.com';

export class MissingTokenError extends Error {}
export class RefUpdateConflict extends Error {}

export interface RepoFile {
  /** Repo-relative, forward slashes, from the repo root. */
  path: string;
  content: string;
}

/** A file a push may carry as bytes: an episode's mp3. */
export interface RepoBlob {
  path: string;
  content: string | Buffer;
}

/** The token for a repository: the target's own, or GITHUB_PAT_TOKEN. */
const tokens = new Map<string, { get: () => string | undefined; name: string }>();

/** A repository whose pushes use another credential (the podcast's repo), named for the error. */
export function useToken(repo: string, get: () => string | undefined, name: string): void {
  tokens.set(repo, { get, name });
}

function token(repo: string): string {
  const own = tokens.get(repo);
  const t = own ? own.get() : credentials.githubToken;
  if (!t) {
    const name = own?.name ?? 'GITHUB_PAT_TOKEN';
    throw new MissingTokenError(
      `${name} is not set. A fine-grained PAT with Contents: write on ${repo} is required.`,
    );
  }
  return t;
}

/** A blob of an episode's mp3 is tens of MB, base64: give it longer than a page. */
async function call(repo: string, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<any> {
  const res = await fetch(`${API}/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token(repo)}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub ${path} failed: ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Git's own blob hash, so a file can be compared against the remote tree
 * without fetching its content.
 */
export function blobSha(content: string | Buffer): string {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${body.length}\0`)
    .update(body)
    .digest('hex');
}

async function head(repo: string, branch: string): Promise<{ commit: string; tree: string }> {
  const ref = await call(repo, `/git/ref/heads/${branch}`);
  const commit = await call(repo, `/git/commits/${ref.object.sha}`);
  return { commit: ref.object.sha, tree: commit.tree.sha };
}

async function treeBlobs(repo: string, treeSha: string): Promise<Map<string, string>> {
  const tree = await call(repo, `/git/trees/${treeSha}?recursive=1`);
  const out = new Map<string, string>();
  for (const entry of tree.tree ?? []) {
    if (entry.type === 'blob') out.set(entry.path, entry.sha);
  }
  return out;
}

export interface PushResult {
  sha: string;
  changed: string[];
  unchanged: number;
  committed: boolean;
}

/** Which repository and branch a push lands on. Defaults to the website. */
export interface RepoTarget {
  repo?: string;
  branch?: string;
}

function targetOf(t: RepoTarget): { repo: string; branch: string } {
  return { repo: t.repo ?? config.websiteRepo, branch: t.branch ?? 'main' };
}

/**
 * One file's current content on the target branch, or null when absent.
 * The back catalogue reads each live issue page through this before it
 * renders the page's audio.
 */
export async function readFile(path: string, target: RepoTarget = {}): Promise<string | null> {
  const { repo, branch } = targetOf(target);
  const { tree } = await head(repo, branch);
  const blobs = await treeBlobs(repo, tree);
  const sha = blobs.get(path);
  if (!sha) return null;
  const blob = await call(repo, `/git/blobs/${sha}`);
  return Buffer.from(String(blob.content ?? ''), 'base64').toString('utf8');
}

/** Every file path under `prefix` on the target branch: what a directory holds. */
export async function listPaths(prefix: string, target: RepoTarget = {}): Promise<string[]> {
  const { repo, branch } = targetOf(target);
  const { tree } = await head(repo, branch);
  return [...(await treeBlobs(repo, tree)).keys()].filter((p) => p.startsWith(prefix));
}

/** What a push would change, without changing anything. */
export async function diff(files: RepoBlob[], target: RepoTarget = {}): Promise<PushResult> {
  const { repo, branch } = targetOf(target);
  const { commit, tree } = await head(repo, branch);
  const remote = await treeBlobs(repo, tree);
  const changed = files.filter((f) => remote.get(f.path) !== blobSha(f.content)).map((f) => f.path);
  return {
    sha: commit,
    changed,
    unchanged: files.length - changed.length,
    committed: false,
  };
}

/**
 * Commit `files` as one atomic commit. Retries once on a lost ref-update race,
 * rebuilding against the new head rather than forcing. `remove` names paths
 * the same commit deletes, where they exist: a re-sent episode without its
 * transcript takes the old one away rather than leaving it behind.
 */
export async function putTree(
  files: RepoBlob[],
  message: string,
  target: RepoTarget = {},
  remove: string[] = [],
): Promise<PushResult> {
  if (!files.length) throw new Error('putTree requires at least one file');
  const { repo, branch } = targetOf(target);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { commit: parent, tree: baseTree } = await head(repo, branch);
    const remote = await treeBlobs(repo, baseTree);

    const changed = files.filter((f) => remote.get(f.path) !== blobSha(f.content));
    const removed = remove.filter((path) => remote.has(path) && !files.some((f) => f.path === path));
    if (!changed.length && !removed.length) {
      return { sha: parent, changed: [], unchanged: files.length, committed: false };
    }

    const entries: { path: string; mode: string; type: string; sha: string | null }[] = [];
    for (const file of changed) {
      const blob = Buffer.isBuffer(file.content)
        ? await call(repo, '/git/blobs', {
            method: 'POST',
            body: JSON.stringify({ content: file.content.toString('base64'), encoding: 'base64' }),
          }, 300_000)
        : await call(repo, '/git/blobs', {
            method: 'POST',
            body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
          });
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    // A null sha is how the Git Data API takes a path out of the tree.
    for (const path of removed) entries.push({ path, mode: '100644', type: 'blob', sha: null });

    const tree = await call(repo, '/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTree, tree: entries }),
    });

    const commit = await call(repo, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
    });

    try {
      await call(repo, `/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      return {
        sha: commit.sha,
        changed: [...changed.map((f) => f.path), ...removed],
        unchanged: files.length - changed.length,
        committed: true,
      };
    } catch (err) {
      // Only a lost ref-update race is worth a rebuild-and-retry — GitHub
      // answers it 409 or 422. Anything else (bad token, missing scope) will
      // fail identically the second time and must not be reported as a race.
      const message = (err as Error).message;
      if (!/ (409|422) /.test(message)) throw err;
      lastError = err as Error;
    }
  }

  throw new RefUpdateConflict(
    `lost the ref-update race on ${branch} twice: ${lastError?.message ?? 'unknown'}`,
  );
}

/** Blob contents by sha, fetched eight at a time; a blob never changes, so the cache never goes stale. */
async function blobContents(repo: string, shas: string[], cache: Map<string, string>): Promise<void> {
  const wanted = [...new Set(shas.filter((sha) => !cache.has(sha)))];
  for (let i = 0; i < wanted.length; i += 8) {
    await Promise.all(
      wanted.slice(i, i + 8).map(async (sha) => {
        const blob = await call(repo, `/git/blobs/${sha}`);
        cache.set(sha, Buffer.from(String(blob.content ?? ''), 'base64').toString('utf8'));
      }),
    );
  }
}

/** Many files' current content at one commit, null where absent — one tree read, not one per file. */
export async function readFiles(paths: string[], target: RepoTarget = {}): Promise<Map<string, string | null>> {
  const { repo, branch } = targetOf(target);
  const { tree } = await head(repo, branch);
  const blobs = await treeBlobs(repo, tree);
  const cache = new Map<string, string>();
  await blobContents(repo, paths.map((p) => blobs.get(p)).filter((s): s is string => Boolean(s)), cache);
  return new Map(paths.map((p) => [p, blobs.has(p) ? cache.get(blobs.get(p)!)! : null]));
}

/**
 * Commit edits to files as they stand **at commit time**, as one commit.
 * `edit` gets each path's current content and returns its new content, or
 * null to leave it alone. A lost ref-update race re-reads and re-applies
 * rather than committing what it read earlier, so two writers editing
 * different parts of one page — the back catalogue's audio record and the
 * re-render's body — can never commit a stale copy over each other.
 *
 * Content goes inline in the tree in batches, not as one blob per file:
 * a re-render touches hundreds of pages, past GitHub's content-creation
 * limit for blobs.
 */
export async function editTree(
  paths: string[],
  edit: (path: string, current: string | null) => string | null,
  message: string,
  target: RepoTarget = {},
): Promise<PushResult> {
  if (!paths.length) throw new Error('editTree requires at least one path');
  const { repo, branch } = targetOf(target);
  const cache = new Map<string, string>();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { commit: parent, tree: baseTree } = await head(repo, branch);
    const remote = await treeBlobs(repo, baseTree);
    await blobContents(repo, paths.map((p) => remote.get(p)).filter((s): s is string => Boolean(s)), cache);

    const changed: RepoFile[] = [];
    for (const path of paths) {
      const sha = remote.get(path);
      const next = edit(path, sha ? cache.get(sha)! : null);
      if (next !== null && remote.get(path) !== blobSha(next)) changed.push({ path, content: next });
    }
    if (!changed.length) return { sha: parent, changed: [], unchanged: paths.length, committed: false };

    let tree = baseTree;
    for (let i = 0; i < changed.length; i += 40) {
      const entries = changed.slice(i, i + 40).map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }));
      tree = (await call(repo, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: tree, tree: entries }) })).sha;
    }
    const commit = await call(repo, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree, parents: [parent] }),
    });

    try {
      await call(repo, `/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      return { sha: commit.sha, changed: changed.map((f) => f.path), unchanged: paths.length - changed.length, committed: true };
    } catch (err) {
      if (!/ (409|422) /.test((err as Error).message)) throw err;
      lastError = err as Error;
    }
  }

  throw new RefUpdateConflict(`lost the ref-update race on ${branch} three times: ${lastError?.message ?? 'unknown'}`);
}

/**
 * Send a `repository_dispatch` event, which starts the workflows in `repo`
 * that listen for `eventType`. Carries no files: the archive leg tells the
 * library an issue is out, and the library round pulls it from the website
 * repository (librarian-thing `.github/workflows/library-round.yml`). The
 * token needs Contents: write on `repo`, which the archive commits needed too.
 */
export async function dispatch(eventType: string, payload: Record<string, unknown>, target: RepoTarget = {}): Promise<void> {
  const { repo } = targetOf(target);
  await call(repo, '/dispatches', {
    method: 'POST',
    body: JSON.stringify({ event_type: eventType, client_payload: payload }),
  });
}

export function isConfigured(): boolean {
  return Boolean(credentials.githubToken);
}
