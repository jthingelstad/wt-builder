/** Sections that wait on other sections (src/shared/dependencies.ts, docs/mcp-plan.md Part A). */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { readiness } from '../src/server/issue.ts';
import { DEPENDS_ON, findCycle, waitingSummary } from '../src/shared/dependencies.ts';

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

const PARAGRAPH = 'A paragraph of commentary that clears the bar for a Notable link, written the way Jamie writes them, with a reason to read it.';

/** The fixture with its Notable commentary written and its Intro long enough. */
function inputsDone(): IssueDoc {
  const doc = fixture();
  doc.items['link-flipcash']!.commentary = PARAGRAPH;
  doc.items['link-functions']!.commentary = PARAGRAPH;
  doc.items['intro-1']!.body = [PARAGRAPH, PARAGRAPH, PARAGRAPH].join('\n\n');
  return doc;
}

const unit = (doc: IssueDoc, anchor: string, title?: string) =>
  readiness(doc).units.find((u) => u.anchor === anchor && (!title || u.title === title))!;

describe('the dependency map', () => {
  it('has no cycles', () => {
    expect(findCycle(DEPENDS_ON)).toBeNull();
  });

  it('finds a cycle when there is one', () => {
    expect(findCycle({ a: ['b'], b: ['c'], c: ['a'] })).toEqual(['a', 'b', 'c', 'a']);
  });
});

describe('waiting pills', () => {
  it('the representative issue: Title waits on Notable, Outro on Intro', () => {
    const r = readiness(fixture());
    const title = unit(fixture(), 'issue', 'Title');
    expect(title.state).toBe('waiting');
    expect(title.done).toBe(false);
    expect(title.waiting_on).toEqual([{ section: 'notable', name: 'Notable', done: 0, total: 2 }]);
    expect(unit(fixture(), 'outro-1').state).toBe('waiting');
    expect(waitingSummary(unit(fixture(), 'outro-1').waiting_on!)).toBe('Intro (0 of 1)');
    expect(r.waiting).toBe(2);
  });

  it('a finished pill stays done while its inputs are unfinished', () => {
    // The fixture's haiku is written; its Notable inputs are not.
    expect(unit(fixture(), 'haiku-1').state).toBe('done');
  });

  it('an empty Haiku waits on each unfinished input, and only those', () => {
    const doc = fixture();
    doc.items['haiku-1']!.body = '';
    doc.items['briefly-forge']!.commentary = '';
    const haiku = unit(doc, 'haiku-1');
    expect(haiku.state).toBe('waiting');
    expect(haiku.waiting_on!.map((w) => w.section)).toEqual(['notable', 'briefly']);
    expect(haiku.waiting_on!.find((w) => w.section === 'briefly')).toMatchObject({ done: 2, total: 3 });
  });

  it('with its inputs finished, an empty Haiku is simply not done yet', () => {
    const doc = inputsDone();
    doc.items['haiku-1']!.body = '';
    expect(unit(doc, 'haiku-1').state).toBe('todo');
    expect(unit(doc, 'issue', 'Title').state).not.toBe('waiting');
    expect(unit(doc, 'outro-1').state).not.toBe('waiting');
  });

  it('a failed Pinboard write is not an unfinished input', () => {
    // briefly-shortcuts carries a failed write-back pill in the fixture.
    const doc = inputsDone();
    doc.items['haiku-1']!.body = '';
    expect(readiness(doc).units.some((u) => u.kind === 'sync' && u.anchor === 'briefly-shortcuts')).toBe(true);
    expect(unit(doc, 'haiku-1').waiting_on).toBeUndefined();
  });

  it('a Journal post that only lacks alt text counts as finished input', () => {
    const doc = inputsDone();
    doc.items['haiku-1']!.body = '';
    doc.items['journal-boat']!.body = `${doc.items['journal-boat']!.body}\n\n<img src="https://example.com/a.jpg">`;
    expect(unit(doc, 'journal-boat').state).toBe('partial');
    expect(unit(doc, 'haiku-1').state).toBe('todo');
  });

  it('a section that is not in the issue owes nothing', () => {
    const doc = fixture();
    doc.nodes = doc.nodes.filter((n) => n.type !== 'notable' && n.type !== 'intro');
    expect(unit(doc, 'issue', 'Title').state).not.toBe('waiting');
    expect(unit(doc, 'outro-1').state).not.toBe('waiting');
  });

  it('an older issue’s Featured section is Notable, by its own name', () => {
    const doc = fixture();
    const node = doc.nodes.find((n) => n.type === 'notable')!;
    node.type = 'featured';
    node.label = 'Featured';
    expect(unit(doc, 'issue', 'Title').waiting_on).toEqual([{ section: 'notable', name: 'Featured', done: 0, total: 2 }]);
  });

  it('an empty Echoes section waits on Notable and Journal, not Briefly or Intro', () => {
    const doc = fixture();
    const echoes = doc.nodes.find((n) => n.type === 'echoes')!;
    for (const id of echoes.items) delete doc.items[id];
    echoes.items = [];
    doc.items['briefly-forge']!.commentary = '';
    const pill = unit(doc, echoes.id);
    expect(pill.state).toBe('waiting');
    expect(pill.waiting_on!.map((w) => w.section)).toEqual(['notable']);
  });

  it('Membership waits on nothing', () => {
    const doc = fixture();
    doc.items['membership-1']!.body = '';
    expect(unit(doc, 'membership-1').state).toBe('todo');
  });
});
