/**
 * Row hints (src/shared/hints.ts): what a row says about itself that its
 * pill does not. The cases are WT352's, and the finished text is WT350's and
 * WT351's, on which nothing may fire but the title trim.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc, Item } from '../src/shared/types.ts';
import { rowHints, titleHint, unfinishedHint, unfinishedTail } from '../src/shared/hints.ts';
import { updateItem } from '../src/server/issue.ts';

const fixture = () =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8')) as IssueDoc;

const link = (fields: Partial<Item>): Item =>
  ({ type: 'pinboard_link', authorship: 'syndicated', source: 'Pinboard', channels: { website: true, email: true, audio: true }, ...fields }) as Item;

describe('looks unfinished', () => {
  it('finished lines say nothing: a full stop, a question, an ellipsis, an emoji, a closing quote', () => {
    for (const text of [
      'I hope you like it!',
      'More to come on that…',
      'Have a great weekend!',
      'gents have been all over the Internet! 😬',
      'to just use `AGENTS.md` everywhere now.',
      'I said "it works."',
      'would make a great **Product Engineer**.',
      'the [lightning ideas](https://example.com/lightning-ideas.html) I shared in 2023!',
      'Is this the end?',
      'Lines and a list:\n\n- one\n- two',
      'See https://example.com/page',
    ]) expect(unfinishedTail(text), text).toBeUndefined();
  });

  it('a line that stops on a word, a comma, or a dash is unfinished (WT352 dots)', () => {
    expect(unfinishedTail('In short, dots feels more')).toBe('In short, dots feels more');
    expect(unfinishedTail('This is a long thought, and then')).toBe('a long thought, and then');
    expect(unfinishedTail('One thing,')).toBe('One thing,');
    expect(unfinishedTail('It runs on [Otto](https://ottoai.example.com)')).toBe('It runs on Otto');
    expect(unfinishedTail('First paragraph.\n\nSecond one trails off —')).toBe('Second one trails off —');
  });

  it("only Jamie's own words: commentary, intro, outro, Currently; never Thingy's or a haiku", () => {
    expect(unfinishedHint(link({ commentary: 'Dots feels more' }))).toBe('Looks unfinished: it ends “…Dots feels more” with no full stop.');
    expect(unfinishedHint({ type: 'intro', authorship: 'Jamie', body: 'Hello there' } as Item)).toMatch(/Looks unfinished/);
    expect(unfinishedHint({ type: 'haiku', authorship: 'Jamie', body: 'Old pond\nfrog jumps in\nsplash' } as Item)).toBeUndefined();
    expect(unfinishedHint({ type: 'membership', authorship: 'Thingy', body: 'Join us' } as Item)).toBeUndefined();
    // Empty is the pill's to say, not a hint's.
    expect(unfinishedHint(link({ commentary: '' }))).toBeUndefined();
  });

  it('a Currently line of a few words is a note to self (WT352 Planning)', () => {
    const line = (body: string) => ({ type: 'currently', authorship: 'Jamie', label: 'Planning', body }) as Item;
    expect(unfinishedHint(line('Apple Legacy Contacts'))).toBe('A short Currently line, 3 words: “Apple Legacy Contacts”.');
    expect(unfinishedHint(line('I set up Apple Legacy Contacts for the family this week, finally.'))).toBeUndefined();
  });
});

describe('page title, not trimmed', () => {
  it('names the site suffix a fetched title still carries', () => {
    expect(titleHint(link({ title: 'Your car is selling your data | The Verge' }))).toContain('“| The Verge”');
    expect(titleHint(link({ title: 'iOS and iPadOS 27: The MacStories Review - MacStories' }))).toContain('“- MacStories”');
    expect(titleHint(link({ title: 'Announcing the Presenters of Minnedemo42 – Minnestar' }))).toContain('“– Minnestar”');
  });

  it('a title without a suffix, or a byline in front, says nothing', () => {
    for (const title of [
      'Unread 5.0',
      'What is LinkedIn',
      'Thorsten Ball - What I believe about the future of software development',
      'GPT-5 is here',
    ]) expect(titleHint(link({ title })), title).toBeUndefined();
  });

  it('a long title says so', () => {
    expect(titleHint(link({ title: 'x'.repeat(95) }))).toMatch(/runs 95 characters/);
  });

  it("once Jamie has edited the title it is his: the hint goes, and the edit is what records it", () => {
    const doc = fixture();
    doc.items['link-flipcash']!.title = 'Create Your Own Currency | Flipcash';
    expect(titleHint(doc.items['link-flipcash']!)).toBeDefined();
    const edited = updateItem(doc, 'link-flipcash', { title: 'Create Your Own Currency | Flipcash Blog' });
    expect(edited.items['link-flipcash']!.title_edited).toBe(true);
    expect(titleHint(edited.items['link-flipcash']!)).toBeUndefined();
    // An edit that leaves the title alone records nothing.
    expect(updateItem(doc, 'link-flipcash', { commentary: 'New words.' }).items['link-flipcash']!.title_edited).toBeUndefined();
  });

  it('a link Jamie wrote here has no page title to trim', () => {
    expect(titleHint(link({ authorship: 'Jamie', title: 'My own | thing' }))).toBeUndefined();
  });
});

describe('rowHints', () => {
  const gift = (exp: number) => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `https://www.theverge.com/story?view_token=${b64({ alg: 'HS256' })}.${b64({ exp })}.sig`;
  };

  it('a gift link marks the row that prints it; one Jamie kept does not (B1)', () => {
    const doc = fixture();
    const url = gift(Math.floor(Date.UTC(2026, 8, 29, 12) / 1000));
    doc.items['link-flipcash']!.source_url = url;
    const hints = rowHints(doc, Date.UTC(2026, 9, 4));
    expect(hints.get('link-flipcash')).toContainEqual({ kind: 'link', text: expect.stringMatching(/expired Sep 29/) });
    doc.link_check = { at: '2026-10-04T00:00:00Z', results: {}, accepted: [url] } as IssueDoc['link_check'];
    expect(rowHints(doc, Date.UTC(2026, 9, 4)).get('link-flipcash')?.some((h) => h.kind === 'link')).toBeFalsy();
  });

  it('a dead link marks its row; a fine one does not', () => {
    const doc = fixture();
    const url = doc.items['briefly-forge']!.source_url!;
    doc.link_check = { at: '2026-10-04T00:00:00Z', results: { [url]: { verdict: 'dead', status: 404 } }, accepted: [] } as unknown as IssueDoc['link_check'];
    expect(rowHints(doc).get('briefly-forge')).toEqual([{ kind: 'link', text: `A dead link (404): ${url}` }]);
    expect(rowHints(doc).get('briefly-shortcuts')).toBeUndefined();
  });
});
