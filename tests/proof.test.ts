/**
 * The proof matcher behind Review → Apply (src/shared/proof.ts): which field
 * holds a note's words, which occurrence `nth` means, the body's prose only
 * (never inside a media tag), and every refusal. Client and server share it,
 * so the Apply button shows exactly where the server would apply.
 */

import { describe, expect, it } from 'vitest';

import type { IssueDoc, Item } from '../src/shared/types.ts';
import {
  asSpot, changeLabel, editAt, findProof, findUndo, proofStillThere, spotHolds, type ProofSpot,
} from '../src/shared/proof.ts';

const item = (over: Partial<Item>): Item => ({
  type: 'pinboard_link', authorship: 'direct', source: 'direct',
  channels: { website: true, email: true, audio: true },
  ...over,
} as Item);

const doc = (items: Record<string, Item>, issue: Partial<IssueDoc['issue']> = {}): IssueDoc => ({
  issue: { id: 'wt999', number: 999, title: 'The Weekly Thing 999', status: 'draft', publication_date: '2026-10-10', window_days: 7, ...issue },
  nodes: [],
  items,
} as unknown as IssueDoc);

const IMG = '<img src="https://cdn.example/teh.jpg" alt="teh lake">';

describe('findProof: the field that holds the words', () => {
  it('finds the words in the one field that holds them', () => {
    const d = doc({ a: item({ title: 'A title', commentary: 'I had never heard of TLA. Now I have.' }) });
    expect(findProof(d, { item_id: 'a', was: 'TLA.', now: 'TLA+.' }))
      .toEqual({ ok: true, spot: { item_id: 'a', field: 'commentary', offset: 21 } });
  });

  it('reads every field anchorText joins: caption, alt, place, Ask, thanks', () => {
    const d = doc({
      p: item({ type: 'photo', media: { caption: 'sun coming down', alt: 'a dok', location: 'Warsaw, MN' } }),
      e: item({ type: 'echo', body: 'Echo.', ask: 'Are you thinking about it?' }),
      m: item({ type: 'membership', body: 'Join.', member_thanks: 'Thank you to our memebers.' }),
    });
    expect(findProof(d, { item_id: 'p', was: 'coming', now: 'going' })).toMatchObject({ ok: true, spot: { field: 'media.caption' } });
    expect(findProof(d, { item_id: 'p', was: 'dok', now: 'dock' })).toMatchObject({ ok: true, spot: { field: 'media.alt' } });
    expect(findProof(d, { item_id: 'p', was: 'MN', now: 'Minnesota' })).toMatchObject({ ok: true, spot: { field: 'media.location' } });
    expect(findProof(d, { item_id: 'e', was: 'thinking about', now: 'thinking on' })).toMatchObject({ ok: true, spot: { field: 'ask' } });
    expect(findProof(d, { item_id: 'm', was: 'memebers', now: 'members' })).toMatchObject({ ok: true, spot: { field: 'member_thanks' } });
  });

  it('refuses words that are gone, plainly', () => {
    const d = doc({ a: item({ commentary: 'Fixed already.' }) });
    const found = findProof(d, { item_id: 'a', was: 'Fixd', now: 'Fixed' });
    expect(found).toMatchObject({ ok: false, why: 'gone' });
    expect(!found.ok && found.say).toContain('"Fixd" is no longer there');
    expect(findProof(d, { item_id: 'nope', was: 'x', now: 'y' })).toMatchObject({ ok: false, why: 'gone' });
  });

  it('refuses words that run across two fields', () => {
    const d = doc({ a: item({ title: 'Ends here', commentary: 'starts here' }) });
    expect(findProof(d, { item_id: 'a', was: 'here\nstarts', now: 'here. Starts' })).toMatchObject({ ok: false, why: 'span' });
  });
});

describe('findProof: more than once', () => {
  const d = doc({ a: item({ title: 'teh title', commentary: 'More teh words, and teh end.' }) });

  it('refuses words that occur more than once when nothing says which', () => {
    const found = findProof(d, { item_id: 'a', was: 'teh', now: 'the' });
    expect(found).toMatchObject({ ok: false, why: 'twice' });
    expect(!found.ok && found.say).toContain('appears 3 times');
  });

  it('nth counts from 1, across the fields in anchorText order', () => {
    expect(findProof(d, { item_id: 'a', was: 'teh', now: 'the', nth: 1 })).toMatchObject({ ok: true, spot: { field: 'title', offset: 0 } });
    expect(findProof(d, { item_id: 'a', was: 'teh', now: 'the', nth: 2 })).toMatchObject({ ok: true, spot: { field: 'commentary', offset: 5 } });
    expect(findProof(d, { item_id: 'a', was: 'teh', now: 'the', nth: 3 })).toMatchObject({ ok: true, spot: { field: 'commentary', offset: 20 } });
  });

  it('refuses an nth past the occurrences there are, and treats 0 as unsaid', () => {
    expect(findProof(d, { item_id: 'a', was: 'teh', now: 'the', nth: 4 })).toMatchObject({ ok: false, why: 'nth' });
    expect(findProof(d, { item_id: 'a', was: 'teh', now: 'the', nth: 0 })).toMatchObject({ ok: false, why: 'twice' });
  });

  it('counts overlapping occurrences, so a doubled word is not guessed at', () => {
    const tripled = doc({ a: item({ commentary: 'the the the' }) });
    expect(findProof(tripled, { item_id: 'a', was: 'the the', now: 'the' })).toMatchObject({ ok: false, why: 'twice' });
  });
});

describe('findProof: the body is prose, its media tags are not', () => {
  it('finds the words in the prose of a body with a trailing image', () => {
    const d = doc({ j: item({ type: 'journal_post', source: 'Micro.blog', body: `By teh lake.\n\n${IMG}` }) });
    expect(findProof(d, { item_id: 'j', was: 'teh', now: 'the' })).toEqual({ ok: true, spot: { item_id: 'j', field: 'body', offset: 3 } });
  });

  it('never matches inside a tag, trailing or inline', () => {
    const trailing = doc({ j: item({ body: `A lake.\n\n${IMG}` }) });
    expect(findProof(trailing, { item_id: 'j', was: 'teh lake', now: 'the lake' })).toMatchObject({ ok: false, why: 'tag' });
    const inline = doc({ j: item({ body: `Before ${IMG} after teh.` }) });
    expect(findProof(inline, { item_id: 'j', was: 'teh', now: 'the' })).toMatchObject({ ok: true, spot: { field: 'body', offset: inline.items.j!.body!.lastIndexOf('teh.') } });
  });

  it('and the edit leaves the tag byte for byte', () => {
    const d = doc({ j: item({ body: `By teh lake.\n\n${IMG}` }) });
    const found = findProof(d, { item_id: 'j', was: 'teh', now: 'the' });
    if (!found.ok) throw new Error(found.say);
    expect(editAt(d, found.spot, 'teh', 'the').item).toEqual({ id: 'j', patch: { body: `By the lake.\n\n${IMG}` } });
  });
});

describe('findProof: a note on the whole issue', () => {
  it('reads the title, then the dek', () => {
    const d = doc({}, { title: 'Teh Weekly Thing', dek: 'A dek wiht a typo.' });
    expect(findProof(d, { item_id: null, was: 'Teh', now: 'The' })).toEqual({ ok: true, spot: { item_id: null, field: 'issue.title', offset: 0 } });
    expect(findProof(d, { item_id: null, was: 'wiht', now: 'with' })).toMatchObject({ ok: true, spot: { field: 'issue.dek' } });
  });

  it('then one item, as the MCP reads such a note — and refuses two', () => {
    const one = doc({ a: item({ commentary: 'A singular typpo.' }), b: item({ commentary: 'Clean.' }) });
    expect(findProof(one, { item_id: null, was: 'typpo', now: 'typo' })).toMatchObject({ ok: true, spot: { item_id: 'a', field: 'commentary' } });
    const two = doc({ a: item({ commentary: 'A typpo.' }), b: item({ commentary: 'Another typpo.' }) });
    expect(findProof(two, { item_id: null, was: 'typpo', now: 'typo' })).toMatchObject({ ok: false, why: 'twice' });
  });
});

describe('a fix that contains its own words', () => {
  const d = doc({ a: item({ commentary: "Jamie's Pinboard bookmarks" }) });
  const note = { item_id: 'a', was: 'Pinboard', now: "Pinboard's" };

  it('applies once, and then is done, not applied again', () => {
    const found = findProof(d, note);
    if (!found.ok) throw new Error(found.say);
    const edit = editAt(d, found.spot, note.was, note.now);
    const after = doc({ a: { ...d.items.a!, ...edit.item!.patch } });
    expect(after.items.a!.commentary).toBe("Jamie's Pinboard's bookmarks");
    expect(findProof(after, note)).toMatchObject({ ok: false, why: 'done' });
    // The note drops off the screen, as a fixed typo does.
    expect(proofStillThere(after, note)).toBe(false);
    expect(proofStillThere(d, note)).toBe(true);
  });
});

describe('undo: the fix taken back', () => {
  const before = doc({ a: item({ commentary: 'I had never heard of TLA. Now I have.' }) });
  const note = { item_id: 'a', was: 'TLA.', now: 'TLA+.' };

  const applied = () => {
    const found = findProof(before, note);
    if (!found.ok) throw new Error(found.say);
    const edit = editAt(before, found.spot, note.was, note.now);
    return { after: doc({ a: { ...before.items.a!, ...edit.item!.patch } }), spot: edit.spot };
  };

  it('finds `now` at the spot the Apply answered with, and puts `was` back', () => {
    const { after, spot } = applied();
    expect(spotHolds(after, spot, 'TLA+.')).toBe(true);
    const back = findUndo(after, note, spot);
    if (!back.ok) throw new Error(back.say);
    expect(editAt(after, back.spot, note.now, note.was).item!.patch).toEqual({ commentary: before.items.a!.commentary });
  });

  it('follows the words when the field moved, if they sit in one place', () => {
    const { spot } = applied();
    const moved = doc({ a: item({ commentary: 'Well. I had never heard of TLA+. Now I have.' }) });
    expect(findUndo(moved, note, spot)).toMatchObject({ ok: true, spot: { offset: moved.items.a!.commentary!.indexOf('TLA+.') } });
  });

  it('refuses when the fix is gone, or was made to another item', () => {
    const { spot } = applied();
    expect(findUndo(before, note, spot)).toMatchObject({ ok: false, why: 'gone' });
    expect(findUndo(before, note, { ...spot, item_id: 'b' })).toMatchObject({ ok: false, why: 'gone' });
  });
});

describe('the edit and the spot as sent back', () => {
  it('a media field is patched with the whole media kept', () => {
    const d = doc({ p: item({ type: 'photo', media: { url: 'https://cdn.example/p.jpg', caption: 'sun coming down' } }) });
    const spot: ProofSpot = { item_id: 'p', field: 'media.caption', offset: 4 };
    expect(editAt(d, spot, 'coming', 'going').item!.patch).toEqual({ media: { url: 'https://cdn.example/p.jpg', caption: 'sun going down' } });
  });

  it('asSpot takes only a real field for the kind of spot', () => {
    expect(asSpot({ item_id: 'a', field: 'commentary', offset: 3 })).toEqual({ item_id: 'a', field: 'commentary', offset: 3 });
    expect(asSpot({ item_id: null, field: 'issue.dek', offset: 0 })).toEqual({ item_id: null, field: 'issue.dek', offset: 0 });
    expect(asSpot({ item_id: null, field: 'commentary', offset: 0 })).toBeNull();
    expect(asSpot({ item_id: 'a', field: 'source_url', offset: 0 })).toBeNull();
    expect(asSpot({ item_id: 'a', field: 'title', offset: -1 })).toBeNull();
    expect(asSpot('nope')).toBeNull();
  });
});

describe('changeLabel: the Apply button names the change', () => {
  it('shows only the words that differ', () => {
    expect(changeLabel('I had never heard of TLA.', 'I had never heard of TLA+.')).toBe('TLA. → TLA+.');
    expect(changeLabel('If your new here', "If you're new here")).toBe("your → you're");
  });

  it('says cut or add for a fix that only removes or only adds', () => {
    expect(changeLabel('Sun workstations were running SunOS', 'Sun workstations running SunOS')).toBe('cut "were"');
    expect(changeLabel('the the', 'the')).toBe('cut "the"');
    expect(changeLabel('in the middle move', 'in the middle to move')).toBe('add "to"');
  });

  it('truncates long text', () => {
    const label = changeLabel('a'.repeat(60), 'b'.repeat(60));
    expect(label).toBe(`${'a'.repeat(23)}… → ${'b'.repeat(23)}…`);
  });
});
