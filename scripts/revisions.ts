/**
 * What an item said, over time. The recovery tool for the day something in
 * an issue is not what Jamie typed, or the issue itself is gone.
 *
 *   npm run revisions -- wt350                    every item whose text ever differed
 *   npm run revisions -- wt350 currently-mua5s03m  one item, every distinct version
 *   npm run revisions -- wt352 --restore          bring a deleted issue back
 *
 * Read-only for an issue that exists: restoring a line is an edit in the
 * builder, or a PATCH — the script prints the text; it never writes it back.
 * A deleted issue (DELETE /api/issues/:id keeps the document as it stood
 * among its revisions) is still listed from those revisions, and --restore
 * recreates its row from the newest one. It restores nothing else.
 *
 * Issue ids are wt<number>, so an issue re-created under a deleted one's
 * number shares its revision history: the listing shows both, oldest first.
 */

import * as store from '../src/server/db.ts';
import type { Item } from '../src/shared/types.ts';

const args = process.argv.slice(2);
const restore = args.includes('--restore');
const [issueId, itemId] = args.filter((a) => a !== '--restore');
if (!issueId) {
  console.error('usage: revisions <issue-id> [item-id] | revisions <issue-id> --restore');
  process.exit(2);
}

const current = store.getIssue(issueId);
const revisions = store.listRevisions(issueId); // newest first
if (!current && !revisions.length) {
  console.error(`no issue ${issueId}, and no revisions kept for it`);
  process.exit(1);
}

if (restore) {
  if (current) {
    console.error(`${issueId} is not deleted — restoring over a live issue is an edit in the builder`);
    process.exit(1);
  }
  const newest = revisions[0]!;
  const clash = store.getIssueByNumber(newest.doc.issue.number);
  if (clash) {
    console.error(`WT${newest.doc.issue.number} is taken by ${clash.id} — delete or renumber it first`);
    process.exit(1);
  }
  store.saveIssue(newest.doc);
  store.logEvent(issueId, 'issue', `Restored from revisions — WT${newest.doc.issue.number}, as it stood ${newest.saved_at}`);
  console.log(`restored ${issueId} (WT${newest.doc.issue.number}) as it stood ${newest.saved_at}`);
  process.exit(0);
}

if (!current) {
  console.log(
    `${issueId} is deleted; ${revisions.length} revision${revisions.length === 1 ? '' : 's'} kept, ` +
      `the newest from ${revisions[0]!.saved_at}. Bring it back: npm run revisions -- ${issueId} --restore`,
  );
}

const text = (item: Item | undefined) =>
  item ? [item.title, item.commentary, item.body].filter((v) => v !== undefined).join('\n') : undefined;

// Oldest first, current last (a deleted issue ends at its newest revision).
const timeline = [
  ...[...revisions].reverse().map((r) => ({ at: r.saved_at, doc: r.doc })),
  ...(current ? [{ at: current.updated_at, doc: current.doc }] : []),
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
