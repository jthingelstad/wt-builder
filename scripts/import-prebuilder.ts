/**
 * Import pre-Builder issues as read-only records.
 *
 * Issues 349 and back were published by the Shortcuts workflow and live
 * canonically in the archive repository's data/issues/{N}/. Each imports
 * here as the issue record: number, title, date, the archive URL, and ONE
 * Markdown block holding the published text — never parsed into items
 * (docs/decisions.md). Read-only follows from status: 'published'.
 *
 * Idempotent: an issue number already in the database is skipped, so the
 * live issue and re-runs are both safe.
 *
 *   npm run import:prebuilder [path-to-librarian-data-issues]
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { IssueDoc } from '../src/shared/types.ts';
import { SCHEMA_VERSION, allChannels } from '../src/shared/types.ts';
import * as store from '../src/server/db.ts';

const root = process.argv[2] ?? join(import.meta.dirname, '../../librarian-thing/data/issues');

/** The published body: archive.md minus its front matter. */
function bodyOf(md: string): string {
  const m = /^---\n[\s\S]*?\n---\n/.exec(md);
  return (m ? md.slice(m[0].length) : md).trim();
}

/**
 * The subject minus its own number, era by era:
 * "WT349 — Owning the Rails" → "Owning the Rails";
 * "Weekly Thing #347 / Scrum, …" → "Scrum, …";
 * "Weekly Thing for May 13, 2017" passes through — the date is the title.
 */
function titleOf(subject: string, number: number): string {
  const stripped = subject
    .replace(new RegExp(`^(?:WT|Weekly Thing #?)${number}\\s*[—–/-]\\s*`), '')
    .trim();
  return stripped || subject;
}

function importIssue(dir: string, number: number): 'imported' | 'skipped' | 'incomplete' {
  if (store.getIssueByNumber(number)) return 'skipped';

  const metaPath = join(dir, 'metadata.json');
  const mdPath = join(dir, 'archive.md');
  if (!existsSync(metaPath) || !existsSync(mdPath)) return 'incomplete';

  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    subject?: string;
    description?: string;
    publish_date?: string;
  };
  const body = bodyOf(readFileSync(mdPath, 'utf8'));

  const itemId = 'published-text';
  const doc: IssueDoc = {
    schema_version: SCHEMA_VERSION,
    issue: {
      id: `wt${number}`,
      number,
      title: titleOf(meta.subject ?? `WT${number}`, number),
      dek: meta.description ?? '',
      status: 'published',
      publication_date: (meta.publish_date ?? '').slice(0, 10) || '1970-01-01',
      window_days: 7,
      imported: true,
      archive_url: `https://weekly.thingelstad.com/archive/${number}/`,
    },
    nodes: [{
      id: 'published',
      kind: 'mdblock',
      type: 'mdblock',
      label: 'Published text',
      movable: false,
      publishes_heading: false,
      items: [itemId],
    }],
    items: {
      [itemId]: {
        type: 'markdown',
        authorship: 'Jamie',
        source: 'direct',
        channels: allChannels(),
        body,
      },
    },
    sends: {},
  };

  store.saveIssue(doc);
  return 'imported';
}

const dirs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
  .map((d) => Number(d.name))
  .sort((a, b) => a - b);

let imported = 0;
let skipped = 0;
let incomplete = 0;
for (const n of dirs) {
  const result = importIssue(join(root, String(n)), n);
  if (result === 'imported') imported++;
  else if (result === 'skipped') skipped++;
  else incomplete++;
}
console.log(`${imported} imported, ${skipped} already present, ${incomplete} incomplete, from ${root}`);
store.closeDb();
