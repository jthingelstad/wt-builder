/** Assembly operations and the document store. */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IssueDoc, Item } from '../src/shared/types.ts';
import { inWindow, issueWindow, snapToSaturday, windowLabel } from '../src/shared/dates.ts';
import {
  addMarkdownBlock, addSection, createIssue, demote, hideItem, moveNode,
  promote, readiness, removeSection, setChannel, setIssueNumber, setPublicationDate, setWindowDays,
  updateItem,
} from '../src/server/issue.ts';
import { falloutOf, outOfWindow, planEdition, windowOf } from '../src/shared/render/plan.ts';
import { sourceRows } from '../src/shared/render/source.ts';
import { renderWebsite } from '../src/shared/render/website.ts';
import { renderAudio } from '../src/shared/render/audio.ts';

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

describe('the issue window', () => {
  it('runs Friday 00:00 to Friday 00:00 Central', () => {
    // Publication Saturday 2026-09-05 → sources Fri, Aug 28 → Fri, Sep 4.
    const w = issueWindow('2026-09-05', 7);
    expect(w.from).toBe('2026-08-28');
    expect(w.to).toBe('2026-09-04');
    expect(windowLabel(w)).toBe('Fri, Aug 28 \u2192 Fri, Sep 4');
  });

  it('closes on the instant, not the date', () => {
    // A Thursday 11 PM Central bookmark is stored as Friday 04:00 UTC.
    // Comparing date strings alone pushed it into the following issue.
    const w = issueWindow('2026-09-05', 7);
    expect(inWindow('2026-09-03T23:58:00-05:00', w)).toBe(true);
    expect(inWindow('2026-09-04T04:00:00Z', w)).toBe(true);
    expect(inWindow('2026-09-04T00:02:00-05:00', w)).toBe(false);
  });

  it('includes the opening instant and excludes the closing one', () => {
    const w = issueWindow('2026-09-05', 7);
    expect(inWindow('2026-08-28T00:00:00-05:00', w)).toBe(true);
    expect(inWindow('2026-08-27T23:59:00-05:00', w)).toBe(false);
    expect(inWindow('2026-09-04T00:00:00-05:00', w)).toBe(false);
  });

  it('holds midnight Central across the DST changeover', () => {
    // US clocks fall back on Sunday 2026-11-01, inside this window.
    const w = issueWindow('2026-11-07', 7);
    expect(new Date(w.fromMs).toISOString()).toBe('2026-10-30T05:00:00.000Z');
    expect(new Date(w.toMs).toISOString()).toBe('2026-11-06T06:00:00.000Z');
  });

  it('reads a bare date as Central wall clock', () => {
    const w = issueWindow('2026-09-05', 7);
    expect(inWindow('2026-09-01', w)).toBe(true);
    expect(inWindow('2026-09-04', w)).toBe(false);
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

  it('retains and restores the exact removed node', () => {
    const original = fixture().nodes.find((n) => n.id === 'journal')!;
    const removed = removeSection(fixture(), 'journal');
    expect(removed.held_nodes).toContainEqual(original);
    expect(sourceRows(removed).some((row) => row.nodeId === 'journal' && row.held)).toBe(true);

    const restored = addSection(removed, { id: 'journal', type: 'journal', label: 'Journal' });
    expect(restored.nodes.find((n) => n.id === 'journal')).toEqual(original);
    expect(restored.held_nodes).not.toContainEqual(original);
  });

  it('seeds a new ad hoc section with an editable item', () => {
    const doc = addSection(fixture(), { type: 'ad_hoc', label: 'New section' });
    const added = doc.nodes.find((n) => n.type === 'ad_hoc')!;
    expect(added.kind).toBe('ad_hoc');
    expect(added.items).toHaveLength(1);
    expect(doc.items[added.items[0]!]!.type).toBe('markdown');
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

describe('editor state', () => {
  it('marks source-owned edits as awaiting write-back', () => {
    const doc = updateItem(fixture(), 'journal-concert', { body: 'A local revision.' });
    expect(doc.items['journal-concert']!.sync_state).toBe('syncing');
  });

  it('requires a fresh review when Thingy copy changes', () => {
    const before = fixture();
    before.items['membership-1']!.reviewed = true;
    before.items['membership-1']!.status = 'reviewed';
    const after = updateItem(before, 'membership-1', { body: 'Fresh words.' });
    expect(after.items['membership-1']!.reviewed).toBe(false);
    expect(after.items['membership-1']!.status).toBe('draft');
  });

  it('updates the editable display number without changing document identity', () => {
    const doc = setIssueNumber(fixture(), 412);
    expect(doc.issue.number).toBe(412);
    expect(doc.issue.id).toBe('fixture-wt350');
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
    expect(row.publication_date).toBe('2026-05-23');
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

describe('window-derived inclusion', () => {
  const syndicated = (published_at: string): Item => ({
    type: 'pinboard_link', authorship: 'syndicated', source: 'Pinboard',
    channels: { website: true, email: true, audio: true },
    title: 'A link', source_url: 'https://example.com', published_at,
  });

  /** One section, three syndicated links, publication Saturday 2026-09-05. */
  const docWith = (...stamps: string[]): IssueDoc => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    doc.issue.window_days = 7;
    const node = { id: 'n-notable', type: 'notable', kind: 'section',
      label: 'Notable', items: [] as string[] } as unknown as IssueDoc['nodes'][number];
    stamps.forEach((stamp, i) => {
      const id = `i-${i}`;
      doc.items[id] = syndicated(stamp);
      node.items.push(id);
    });
    doc.nodes.push(node);
    return doc;
  };

  it('drops a syndicated item that falls outside the window', () => {
    const doc = docWith('2026-09-01T09:00:00-05:00', '2026-08-20T09:00:00-05:00');
    const node = planEdition(doc, 'website').find((p) => p.node.id === 'n-notable');
    expect(node?.items.map((i) => i.id)).toEqual(['i-0']);
  });

  it('re-derives when the publication date moves, with no sweep', () => {
    const doc = docWith('2026-08-29T09:00:00-05:00');
    expect(planEdition(doc, 'website').some((p) => p.node.id === 'n-notable')).toBe(true);
    // Push publication out two weeks; the item is now before the window opens.
    const moved = setPublicationDate(doc, '2026-09-19');
    expect(planEdition(moved, 'website').some((p) => p.node.id === 'n-notable')).toBe(false);
  });

  it('re-derives when the window lengthens', () => {
    const doc = docWith('2026-08-20T09:00:00-05:00');
    expect(planEdition(doc, 'website').some((p) => p.node.id === 'n-notable')).toBe(false);
    const wide = setWindowDays(doc, 21);
    expect(planEdition(wide, 'website').some((p) => p.node.id === 'n-notable')).toBe(true);
  });

  it("leaves Jamie's own writing alone — it has no capture timestamp", () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    const intro = doc.nodes.find((n) => n.type === 'intro');
    const id = intro?.items[0];
    expect(id).toBeTruthy();
    expect(outOfWindow(doc.items[id!]!, windowOf(doc))).toBe(false);
  });

  it('keeps a syndicated item with no timestamp rather than dropping it', () => {
    const doc = docWith('2026-09-01T09:00:00-05:00');
    delete doc.items['i-0']!.published_at;
    expect(outOfWindow(doc.items['i-0']!, windowOf(doc))).toBe(false);
  });

  it('reports a wholly-fallen-out section instead of letting it vanish', () => {
    const doc = docWith('2026-08-01T09:00:00-05:00', '2026-08-02T09:00:00-05:00');
    const node = doc.nodes.find((n) => n.id === 'n-notable')!;
    const f = falloutOf(doc, node, windowOf(doc));
    expect(f).toEqual({ count: 2, all: true });
    // ...and it is genuinely absent from the rendered edition.
    expect(planEdition(doc, 'website').some((p) => p.node.id === 'n-notable')).toBe(false);
  });

  it('does not flag a partly-trimmed section as wholly out', () => {
    const doc = docWith('2026-09-01T09:00:00-05:00', '2026-08-02T09:00:00-05:00');
    const node = doc.nodes.find((n) => n.id === 'n-notable')!;
    expect(falloutOf(doc, node, windowOf(doc))).toEqual({ count: 1, all: false });
  });
});

describe('section removal', () => {
  /** Briefly holds three syndicated Pinboard links; Currently holds Jamie's own. */
  it('holds out syndicated items so the sweep cannot bring them straight back', () => {
    const doc = fixture();
    const removed = removeSection(doc, 'briefly');
    expect(removed.orphans).toContain('briefly-forge');
    // Still in items{} — held out is a durable "no", not a deletion.
    expect(removed.items['briefly-forge']).toBeTruthy();
  });

  it("deletes locally-authored items, which have no sweep to return from", () => {
    const doc = fixture();
    const currently = doc.nodes.find((n) => n.type === 'currently');
    const localIds = currently!.items.filter((id) => doc.items[id]?.authorship !== 'syndicated');
    expect(localIds.length).toBeGreaterThan(0);

    const removed = removeSection(doc, currently!.id);
    for (const id of localIds) {
      expect(removed.items[id]).toBeUndefined();
      expect(removed.orphans ?? []).not.toContain(id);
    }
  });

  it('keeps deleted local items reachable only through Put back', () => {
    const doc = fixture();
    const currently = doc.nodes.find((n) => n.type === 'currently')!;
    const localId = currently.items.find((id) => doc.items[id]?.authorship !== 'syndicated')!;
    const before = doc.items[localId];

    const removed = removeSection(doc, currently.id);
    // Out of every rendering path...
    expect(sourceRows(removed).some((r) => r.itemId === localId)).toBe(false);
    for (const channel of ['website', 'email', 'audio'] as const) {
      expect(planEdition(removed, channel).some((p) => p.items.some((i) => i.id === localId)))
        .toBe(false);
    }
    // ...but restored intact when the section comes back.
    const restored = addSection(removed, {
      id: currently.id, type: currently.type, label: currently.label,
    });
    expect(restored.items[localId]).toEqual(before);
    expect(restored.held_items?.[localId]).toBeUndefined();
  });

  it('restores a mixed section whole', () => {
    const doc = fixture();
    const journal = doc.nodes.find((n) => n.type === 'journal')!;
    const ids = [...journal.items];
    const restored = addSection(removeSection(doc, journal.id), {
      id: journal.id, type: journal.type, label: journal.label,
    });
    const back = restored.nodes.find((n) => n.id === journal.id);
    expect(back?.items).toEqual(ids);
    for (const id of ids) expect(restored.items[id]).toBeTruthy();
  });
});

describe('the photo section', () => {
  it('is seeded with an empty item, because that item is the drop zone', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    const photo = doc.nodes.find((n) => n.type === 'photo');
    expect(photo?.items).toHaveLength(1);
    const item = doc.items[photo!.items[0]!];
    expect(item?.type).toBe('photo');
    expect(item?.media?.url).toBeFalsy();
  });

  it('counts an empty photo as outstanding, and a placed one as done', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    const photo = doc.nodes.find((n) => n.type === 'photo')!;
    const id = photo.items[0]!;

    const before = readiness(doc).units.find((u) => u.title === 'Photo placed');
    expect(before?.done).toBe(false);
    expect(before?.anchor).toBe(id);

    doc.items[id]!.media = { url: 'https://files.thingelstad.com/wt400/a.jpg' };
    expect(readiness(doc).units.find((u) => u.title === 'Photo placed')?.done).toBe(true);
  });
});
