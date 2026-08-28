/**
 * Committing generated files to a GitHub repository.
 *
 * The website handoff must land as one commit: a half-applied set would leave
 * the render surface with an archive page whose index entry is missing. This
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

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}/repos/${config.websiteRepo}${path}`, {
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

async function head(branch: string): Promise<{ commit: string; tree: string }> {
  const ref = await call(`/git/ref/heads/${branch}`);
  const commit = await call(`/git/commits/${ref.object.sha}`);
  return { commit: ref.object.sha, tree: commit.tree.sha };
}

async function treeBlobs(treeSha: string): Promise<Map<string, string>> {
  const tree = await call(`/git/trees/${treeSha}?recursive=1`);
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

/** What a push would change, without changing anything. */
export async function diff(files: RepoFile[], branch = 'main'): Promise<PushResult> {
  const { commit, tree } = await head(branch);
  const remote = await treeBlobs(tree);
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
  branch = 'main',
): Promise<PushResult> {
  if (!files.length) throw new Error('putTree requires at least one file');

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { commit: parent, tree: baseTree } = await head(branch);
    const remote = await treeBlobs(baseTree);

    const changed = files.filter((f) => remote.get(f.path) !== blobSha(f.content));
    if (!changed.length) {
      return { sha: parent, changed: [], unchanged: files.length, committed: false };
    }

    const entries = [];
    for (const file of changed) {
      const blob = await call('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      });
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const tree = await call('/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTree, tree: entries }),
    });

    const commit = await call('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
    });

    try {
      await call(`/git/refs/heads/${branch}`, {
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
      // Someone else moved the branch. Rebuild against the new head once.
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
