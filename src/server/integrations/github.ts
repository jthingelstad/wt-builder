/**
 * Committing generated files to a GitHub repository.
 *
 * Two legs ride this: the website handoff and the archive feed, each pointed
 * at its own repository through `RepoTarget`. A handoff must land as one
 * commit: a half-applied set would leave the render surface with an archive
 * page whose index entry is missing, or the corpus with links and no text. This
 * builds blobs, then a tree, then a commit, then moves the ref — the same
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

function token(): string {
  const t = credentials.githubToken;
  if (!t) {
    throw new MissingTokenError(
      'GITHUB_PAT_TOKEN is not set. A fine-grained PAT with Contents: write on the website repo is required.',
    );
  }
  return t;
}

async function call(repo: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
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
export function blobSha(content: string): string {
  const body = Buffer.from(content, 'utf8');
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

/** What a push would change, without changing anything. */
export async function diff(files: RepoFile[], target: RepoTarget = {}): Promise<PushResult> {
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
 * rebuilding against the new head rather than forcing.
 */
export async function putTree(
  files: RepoFile[],
  message: string,
  target: RepoTarget = {},
): Promise<PushResult> {
  if (!files.length) throw new Error('putTree requires at least one file');
  const { repo, branch } = targetOf(target);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { commit: parent, tree: baseTree } = await head(repo, branch);
    const remote = await treeBlobs(repo, baseTree);

    const changed = files.filter((f) => remote.get(f.path) !== blobSha(f.content));
    if (!changed.length) {
      return { sha: parent, changed: [], unchanged: files.length, committed: false };
    }

    const entries = [];
    for (const file of changed) {
      const blob = await call(repo, '/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      });
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

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
        changed: changed.map((f) => f.path),
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

export function isConfigured(): boolean {
  return Boolean(credentials.githubToken);
}
