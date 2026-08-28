/** Assembly operations and the document store. */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IssueDoc } from '../src/shared/types.ts';
import { issueWindow, snapToSaturday } from '../src/shared/dates.ts';
import {
  addMarkdownBlock, addSection, createIssue, demote, hideItem, moveNode,
  promote, readiness, removeSection, setChannel, setWindowDays,
} from '../src/server/issue.ts';
import { planEdition } from '../src/shared/render/plan.ts';
import { renderWebsite } from '../src/shared/render/website.ts';
import { renderAudio } from '../src/shared/render/audio.ts';

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

describe('the issue window', () => {
  it('closes Friday, so the span ends Thursday', () => {
    // Publication Saturday 2026-09-05 → window ends Thursday 2026-09-03.
    const w = issueWindow('2026-09-05', 7);
    expect(w.to).toBe('2026-09-03');
    expect(w.from).toBe('2026-08-28');
  });

  it('snaps a publication date forward to Saturday', () => {
    expect(snapToSaturday('2026-09-02')).toBe('2026-09-05');
    expect(snapToSaturday('2026-09-05')).toBe('2026-09-05');
  });
});

describe('creating an issue', () => {
  it('lays down the familiar skeleton with Echoes pinned last', () => {
    const doc = createIssue({ number: 351, publication_date: '2026-09-12' });
    expect(doc.issue.number).toBe(351);
    expect(doc.nodes.at(-1)?.type).toBe('echoes');
    expect(doc.nodes.find((n) => n.type === 'echoes')?.fixed_position).toBe('last');
  });

  it('gives headless sections publishes_heading false', () => {
    const doc = createIssue({ number: 351, publication_date: '2026-09-12' });
    for (const type of ['photo', 'haiku', 'membership', 'intro', 'outro']) {
      expect(doc.nodes.find((n) => n.type === type)?.publishes_heading, type).toBe(false);
    }
    expect(doc.nodes.find((n) => n.type === 'notable')?.publishes_heading).toBe(true);
  });

  it('clamps the window to something sane', () => {
    const doc = createIssue({ number: 351, publication_date: '2026-09-12' });
    expect(setWindowDays(doc, 900).issue.window_days).toBe(60);
    expect(setWindowDays(doc, 0).issue.window_days).toBe(1);
  });
});

describe('channels replace inclusion', () => {
  it('hides an item by turning every channel off', () => {
    const hidden = hideItem(fixture(), 'link-flipcash');
    expect(hidden.items['link-flipcash']!.channels).toEqual({
      website: false, email: false, audio: false,
    });
    expect(renderWebsite(hidden)).not.toContain('Flipcash');
  });

  it('refuses to switch on a locked channel, and says why', () => {
    const doc = fixture();
    expect(doc.items['photo-1']!.channel_locks?.audio).toBeTruthy();
    const after = setChannel(doc, 'photo-1', 'audio', true);
    expect(after.items['photo-1']!.channels.audio).toBe(false);
  });

  it('still allows the other channels of a locked item to change', () => {
    const after = setChannel(fixture(), 'photo-1', 'email', false);
    expect(after.items['photo-1']!.channels.email).toBe(false);
    expect(after.items['photo-1']!.channels.website).toBe(true);
  });
});

describe('promotion', () => {
  it('promotes a Journal post to its own node without losing provenance', () => {
    const doc = promote(fixture(), 'journal-concert');
    const node = doc.nodes.find((n) => n.kind === 'promoted_item' && n.items.includes('journal-concert'));
    expect(node).toBeTruthy();
    expect(node?.publishes_heading).toBe(true);
    const item = doc.items['journal-concert']!;
    expect(item.presentation).toBe('promoted');
    expect(item.source).toBe('Micro.blog');
    expect(item.source_url).toContain('thingelstad.com');
  });

  it('demotes back into Journal in publication order', () => {
    const promoted = promote(fixture(), 'journal-concert');
    // The fixture already carries a promoted post, so select by item, not by kind.
    const node = promoted.nodes.find(
      (n) => n.kind === 'promoted_item' && n.items.includes('journal-concert'),
    )!;
    const back = demote(promoted, node.id);
    const journal = back.nodes.find((n) => n.type === 'journal')!;
    expect(journal.items).toContain('journal-concert');
    expect(back.items['journal-concert']!.presentation).toBe('journal');
    expect(back.nodes.find((n) => n.id === node.id)).toBeUndefined();
  });
});

describe('sections', () => {
  it('holds items out rather than deleting them when a section is removed', () => {
    const doc = removeSection(fixture(), 'briefly');
    expect(doc.nodes.find((n) => n.id === 'briefly')).toBeUndefined();
    expect(doc.items['briefly-forge']).toBeTruthy();
    expect(doc.orphans).toContain('briefly-forge');
    expect(renderWebsite(doc)).not.toContain('## Briefly');
  });

  it('reclaims held-out items when the section is offered back', () => {
    const removed = removeSection(fixture(), 'briefly');
    const restored = addSection(removed, { id: 'briefly', type: 'briefly', label: 'Briefly' });
    const briefly = restored.nodes.find((n) => n.id === 'briefly')!;
    expect(briefly.items).toContain('briefly-forge');
    expect(restored.orphans).not.toContain('briefly-forge');
  });

  it('never places a new section after Echoes', () => {
    const doc = addSection(fixture(), { type: 'ad_hoc', label: 'Postscript' });
    expect(doc.issue.output_order?.at(-1)).toBe('echoes');
    expect(renderWebsite(doc).trimEnd().split('\n\n').at(-1)).toBeTruthy();
  });

  it('adds a headless Markdown block', () => {
    const doc = addMarkdownBlock(fixture());
    const node = doc.nodes.find((n) => n.type === 'mdblock' && n.id !== 'ps-email')!;
    expect(node.publishes_heading).toBe(false);
    expect(node.items).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('will not move a node past the pinned Echoes', () => {
    const doc = fixture();
    const before = doc.issue.output_order!.indexOf('echoes');
    const after = moveNode(doc, 'haiku', 1).issue.output_order!;
    expect(after.indexOf('echoes')).toBe(before);
    expect(after.at(-1)).toBe('echoes');
  });

  it('moves a movable node up', () => {
    const doc = moveNode(fixture(), 'briefly', -1);
    const order = doc.issue.output_order!;
    expect(order.indexOf('briefly')).toBeLessThan(order.indexOf('journal'));
  });
});

describe('readiness', () => {
  it('counts an empty commentary as outstanding', () => {
    const r = readiness(fixture());
    const commentary = r.units.filter((u) => u.title.startsWith('Commentary for'));
    expect(commentary.some((u) => !u.done)).toBe(true);
  });

  it('flags a failed Pinboard write', () => {
    const r = readiness(fixture());
    expect(r.units.some((u) => u.title.startsWith('Pinboard write failed'))).toBe(true);
  });

  it('treats a missing standard section as settled, not outstanding', () => {
    const doc = removeSection(fixture(), 'photo');
    const r = readiness(doc);
    const photo = r.units.find((u) => u.title.startsWith('Photo placed'));
    expect(photo?.done).toBe(true);
    expect(photo?.title).toContain('not in this issue');
  });
});

describe('an issue without the skeleton', () => {
  it('renders when it is nothing but Markdown blocks', () => {
    let doc = createIssue({ number: 400, publication_date: '2026-10-03' });
    for (const id of doc.nodes.map((n) => n.id)) doc = removeSection(doc, id);
    doc = addMarkdownBlock(doc);
    const only = Object.entries(doc.items).find(([, i]) => i.type === 'markdown')!;
    doc.items[only[0]]!.body = 'A single thought, and nothing else.';
    const out = renderWebsite(doc);
    expect(out).toContain('A single thought, and nothing else.');
    expect(out).not.toContain('## Echoes');
  });

  it('renders audio with no Echoes and still closes', () => {
    let doc = removeSection(fixture(), 'echoes');
    const script = renderAudio(doc);
    expect(script).not.toContain('Echoes');
    expect(script.trimEnd().endsWith('That brings us to the end of The Weekly Thing.')).toBe(true);
  });
});

describe('the store', () => {
  const dbPath = join(tmpdir(), `wt-builder-test-${process.pid}.db`);
  let store: typeof import('../src/server/db.ts');

  beforeEach(async () => {
    store = await import('../src/server/db.ts');
    store.closeDb();
    store.openDb(dbPath);
  });

  afterEach(() => {
    store.closeDb();
    for (const suffix of ['', '-shm', '-wal']) {
      try { rmSync(`${dbPath}${suffix}`); } catch { /* not there */ }
    }
  });

  it('round-trips a document and derives its listing columns', () => {
    const doc = fixture();
    const row = store.saveIssue(doc);
    expect(row.number).toBe(350);
    expect(row.publication_date).toBe('2026-09-05');
    expect(row.doc.items['intro-1']!.body).toContain('Welcome back');
    expect(store.listIssues()).toHaveLength(1);
  });

  it('records a send without rewriting the document', () => {
    store.saveIssue(fixture());
    const after = store.recordSend('fixture-wt350', 'buttondown', {
      status: 'sent', at: '2026-09-05T09:00:00Z', external_id: 'draft-1',
    });
    expect(after?.doc.sends?.buttondown?.status).toBe('sent');
    expect(after?.doc.items['intro-1']!.body).toContain('Welcome back');
  });

  it('counts only published issues when defaulting the next number', async () => {
    // Nine years shipped before WT Builder and are not imported (0020), so the
    // configured floor stands in for that history. A draft never advances it.
    const { config } = await import('../src/server/config.ts');
    const floor = config.lastPublishedIssue;

    store.saveIssue(fixture());
    expect(store.lastPublishedNumber(), 'a draft must not advance numbering').toBe(floor);

    const published = fixture();
    published.issue.status = 'published';
    store.saveIssue(published);
    expect(store.lastPublishedNumber()).toBe(Math.max(350, floor));
  });

  it('never numbers below the pre-Builder history', async () => {
    const { config } = await import('../src/server/config.ts');
    expect(store.lastPublishedNumber()).toBeGreaterThanOrEqual(config.lastPublishedIssue);
  });
});
