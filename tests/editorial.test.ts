/** Editorial anchoring and annotation. No network. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { renderAnnotated } from '../src/shared/render/annotate.ts';
import {
  assembleReview, campaignFacts, candidateCount, pruneStale, type Note, type Review,
} from '../src/server/editorial.ts';

const doc = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;

describe('annotating the edition for review', () => {
  it('marks every rendered item with its id', () => {
    const out = renderAnnotated(doc);
    expect(out).toContain('<!--item:intro-1-->');
    expect(out).toContain('<!--item:journal-concert-->');
    expect(out).toContain('<!--item:echoes-1-->');
  });

  it('omits items that are in no edition', () => {
    expect(renderAnnotated(doc)).not.toContain('<!--item:journal-excluded-->');
  });

  it('reads as the rendered edition, not the item tree', () => {
    const out = renderAnnotated(doc);
    expect(out).toContain('## Notable');
    expect(out).toContain('Fabulous show by The New Standards');
    expect(out).not.toContain('"channels"');
  });
});

describe('note anchoring', () => {
  const note = (over: Partial<Note>): Note => ({
    kind: 'PROOF', item_id: 'journal-concert', text: 'Doubled word.', ...over,
  });

  it('keeps a PROOF note whose substring is still present', () => {
    const kept = pruneStale(doc, [note({ was: 'The New Standards', now: 'the New Standards' })]);
    expect(kept).toHaveLength(1);
  });

  it('drops a PROOF note whose substring is gone — the edit already happened', () => {
    const kept = pruneStale(doc, [note({ was: 'the The New Standards', now: 'The New Standards' })]);
    expect(kept).toHaveLength(0);
  });

  it('keeps a whole-issue note, which anchors to nothing', () => {
    const kept = pruneStale(doc, [note({ kind: 'LENGTH', item_id: null, was: undefined })]);
    expect(kept).toHaveLength(1);
  });

  it('drops a note pointing at an item that no longer exists', () => {
    expect(pruneStale(doc, [note({ item_id: 'deleted-item' })])).toHaveLength(0);
  });

  it('keeps a judgement note without a substring', () => {
    expect(pruneStale(doc, [note({ kind: 'BALANCE', was: undefined })])).toHaveLength(1);
  });
});

describe('candidate counts', () => {
  it('offers three where the choice is a voice', () => {
    expect(candidateCount('membership')).toBe(3);
    expect(candidateCount('echoes')).toBe(3);
    expect(candidateCount('haiku')).toBe(3);
  });

  it('offers two for link commentary, where the want is a nudge', () => {
    expect(candidateCount('pinboard_link')).toBe(2);
  });
});

describe('assembling a review from whichever passes ran', () => {
  const proofNote: Note = {
    kind: 'PROOF', item_id: 'intro-1', text: 'Doubled word.',
    was: 'Welcome back', now: 'Welcome',
  };
  const judgementNote: Note = { kind: 'LENGTH', item_id: null, text: 'Short this week.' };
  const previous: Review = {
    summary: 'Old judgement. Old proof.',
    notes: [
      { ...proofNote, text: 'Old proof note.' },
      { ...judgementNote, text: 'Old judgement note.' },
    ],
    at: '2026-08-27T00:00:00Z',
    passes: { proof: true, judgement: true },
    summaries: { proof: 'Old proof.', judgement: 'Old judgement.' },
  };

  it('a pass that ran replaces its kinds wholesale', () => {
    const r = assembleReview({
      doc,
      proof: { summary: 'One error.', notes: [proofNote] },
      judgement: { summary: 'Reads well.', notes: [judgementNote] },
      previous,
    });
    expect(r.notes.map((n) => n.text)).toEqual(['Doubled word.', 'Short this week.']);
    expect(r.passes).toEqual({ proof: true, judgement: true });
  });

  it('a pass that did not run keeps its previous notes — they are not lost', () => {
    // The failure this pins: a proof-only re-run used to wipe the judgement
    // notes, because the route replaced the whole review.
    const r = assembleReview({
      doc,
      proof: { summary: 'Clean.', notes: [] },
      judgement: null,
      previous,
    });
    expect(r.notes.map((n) => n.text)).toEqual(['Old judgement note.']);
    expect(r.passes).toEqual({ proof: true, judgement: false });
    expect(r.summaries?.judgement).toBe('Old judgement.');
    expect(r.summary).toContain('Old judgement.');
    expect(r.summary).toContain('Clean.');
  });

  it('carried notes are still pruned against the current document', () => {
    const r = assembleReview({
      doc,
      proof: null,
      judgement: { summary: 'Fine.', notes: [judgementNote] },
      previous: {
        ...previous,
        notes: [{ ...proofNote, was: 'text that is no longer anywhere' }],
      },
    });
    // The carried proof note anchors to a substring that is gone, so it drops.
    expect(r.notes.filter((n) => n.kind === 'PROOF')).toHaveLength(0);
  });

  it('with no previous review a skipped pass simply contributes nothing', () => {
    const r = assembleReview({
      doc,
      proof: { summary: 'Clean.', notes: [] },
      judgement: null,
    });
    expect(r.notes).toEqual([]);
    expect(r.summary).toBe('Clean.');
  });
});

describe('membership campaign facts', () => {
  // Shaped like apps/site/_data/support.json in the website repo — the same
  // file /members/ renders from.
  const support = {
    yearly_price: 48,
    current: {
      nonprofit: 'Signal',
      description: 'Signal is the gold standard for private communication.',
      year: 2026,
      year_label: 'Ninth Year',
    },
    past: [
      { nonprofit: 'Electronic Frontier Foundation', year: 2025, amount_raised: 1164.92 },
      { nonprofit: 'Creative Commons', year: 2024, amount_raised: 623.87 },
    ],
  };

  it('carries the program, not a paywall pitch', () => {
    const facts = campaignFacts(support);
    expect(facts).toContain('Signal');
    expect(facts).toContain('Ninth Year');
    expect(facts).toContain('$48/year');
    expect(facts).toContain('one-time gift of any amount');
    expect(facts).toContain('100% of membership fees go to the nonprofit');
    expect(facts).toContain('free for everyone');
    expect(facts).toContain('$1788.79 raised so far');
  });

  it('degrades to the evergreen frame when fields are missing', () => {
    const facts = campaignFacts({});
    expect(facts).toContain('100% of membership fees');
    expect(facts).not.toContain('undefined');
    expect(facts).not.toContain('$NaN');
  });
});
