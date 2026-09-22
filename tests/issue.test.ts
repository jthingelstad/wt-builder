/** Assembly operations and the document store. */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IssueDoc, Item } from '../src/shared/types.ts';
import * as issues from '../src/server/issue.ts';
import { inWindow, issueWindow, snapToSaturday, windowLabel } from '../src/shared/dates.ts';
import {
  addMarkdownBlock, addSection, createIssue, demote, hideItem, moveLinkToSection, moveNode,
  isFlattened, normalizeSkeleton, promote, readiness, removeSection, setChannel, setIssueNumber, withoutFlattening,
  setPublicationDate, setWindowDays,
  updateItem, followBookmarkTags, pruneGone, pruneOutsideWindow, setItemOrder,
} from '../src/server/issue.ts';
import { falloutOf, itemsInWindow, outOfWindow, planEdition, windowOf } from '../src/shared/render/plan.ts';
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
    doc.items['photo-1']!.channels.audio = false;
    doc.items['photo-1']!.channel_locks = { audio: 'held for the test' };
    const after = setChannel(doc, 'photo-1', 'audio', true);
    expect(after.items['photo-1']!.channels.audio).toBe(false);
  });

  it('still allows the other channels of a locked item to change', () => {
    const doc = fixture();
    doc.items['photo-1']!.channel_locks = { audio: 'held for the test' };
    const after = setChannel(doc, 'photo-1', 'email', false);
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

describe('moving a link between Notable and Briefly', () => {
  it('to Briefly: moves the item, stamps the section, adds _brief, queues a write', () => {
    const doc = moveLinkToSection(fixture(), 'link-flipcash', 'Briefly');
    expect(doc.nodes.find((n) => n.type === 'briefly')!.items).toContain('link-flipcash');
    expect(doc.nodes.find((n) => n.type === 'notable')!.items).not.toContain('link-flipcash');
    const item = doc.items['link-flipcash']!;
    expect(item.section).toBe('Briefly');
    expect(item.tags).toContain('_brief');
    expect(item.sync_state).toBe('syncing');
  });

  it('to Notable: removes _brief, any casing', () => {
    const start = fixture();
    start.items['briefly-forge']!.tags = ['__Brief', 'tools'];
    const doc = moveLinkToSection(start, 'briefly-forge', 'Notable');
    expect(doc.nodes.find((n) => n.type === 'notable')!.items).toContain('briefly-forge');
    const item = doc.items['briefly-forge']!;
    expect(item.section).toBe('Notable');
    expect(item.tags).toEqual(['tools']);
    expect(item.sync_state).toBe('syncing');
  });

  it('a tag-neutral move never queues a write', () => {
    // Already untagged, moving to Notable: placement changes, tags do not.
    const doc = moveLinkToSection(fixture(), 'briefly-forge', 'Notable');
    expect(doc.items['briefly-forge']!.sync_state).toBe('synced');
  });

  it('a gone bookmark moves locally and stays gone', () => {
    const start = fixture();
    start.items['link-flipcash']!.sync_state = 'gone';
    const doc = moveLinkToSection(start, 'link-flipcash', 'Briefly');
    expect(doc.items['link-flipcash']!.tags).toContain('_brief');
    expect(doc.items['link-flipcash']!.sync_state).toBe('gone');
  });

  it('a written link adjusts its tags without pretending to sync', () => {
    const start = fixture();
    const item = start.items['link-flipcash']!;
    item.source = 'direct';
    item.sync_state = 'local';
    const doc = moveLinkToSection(start, 'link-flipcash', 'Briefly');
    expect(doc.items['link-flipcash']!.tags).toContain('_brief');
    expect(doc.items['link-flipcash']!.sync_state).toBe('local');
  });

  it('only links move this way', () => {
    const doc = moveLinkToSection(fixture(), 'journal-concert', 'Briefly');
    expect(doc.nodes.find((n) => n.type === 'briefly')!.items).not.toContain('journal-concert');
    expect(doc.nodes.find((n) => n.type === 'journal')!.items).toContain('journal-concert');
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

  it('words landing in a Thingy item are the review — a pick or an edit, no second gate', () => {
    const before = fixture();
    before.items['membership-1']!.reviewed = false;
    before.items['membership-1']!.status = 'draft';
    const after = updateItem(before, 'membership-1', { body: 'Fresh words.' });
    expect(after.items['membership-1']!.reviewed).toBe(true);
    expect(after.items['membership-1']!.status).toBe('reviewed');
    expect(readiness(after).units.find((u) => u.title === 'Membership')!.state).toBe('done');
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
    const commentary = r.units.filter((u) => u.kind === 'commentary');
    expect(commentary.some((u) => !u.done)).toBe(true);
  });

  it('flags a failed Pinboard write', () => {
    const r = readiness(fixture());
    expect(r.units.some((u) => u.kind === 'sync' && u.title.includes('Pinboard write failed'))).toBe(true);
  });

  it('treats a missing standard section as settled, not outstanding', () => {
    const doc = removeSection(fixture(), 'photo');
    const r = readiness(doc);
    const photo = r.units.find((u) => u.title.startsWith('Photo'));
    expect(photo?.done).toBe(true);
    expect(photo?.title).toContain('not in this issue');
  });
});

describe('readiness reads in issue order and skips held-out items', () => {
  it('lists units section by section, the way the page reads', () => {
    const r = readiness(fixture());
    const anchors = r.units.map((u) => u.anchor);
    const at = (id: string) => anchors.indexOf(id);
    expect(at('intro-1')).toBeLessThan(at('link-flipcash'));
    expect(at('link-flipcash')).toBeLessThan(at('briefly-forge'));
    expect(at('briefly-forge')).toBeLessThan(at('membership-1'));
    expect(at('membership-1')).toBeLessThan(at('outro-1'));
  });

  it('a held-out link owes no commentary', () => {
    const doc = fixture();
    const notable = doc.nodes.find((n) => n.type === 'notable')!;
    const before = readiness(doc).units.filter((u) => u.anchor === 'link-functions');
    expect(before).toHaveLength(1);
    const held = issues.removeItem(doc, notable.id, 'link-functions');
    expect(readiness(held).units.filter((u) => u.anchor === 'link-functions')).toHaveLength(0);
  });
});

describe('every thing on the page has a chip', () => {
  it('names chips for the thing, and gives Journal and promoted posts theirs', () => {
    const units = readiness(fixture()).units;
    const titles = units.map((u) => u.title);
    expect(titles).toContain('Create Your Own Currency With Flipcash');
    expect(titles.some((t) => t.startsWith('Commentary for'))).toBe(false);
    const promoted = units.find((u) => u.anchor === 'journal-long')!;
    expect(promoted.state).toBe('done');
    expect(promoted.context).toBe('Promoted post.');
    expect(units.find((u) => u.anchor === 'journal-boat')!.context).toBe('Journal.');
    // One chip per Thingy item: drafted is halfway, reviewed is done.
    expect(units.filter((u) => u.title === 'Membership')).toHaveLength(1);
  });
});

describe('a Journal post owes alt text for its pictures', () => {
  it('is done with alt on every picture, started without, and the chip says how many', () => {
    const doc = fixture();
    const done = readiness(doc).units.find((u) => u.anchor === 'journal-concert')!;
    expect(done.state).toBe('done');
    doc.items['journal-concert']!.body += '\n<img src="https://www.thingelstad.com/uploads/2026/encore.jpg" alt="">';
    const started = readiness(doc).units.find((u) => u.anchor === 'journal-concert')!;
    expect(started.state).toBe('partial');
    expect(started.context).toBe('1 picture without alt text — the wand writes it from the pictures.');
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
    expect(script.trimEnd().endsWith('Thanks for listening.')).toBe(true);
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

  it('keeps every version it replaces, newest first, and skips identical saves', () => {
    const doc = fixture();
    store.saveIssue(doc);
    expect(store.listRevisions(doc.issue.id)).toHaveLength(0); // a first save replaces nothing
    store.saveIssue(doc);
    expect(store.listRevisions(doc.issue.id)).toHaveLength(0); // byte-identical: nothing to keep
    const v2 = updateItem(doc, 'intro-1', { body: 'Second words' });
    store.saveIssue(v2);
    const v3 = updateItem(v2, 'intro-1', { body: 'Third words' });
    store.saveIssue(v3);
    const revs = store.listRevisions(doc.issue.id);
    expect(revs.map((r) => r.doc.items['intro-1']!.body)).toEqual(['Second words', doc.items['intro-1']!.body]);
    expect(store.getIssue(doc.issue.id)!.doc.items['intro-1']!.body).toBe('Third words');
  });

  it('keeps the database and live SQLite sidecars owner-only', () => {
    const previousUmask = process.umask(0o022);
    try {
      store.closeDb();
      for (const suffix of ['', '-shm', '-wal']) {
        try { rmSync(`${dbPath}${suffix}`); } catch { /* not there */ }
      }
      store.openDb(dbPath);
      store.saveIssue(fixture());

      for (const suffix of ['', '-shm', '-wal']) {
        expect(statSync(`${dbPath}${suffix}`).mode & 0o777).toBe(0o600);
      }
    } finally {
      process.umask(previousUmask);
    }
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
    // Nine years shipped before WT Builder and are not imported (docs/decisions.md), so the
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

  // The editor's instruments read through the same filter as the editions.
  // A window widened to three weeks and narrowed back to one leaves every
  // swept item in the document; the counts and checks must not still see them.
  it('counts only what the window admits', () => {
    const doc = docWith('2026-09-01T09:00:00-05:00', '2026-08-20T09:00:00-05:00');
    expect(itemsInWindow(doc).map(([id]) => id)).toContain('i-0');
    expect(itemsInWindow(doc).map(([id]) => id)).not.toContain('i-1');
    expect(itemsInWindow(setWindowDays(doc, 21)).map(([id]) => id)).toContain('i-1');
  });

  it('applies a fetched sweep to whatever document it is given — a fresh read, not the stale copy', () => {
    // The route fetches against one read and applies to another. An edit made
    // in between lives only in the second; it must survive the apply.
    const before = docWith('2026-09-01T09:00:00-05:00');
    const fetched: import('../src/server/issue.ts').SweepFetch = {
      window: windowOf(before), links: [], posts: [],
      bookmarks: new Map(), microblog: null, captureTimes: new Map(),
    };
    const edited = updateItem(before, 'i-0', { commentary: 'Typed while the scan ran' });
    const { doc } = issues.applySweep(edited, fetched);
    expect(doc.items['i-0']!.commentary).toBe('Typed while the scan ran');
  });

  it('a re-scan drops what the window no longer admits', () => {
    const doc = docWith('2026-09-01T09:00:00-05:00', '2026-08-20T09:00:00-05:00');
    const log = pruneOutsideWindow(doc);
    expect(Object.keys(doc.items)).toContain('i-0');
    expect(Object.keys(doc.items)).not.toContain('i-1');
    expect(doc.nodes.find((n) => n.id === 'n-notable')!.items).toEqual(['i-0']);
    expect(log).toEqual([{ kind: 'dropped', summary: 'A link — outside the window' }]);
  });

  it('keeps a fallen-out item whose edit has not reached the source, and says so', () => {
    const doc = docWith('2026-08-20T09:00:00-05:00');
    doc.items['i-0']!.sync_state = 'failed';
    const log = pruneOutsideWindow(doc);
    expect(doc.items['i-0']).toBeDefined();
    expect(log[0]?.kind).toBe('kept');
    expect(log[0]?.summary).toContain('has not reached Pinboard');
  });

  it('takes a promoted post\'s empty section with it, and clears the held-out list', () => {
    const doc = docWith('2026-08-20T09:00:00-05:00');
    doc.orphans = ['i-0'];
    doc.nodes.find((n) => n.id === 'n-notable')!.items = [];
    doc.nodes.push({
      id: 'promoted-i-0', kind: 'promoted_item', type: 'journal_post', label: 'Old post',
      movable: true, publishes_heading: true, items: ['i-0'],
    } as unknown as IssueDoc['nodes'][number]);
    doc.issue.output_order = [...doc.nodes.map((n) => n.id)];
    pruneOutsideWindow(doc);
    expect(doc.orphans).toEqual([]);
    expect(doc.nodes.some((n) => n.id === 'promoted-i-0')).toBe(false);
    expect(doc.issue.output_order).not.toContain('promoted-i-0');
  });

  it('a link deleted at Pinboard is dropped from the issue at the next re-scan', () => {
    const doc = docWith('2026-09-01T09:00:00-05:00', '2026-09-02T09:00:00-05:00');
    doc.items['i-1']!.sync_state = 'gone';
    doc.items['i-1']!.sync_error = 'deleted at Pinboard; your copy is kept';
    const log = pruneGone(doc);
    expect(Object.keys(doc.items)).toEqual(expect.not.arrayContaining(['i-1']));
    expect(doc.nodes.find((n) => n.id === 'n-notable')!.items).toEqual(['i-0']);
    expect(log).toEqual([{ kind: 'dropped', summary: 'A link — deleted at Pinboard' }]);
  });

  it("never drops Jamie's own writing or an unjudgeable item", () => {
    const doc = docWith('2026-09-01T09:00:00-05:00');
    delete doc.items['i-0']!.published_at;
    const before = Object.keys(doc.items).length;
    expect(pruneOutsideWindow(doc)).toEqual([]);
    expect(Object.keys(doc.items).length).toBe(before);
  });

  it('does not ask for commentary on a link the window dropped', () => {
    const doc = docWith('2026-09-01T09:00:00-05:00', '2026-08-20T09:00:00-05:00');
    const commentary = readiness(doc).units.filter((u) => u.kind === 'commentary');
    expect(commentary.map((u) => u.anchor)).toEqual(['i-0']);
    const wide = readiness(setWindowDays(doc, 21)).units.filter((u) => u.kind === 'commentary');
    expect(wide.map((u) => u.anchor).sort()).toEqual(['i-0', 'i-1']);
  });
});

describe('placement follows the bookmark', () => {
  const inSection = (doc: IssueDoc, id: string) =>
    doc.nodes.find((n) => n.items.includes(id))?.label;

  it('_brief going on at Pinboard moves a Notable link to Briefly', () => {
    const doc = fixture();
    const item = doc.items['link-flipcash']!;
    expect(inSection(doc, 'link-flipcash')).toBe('Notable');
    item.tags = ['_brief'];
    item.source_snapshot = { ...item.source_snapshot, tags: ['_brief'], commentary: item.commentary };
    const log = followBookmarkTags(doc);
    expect(inSection(doc, 'link-flipcash')).toBe('Briefly');
    expect(doc.items['link-flipcash']!.section).toBe('Briefly');
    expect(log[0]?.summary).toContain('Notable → Briefly');
    expect(doc.items['link-flipcash']!.sync_state).not.toBe('syncing');
  });

  it('a placed link stays put when its description changes — no tag, no move, no question', () => {
    const doc = fixture();
    const item = doc.items['briefly-forge']!;
    expect(inSection(doc, 'briefly-forge')).toBe('Briefly');
    // Unmarked, described at Pinboard; the reconcile adopted it. The old rule
    // said Notable and re-filed it; Jamie put it in Briefly, so it stays.
    item.tags = ['tools'];
    item.commentary = 'Worth a read.';
    item.source_snapshot = { tags: ['tools'], commentary: 'Worth a read.' };
    expect(followBookmarkTags(doc)).toEqual([]);
    expect(inSection(doc, 'briefly-forge')).toBe('Briefly');
    // And the reverse: an unmarked Notable link losing its description stays Notable.
    const flip = doc.items['link-flipcash']!;
    flip.tags = []; flip.commentary = '';
    flip.source_snapshot = { tags: [], commentary: '' };
    expect(followBookmarkTags(doc)).toEqual([]);
    expect(inSection(doc, 'link-flipcash')).toBe('Notable');
  });

  it('_brief coming off at Pinboard does not move a Briefly link — only a move here does', () => {
    const doc = fixture();
    const item = doc.items['briefly-forge']!;
    item.tags = ['tools'];
    item.source_snapshot = { ...item.source_snapshot, tags: ['tools'], commentary: item.commentary };
    expect(followBookmarkTags(doc)).toEqual([]);
    expect(inSection(doc, 'briefly-forge')).toBe('Briefly');
    const up = moveLinkToSection(doc, 'briefly-forge', 'Notable');
    expect(inSection(up, 'briefly-forge')).toBe('Notable');
  });

  it('a first description written here does not ask and does not move', () => {
    const doc = fixture();
    const item = doc.items['briefly-forge']!;
    item.tags = []; item.commentary = '';
    item.source_snapshot = { tags: [], commentary: '' };
    const written = updateItem(doc, 'briefly-forge', { commentary: 'Worth your time.' });
    expect(inSection(written, 'briefly-forge')).toBe('Briefly');
    written.items['briefly-forge']!.source_snapshot = { tags: [], commentary: 'Worth your time.' };
    expect(followBookmarkTags(written)).toEqual([]);
    expect(inSection(written, 'briefly-forge')).toBe('Briefly');
    expect(written.items['briefly-forge']!.tags ?? []).not.toContain('_brief');
  });

  it('holding out a Pinboard link puts _exclude on the bookmark and queues the write', () => {
    const doc = fixture();
    const notable = doc.nodes.find((n) => n.type === 'notable')!;
    const next = issues.removeItem(doc, notable.id, 'link-flipcash');
    const item = next.items['link-flipcash']!;
    expect(next.orphans).toContain('link-flipcash');
    expect(item.tags).toContain('_exclude');
    expect(item.excluded).toBe(true);
    expect(item.sync_state).toBe('syncing');
  });

  it('_exclude arriving from Pinboard holds a placed link out; coming off puts it back', () => {
    const doc = fixture();
    const item = doc.items['link-flipcash']!;
    item.tags = ['_exclude'];
    item.source_snapshot = { tags: ['_exclude'], commentary: item.commentary };
    let log = followBookmarkTags(doc);
    expect(doc.orphans).toContain('link-flipcash');
    expect(inSection(doc, 'link-flipcash')).toBeUndefined();
    expect(log[0]?.kind).toBe('held-out');

    item.tags = [];
    item.source_snapshot = { tags: [], commentary: item.commentary };
    log = followBookmarkTags(doc);
    expect(doc.orphans).not.toContain('link-flipcash');
    expect(inSection(doc, 'link-flipcash')).toBe('Notable');
    expect(item.excluded).toBeUndefined();
    expect(log[0]?.kind).toBe('put-back');
  });

  it('does not put back a link that was held out before exclusion was recorded on the bookmark', () => {
    // Held out under the old rule: in orphans, no _exclude, no `excluded` mark.
    const doc = fixture();
    const item = doc.items['link-flipcash']!;
    doc.nodes.find((n) => n.type === 'notable')!.items = ['link-functions'];
    doc.orphans = ['link-flipcash'];
    item.source_snapshot = { tags: item.tags, commentary: item.commentary };
    expect(followBookmarkTags(doc)).toEqual([]);
    expect(doc.orphans).toContain('link-flipcash');
  });

  it('waits while a description typed here is still writing back', () => {
    const doc = fixture();
    const item = doc.items['link-flipcash']!;
    item.tags = [];
    item.commentary = 'Typed in the builder';
    item.source_snapshot = { tags: [], commentary: '' };
    expect(followBookmarkTags(doc)).toEqual([]);
    expect(inSection(doc, 'link-flipcash')).toBe('Notable');
  });

  it('leaves a link Jamie moved here, whose tag edit has not written back yet', () => {
    const start = fixture();
    start.items['briefly-forge']!.tags = ['_brief'];
    start.items['briefly-forge']!.source_snapshot = { tags: ['_brief'] };
    const doc = moveLinkToSection(start, 'briefly-forge', 'Notable');
    // tags lost _brief locally; the snapshot still carries it — a pending edit.
    expect(doc.items['briefly-forge']!.sync_state).toBe('syncing');
    expect(followBookmarkTags(doc)).toEqual([]);
    expect(inSection(doc, 'briefly-forge')).toBe('Notable');
  });

  it('does not touch a link already where its tags say, or one with no sweep record', () => {
    const doc = fixture();
    doc.items['briefly-tokenspeed']!.tags = ['_brief'];
    doc.items['briefly-tokenspeed']!.source_snapshot = { tags: ['_brief'] };
    // briefly-forge and friends carry no snapshot: hand-placed, not swept.
    const before = JSON.stringify(doc.nodes);
    expect(followBookmarkTags(doc)).toEqual([]);
    expect(JSON.stringify(doc.nodes)).toBe(before);
  });
});

describe('applying a proposed order', () => {
  it('puts the named items in that order and keeps the unnamed ones after, in place', () => {
    const doc = fixture();
    const briefly = doc.nodes.find((n) => n.type === 'briefly')!;
    expect(briefly.items).toEqual(['briefly-forge', 'briefly-tokenspeed', 'briefly-shortcuts']);
    const next = setItemOrder(doc, briefly.id, ['briefly-shortcuts', 'briefly-forge']);
    expect(next.nodes.find((n) => n.id === briefly.id)!.items).toEqual(['briefly-shortcuts', 'briefly-forge', 'briefly-tokenspeed']);
  });

  it('ignores ids that are not in the section, and repeats', () => {
    const doc = fixture();
    const briefly = doc.nodes.find((n) => n.type === 'briefly')!;
    const next = setItemOrder(doc, briefly.id, ['link-flipcash', 'briefly-tokenspeed', 'briefly-tokenspeed', 'briefly-forge', 'briefly-shortcuts']);
    const items = next.nodes.find((n) => n.id === briefly.id)!.items;
    expect(items).toEqual(['briefly-tokenspeed', 'briefly-forge', 'briefly-shortcuts']);
    expect(next.nodes.find((n) => n.type === 'notable')!.items).toContain('link-flipcash');
  });
});

describe('item removal', () => {
  it('deletes a locally-authored item outright — a drafted Currently entry', () => {
    const doc = fixture();
    const currently = doc.nodes.find((n) => n.type === 'currently')!;
    const localId = currently.items.find((id) => doc.items[id]?.authorship !== 'syndicated')!;

    const next = issues.removeItem(doc, currently.id, localId);
    expect(next.items[localId]).toBeUndefined();
    expect(next.nodes.find((n) => n.id === currently.id)!.items).not.toContain(localId);
    expect(next.orphans ?? []).not.toContain(localId);
  });

  it('holds a syndicated item out so the sweep cannot bring it straight back', () => {
    const doc = fixture();
    const briefly = doc.nodes.find((n) => n.type === 'briefly')!;
    const linkId = briefly.items.find((id) => doc.items[id]?.authorship === 'syndicated')!;

    const next = issues.removeItem(doc, briefly.id, linkId);
    expect(next.nodes.find((n) => n.id === briefly.id)!.items).not.toContain(linkId);
    expect(next.items[linkId]).toBeTruthy(); // held out, not deleted
    expect(next.orphans).toContain(linkId);
    expect(next.items[linkId]!.section).toBeTruthy(); // Put back knows where
  });

  it('is a no-op for an unknown node or an item not in that node', () => {
    const doc = fixture();
    expect(issues.removeItem(doc, 'no-such-node', 'intro-1')).toEqual(doc);
    expect(issues.removeItem(doc, 'intro', 'no-such-item')).toEqual(doc);
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

  it('counts an empty photo as outstanding, a bare one as in progress, a captioned one as done', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    const photo = doc.nodes.find((n) => n.type === 'photo')!;
    const id = photo.items[0]!;
    const unit = () => readiness(doc).units.find((u) => u.title === 'Photo')!;

    expect(unit().state).toBe('todo');
    expect(unit().anchor).toBe(id);

    doc.items[id]!.media = { url: 'https://files.thingelstad.com/wt400/a.jpg' };
    expect(unit().state).toBe('partial');
    doc.items[id]!.media = { url: 'https://files.thingelstad.com/wt400/a.jpg', alt: 'A lake', caption: 'Morning.' };
    expect(unit().state).toBe('done');
  });
});

describe('readiness knows started from finished', () => {
  it('a one-sentence intro is in progress, a few paragraphs are done', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    const id = doc.nodes.find((n) => n.type === 'intro')!.items[0]!;
    const intro = () => readiness(doc).units.find((u) => u.title === 'Intro')!;
    expect(intro().state).toBe('todo');
    doc.items[id]!.body = 'Good morning! Hoping you had a wonderful summer.';
    expect(intro().state).toBe('partial');
    expect(intro().done).toBe(false);
    doc.items[id]!.body = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    expect(intro().state).toBe('done');
  });

  it('a Notable link wants a paragraph; a Briefly link wants a line', () => {
    const doc = fixture();
    doc.items['link-flipcash']!.commentary = 'Neat.';
    doc.items['briefly-forge']!.commentary = 'Neat.';
    const r = readiness(doc);
    expect(r.units.find((u) => u.anchor === 'link-flipcash')!.state).toBe('partial');
    expect(r.units.find((u) => u.anchor === 'briefly-forge')!.state).toBe('done');
    expect(r.partial).toBeGreaterThan(0);
  });

  it('gives each Currently line its own tick, and the issue its title', () => {
    const doc = fixture();
    const units = readiness(doc).units;
    const titles = units.map((u) => u.title);
    expect(units.filter((u) => u.context?.startsWith('Currently'))).toHaveLength(2);
    expect(titles).toContain('Building');
    expect(titles).not.toContain('Currently filled in');
    expect(titles[0]).toBe('Title');
    // The fixture's title is the seed, "The Weekly Thing 350": not yet titled.
    expect(readiness(doc).units[0]!.state).not.toBe('done');
  });
});

describe('an edit that only removes line breaks is not an edit', () => {
  const post = 'We did a session.\n\n- Pauses fall right.\n- Lists are spoken.\n\nA viable way.';
  const flat = 'We did a session.  - Pauses fall right. - Lists are spoken.  A viable way.';

  it('recognises the flatten signature and nothing else', () => {
    expect(isFlattened(post, flat)).toBe(true);
    expect(isFlattened(post, post)).toBe(false);
    expect(isFlattened(post, 'We did a session.\n\n- Pauses fall right.')).toBe(false); // words changed
    expect(isFlattened('One line.', 'One line. Two.')).toBe(false); // nothing to flatten
    expect(isFlattened(post, post.replace('\n\nA viable way.', ' A viable way.'))).toBe(false); // still has lines
  });

  it('drops the flattening fields from a patch and keeps the rest', () => {
    const item = fixture().items['journal-boat']!;
    item.body = post;
    const { patch, dropped } = withoutFlattening(item, { body: flat, title: 'Kept' });
    expect(dropped).toEqual(['body']);
    expect(patch).toEqual({ title: 'Kept' });
    expect(withoutFlattening(item, { body: 'Rewritten.' })).toEqual({ patch: { body: 'Rewritten.' }, dropped: [] });
  });
});

describe('bringing an older document up to the skeleton', () => {
  it('seeds the photo item an older issue never got', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    // An issue as it existed before Photo was seeded.
    const photo = doc.nodes.find((n) => n.type === 'photo')!;
    for (const id of photo.items) delete doc.items[id];
    photo.items = [];

    const repaired = normalizeSkeleton(doc);
    expect(repaired).not.toBeNull();
    const back = repaired!.nodes.find((n) => n.type === 'photo')!;
    expect(back.items).toHaveLength(1);
    expect(repaired!.items[back.items[0]!]?.type).toBe('photo');
  });

  it('lifts the audio lock an older Photo carried, so the caption speaks', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    const id = doc.nodes.find((n) => n.type === 'photo')!.items[0]!;
    doc.items[id]!.channels.audio = false;
    doc.items[id]!.channel_locks = { audio: 'Photos are omitted from audio rather than narrated.' };
    const repaired = normalizeSkeleton(doc)!;
    expect(repaired.items[id]!.channels.audio).toBe(true);
    expect(repaired.items[id]!.channel_locks).toBeUndefined();
  });

  it('leaves a current document alone, so reads do not rewrite it', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    expect(normalizeSkeleton(doc)).toBeNull();
  });

  it('does not resurrect a Photo section that was deliberately removed', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-09-05' });
    const photo = doc.nodes.find((n) => n.type === 'photo')!;
    const removed = removeSection(doc, photo.id);
    expect(normalizeSkeleton(removed)).toBeNull();
  });
});

describe('Echoes are items, like Currently', () => {
  const wt = (n: number) => ({ kind: 'issue' as const, issue: n, url: `https://weekly.thingelstad.com/archive/${n}/` });

  it('a new issue has an empty Echoes section, pinned last, with no seeded body', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-10-03' });
    const echoes = doc.nodes.find((n) => n.type === 'echoes')!;
    expect(echoes.items).toEqual([]);
    expect(echoes.fixed_position).toBe('last');
    expect(Object.values(doc.items).some((i) => i.type === 'echoes')).toBe(false);
  });

  it('appends the picked echoes as echo items — thread, citations, question — reviewed', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-10-03' });
    const { doc: next, ids } = issues.addEchoes(doc, 'echoes', [
      { text: 'The boat went in, as every May since [WT221](https://weekly.thingelstad.com/archive/221/).', archive_references: [wt(221)], ask: 'When does the boat go in?' },
      { text: '   ', archive_references: [], ask: 'never becomes an item' },
      { text: 'The rails ran through [WT261](https://weekly.thingelstad.com/archive/261/) too.', archive_references: [wt(261)] },
    ]);
    expect(ids).toHaveLength(2);
    expect(next.nodes.find((n) => n.type === 'echoes')!.items).toEqual(ids);
    const first = next.items[ids[0]!]!;
    expect(first.type).toBe('echo');
    expect(first.authorship).toBe('Thingy');
    expect(first.body).toContain('The boat went in');
    expect(first.ask).toBe('When does the boat go in?');
    expect(first.archive_references).toEqual([wt(221)]);
    expect(first.reviewed).toBe(true);
    expect(next.items[ids[1]!]!.ask).toBeUndefined();
  });

  it('a second run appends after the first — the wand adds, it never replaces', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-10-03' });
    const one = issues.addEchoes(doc, 'echoes', [{ text: 'first', archive_references: [] }]);
    const two = issues.addEchoes(one.doc, 'echoes', [{ text: 'second', archive_references: [] }]);
    const items = two.doc.nodes.find((n) => n.type === 'echoes')!.items;
    expect(items).toEqual([...one.ids, ...two.ids]);
    expect(new Set(items).size).toBe(2);
    expect(two.doc.items[one.ids[0]!]!.body).toBe('first');
  });

  it('an echo can be reordered and removed on its own', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-10-03' });
    const { doc: next, ids } = issues.addEchoes(doc, 'echoes', [
      { text: 'a', archive_references: [] }, { text: 'b', archive_references: [] },
    ]);
    const moved = issues.moveItem(next, 'echoes', ids[1]!, -1);
    expect(moved.nodes.find((n) => n.type === 'echoes')!.items).toEqual([ids[1], ids[0]]);
    const removed = issues.removeItem(moved, 'echoes', ids[0]!);
    expect(removed.items[ids[0]!]).toBeUndefined();
    expect(removed.nodes.find((n) => n.type === 'echoes')!.items).toEqual([ids[1]]);
  });

  it('readiness: one chip per echo, named for its thread; the empty section owes its wand', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-10-03' });
    const empty = readiness(doc).units.find((u) => u.anchor === 'echoes')!;
    expect(empty.state).toBe('todo');
    expect(empty.kind).toBe('thingy');
    const { doc: next, ids } = issues.addEchoes(doc, 'echoes', [
      { text: 'The Kubb tournament reached its 8th annual running this week, after [WT262](https://weekly.thingelstad.com/archive/262/).', archive_references: [wt(262)] },
      { text: 'Car data has a long run-up.', archive_references: [] },
    ]);
    const units = readiness(next).units.filter((u) => u.kind === 'thingy' && u.anchor.startsWith('echo-'));
    expect(units.map((u) => u.anchor)).toEqual(ids);
    expect(units[0]!.title.startsWith('The Kubb tournament reached')).toBe(true);
    expect(units[0]!.title).not.toContain('](');
    expect(units.every((u) => u.done)).toBe(true);
    expect(readiness(next).units.some((u) => u.anchor === 'echoes')).toBe(false);
  });

  it('a draft seeded before the change loses its empty single-body seed on read; words are kept', () => {
    const doc = createIssue({ number: 400, publication_date: '2026-10-03' });
    const seeded: Item = { type: 'echoes', authorship: 'Thingy', source: 'Thingy', channels: { website: true, email: true, audio: true }, body: '', status: 'draft' };
    doc.items['echoes-1'] = seeded;
    doc.nodes.find((n) => n.type === 'echoes')!.items = ['echoes-1'];
    const repaired = normalizeSkeleton(doc)!;
    expect(repaired).not.toBeNull();
    expect(repaired.items['echoes-1']).toBeUndefined();
    expect(repaired.nodes.find((n) => n.type === 'echoes')!.items).toEqual([]);

    doc.items['echoes-1'] = { ...seeded, body: 'Picked words stay.' };
    expect(normalizeSkeleton(doc)).toBeNull();

    // A published issue is never rewritten, empty seed or not.
    doc.items['echoes-1'] = seeded;
    doc.issue.status = 'published';
    expect(normalizeSkeleton(doc)).toBeNull();
  });

  it('the single-body shape still counts as one Echoes chip', () => {
    const doc = fixture();
    const echoes = doc.nodes.find((n) => n.type === 'echoes')!;
    for (const id of echoes.items) delete doc.items[id];
    echoes.items = ['echoes-1'];
    doc.items['echoes-1'] = { type: 'echoes', authorship: 'Thingy', source: 'Thingy', channels: { website: true, email: true, audio: true }, body: 'Composed before echoes were items.' };
    const units = readiness(doc).units.filter((u) => u.anchor === 'echoes-1');
    expect(units).toHaveLength(1);
    expect(units[0]!.title).toBe('Echoes');
    expect(units[0]!.done).toBe(true);
  });
});

describe('add affordances', () => {
  it('adds a Currently entry to the section', () => {
    const doc = issues.createIssue({ number: 991, publication_date: '2026-09-05' });
    const next = issues.addItem(doc, 'currently', 'currently');
    const node = next.nodes.find((n) => n.id === 'currently')!;
    expect(node.items.length).toBe(2);
    const added = next.items[node.items[1]!]!;
    expect(added.type).toBe('currently');
    expect(added.label).toBe('Also');
  });

  it('a written link is authored here: direct source, no write-back', () => {
    const doc = issues.createIssue({ number: 992, publication_date: '2026-09-05' });
    const next = issues.addItem(doc, 'notable', 'pinboard_link');
    const node = next.nodes.find((n) => n.id === 'notable')!;
    const added = next.items[node.items[0]!]!;
    expect(added.source).toBe('direct');
    expect(added.authorship).toBe('Jamie');
    expect(added.sync_state).toBe('local');
  });

  it('a section inserts at its named position', () => {
    const doc = issues.createIssue({ number: 993, publication_date: '2026-09-05' });
    const next = issues.addSection(doc, { type: 'ad_hoc', label: 'Aside', before: 'journal' });
    const order = next.issue.output_order!;
    const aside = next.nodes.find((n) => n.type === 'ad_hoc')!;
    expect(order.indexOf(aside.id)).toBe(order.indexOf('journal') - 1);
  });

  it("the outline's drag-reorder actually persists", () => {
    // addNode with an existing id + before is the reorder path; it silently
    // did nothing until now.
    const doc = issues.createIssue({ number: 994, publication_date: '2026-09-05' });
    const next = issues.addSection(doc, { type: 'journal', label: 'Journal', id: 'journal', before: 'intro' });
    const order = next.issue.output_order!;
    expect(order.indexOf('journal')).toBe(order.indexOf('intro') - 1);
  });
});

describe('the issue is dated its Saturday', () => {
  // "No matter when I send it, the send date is that Saturday." The date is
  // the issue's identity, not the send timestamp.
  it('a Sunday send dates back to the Saturday just past, never a week forward', () => {
    const doc = createIssue({ number: 995, publication_date: '2026-08-29' });
    const next = setPublicationDate(doc, '2026-08-30'); // Sunday
    expect(next.issue.publication_date).toBe('2026-08-29');
  });

  it('a slipped Monday belongs to the same Saturday', () => {
    const doc = createIssue({ number: 997, publication_date: '2026-08-31' }); // Monday
    expect(doc.issue.publication_date).toBe('2026-08-29');
  });

  it('so the window can never move with a late send', () => {
    const sat = createIssue({ number: 998, publication_date: '2026-08-29' });
    const sun = createIssue({ number: 999, publication_date: '2026-08-30' });
    expect(issueWindow(sun.issue.publication_date, 7).to)
      .toBe(issueWindow(sat.issue.publication_date, 7).to);
  });

  it('a midweek date is a typo and snaps forward to the Saturday target', () => {
    const doc = createIssue({ number: 996, publication_date: '2026-09-02' }); // Wednesday
    expect(doc.issue.publication_date).toBe('2026-09-05');
  });
});
