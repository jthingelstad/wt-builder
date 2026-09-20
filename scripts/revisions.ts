/**
 * What an item said, over time. The recovery tool for the day something in
 * an issue is not what Jamie typed.
 *
 *   npm run revisions -- wt350                    every item whose text ever differed
 *   npm run revisions -- wt350 currently-mua5s03m  one item, every distinct version
 *
 * Read-only. Restoring is an edit in the builder, or a PATCH — the script
 * prints the text; it never writes it back.
 */

import * as store from '../src/server/db.ts';
import type { Item } from '../src/shared/types.ts';

const [issueId, itemId] = process.argv.slice(2);
if (!issueId) {
  console.error('usage: revisions <issue-id> [item-id]');
  process.exit(2);
}

const current = store.getIssue(issueId);
if (!current) {
  console.error(`no issue ${issueId}`);
  process.exit(1);
}

const text = (item: Item | undefined) =>
  item ? [item.title, item.commentary, item.body].filter((v) => v !== undefined).join('\n') : undefined;

// Oldest first, current last.
const timeline = [
  ...store.listRevisions(issueId).reverse().map((r) => ({ at: r.saved_at, doc: r.doc })),
  { at: current.updated_at, doc: current.doc },
];

const ids = itemId ? [itemId] : [...new Set(timeline.flatMap((t) => Object.keys(t.doc.items)))];

for (const id of ids) {
  const versions: { at: string; text: string | undefined }[] = [];
  for (const t of timeline) {
    const v = text(t.doc.items[id]);
    if (!versions.length || versions[versions.length - 1]!.text !== v) versions.push({ at: t.at, text: v });
  }
  if (versions.length < 2 && !itemId) continue;
  console.log(`\n== ${id} — ${versions.length} version${versions.length === 1 ? '' : 's'}`);
  for (const v of versions) {
    console.log(`\n-- ${v.at}${v.text === undefined ? ' (absent)' : ''}`);
    if (v.text !== undefined) console.log(v.text);
  }
}
