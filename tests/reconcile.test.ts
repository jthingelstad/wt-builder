/**
 * The read side of the mirror: Pinboard and Micro.blog are the CMS, and edits
 * or deletions made there must flow into the issue — legibly, never silently.
 */

import { describe, expect, it } from 'vitest';

import type { Item } from '../src/shared/types.ts';
import { reconcileItem, type RemoteFields } from '../src/server/reconcile.ts';
import { updateItem } from '../src/server/issue.ts';
import { createIssue } from '../src/server/issue.ts';

function pinboardItem(over: Partial<Item> = {}): Item {
  return {
    type: 'pinboard_link',
    authorship: 'syndicated',
    source: 'Pinboard',
    channels: { website: true, email: true, audio: true },
    source_id: 'hash-1',
    source_url: 'https://example.com/a',
    title: 'A Title',
    commentary: 'The extended text.',
    tags: ['tools'],
    sync_state: 'synced',
    source_snapshot: { title: 'A Title', commentary: 'The extended text.', tags: ['tools'] },
    source_flags: { toread: 'yes', shared: 'no' },
    ...over,
  };
}

function remote(over: Partial<RemoteFields> = {}): RemoteFields {
  return {
    title: 'A Title',
    commentary: 'The extended text.',
    tags: ['tools'],
    flags: { toread: 'yes', shared: 'no' },
    ...over,
  };
}

describe('reconcileItem — Pinboard is the CMS', () => {
  it('adopts a source-side edit when the local copy is untouched', () => {
    const item = pinboardItem();
    const outcome = reconcileItem(item, remote({ commentary: 'Rewritten on Pinboard.' }));
    expect(outcome).toBe('refreshed');
    expect(item.commentary).toBe('Rewritten on Pinboard.');
    expect(item.source_snapshot!.commentary).toBe('Rewritten on Pinboard.');
    expect(item.sync_state).toBe('synced');
  });

  it('leaves a pending local edit alone when the source has not moved', () => {
    const item = pinboardItem({ commentary: 'Edited here.', sync_state: 'local' });
    const outcome = reconcileItem(item, remote());
    expect(outcome).toBe('unchanged');
    expect(item.commentary).toBe('Edited here.');
    expect(item.sync_state).toBe('local');
  });

  it('treats identical edits on both sides as converged, not conflicting', () => {
    const item = pinboardItem({ commentary: 'Same words.', sync_state: 'local' });
    const outcome = reconcileItem(item, remote({ commentary: 'Same words.' }));
    expect(outcome).toBe('refreshed');
    expect(item.sync_state).toBe('synced');
    expect(item.source_snapshot!.commentary).toBe('Same words.');
  });

  it('marks a two-sided divergence as conflict and keeps the local copy', () => {
    const item = pinboardItem({ commentary: 'Edited here.' });
    const outcome = reconcileItem(item, remote({ commentary: 'Edited there.' }));
    expect(outcome).toBe('conflict');
    expect(item.commentary).toBe('Edited here.');
    expect(item.sync_state).toBe('conflict');
    expect(item.sync_error).toContain('commentary');
  });

  it('marks a deleted bookmark gone and keeps the local copy', () => {
    const item = pinboardItem();
    const outcome = reconcileItem(item, null);
    expect(outcome).toBe('gone');
    expect(item.sync_state).toBe('gone');
    expect(item.commentary).toBe('The extended text.');
  });

  it('clears gone when the bookmark reappears', () => {
    const item = pinboardItem({ sync_state: 'gone', sync_error: 'deleted at Pinboard' });
    const outcome = reconcileItem(item, remote());
    expect(outcome).toBe('unchanged');
    expect(item.sync_state).toBe('synced');
    expect(item.sync_error).toBeUndefined();
  });

  it('refreshes source_flags so write-back replays what is true now', () => {
    // The replace=yes trap: stale flags silently publish a private bookmark.
    const item = pinboardItem();
    reconcileItem(item, remote({ flags: { toread: 'no', shared: 'yes' } }));
    expect(item.source_flags).toEqual({ toread: 'no', shared: 'yes' });
  });

  it('adopts commentary written on Pinboard into a needs_commentary item', () => {
    const item = pinboardItem({
      commentary: '',
      sync_state: 'needs_commentary',
      source_snapshot: { title: 'A Title', commentary: '', tags: ['tools'] },
    });
    const outcome = reconcileItem(item, remote({ commentary: 'Written in the CMS.' }));
    expect(outcome).toBe('refreshed');
    expect(item.commentary).toBe('Written in the CMS.');
    expect(item.sync_state).toBe('synced');
  });

  it('adopting one field never clears another field’s pending write-back', () => {
    const item = pinboardItem({ commentary: 'Edited here.', sync_state: 'local' });
    const outcome = reconcileItem(item, remote({ tags: ['tools', 'ai'] }));
    expect(outcome).toBe('refreshed');
    expect(item.tags).toEqual(['tools', 'ai']);
    expect(item.sync_state).toBe('local'); // commentary still owes a write
  });
});

describe('reconcileItem — Micro.blog posts', () => {
  function journalItem(over: Partial<Item> = {}): Item {
    return {
      type: 'journal_post',
      authorship: 'syndicated',
      source: 'Micro.blog',
      channels: { website: true, email: true, audio: true },
      source_id: 'mb-1',
      source_url: 'https://www.thingelstad.com/p.html',
      body: 'The post.',
      sync_state: 'synced',
      source_snapshot: { body: 'The post.', title: '' },
      ...over,
    };
  }

  it('adopts a blog-side edit into an untouched journal item', () => {
    const item = journalItem();
    const outcome = reconcileItem(item, { title: '', body: 'The post, revised.' });
    expect(outcome).toBe('refreshed');
    expect(item.body).toBe('The post, revised.');
    expect(item.sync_state).toBe('synced');
  });

  it('marks a deleted post gone', () => {
    const item = journalItem();
    expect(reconcileItem(item, null)).toBe('gone');
    expect(item.sync_state).toBe('gone');
  });

  it('ignores sources it does not mirror', () => {
    const item = journalItem({ source: 'direct', authorship: 'Jamie' });
    expect(reconcileItem(item, null)).toBe('unchanged');
    expect(item.sync_state).toBe('synced');
  });
});

describe('gone items cannot queue a write-back', () => {
  it('editing a gone item stays local instead of flipping to syncing', () => {
    const doc = createIssue({ number: 999, publication_date: '2026-09-05' });
    doc.items['link-1'] = pinboardItem({ sync_state: 'gone' });
    const next = updateItem(doc, 'link-1', { commentary: 'Edited after deletion.' });
    expect(next.items['link-1']!.sync_state).toBe('gone');
  });
});
