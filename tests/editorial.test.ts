/** Editorial anchoring and annotation. No network. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { renderAnnotated } from '../src/shared/render/annotate.ts';
import {
  ECHOES_MAX_ANCHORS,
  assembleReview, campaignFacts, candidateCount, echoesAnchors, issueExcerpt,
  pickSeasonalIssue, poolEchoPassages, pruneStale,
  type AnchoredPassages, type Note, type Review,
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
    expect(candidateCount('haiku')).toBe(3);
    // Echoes no longer picks one of N candidates: the wand offers up to five
    // units and Jamie composes the section from any subset (composeEchoes).
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

describe('the Echoes retrieval anchors', () => {
  it('gives promoted posts and Notable links their own queries', () => {
    const anchors = echoesAnchors(doc);
    const labels = anchors.map((a) => a.label);
    expect(labels).toContain('Minnesota Technology Council');
    expect(labels).toContain('Create Your Own Currency With Flipcash');
    expect(anchors.length).toBeLessThanOrEqual(ECHOES_MAX_ANCHORS);
  });

  it('pools the intro, Currently, photo, and Journal into one week anchor', () => {
    const anchors = echoesAnchors(doc);
    const week = anchors.find((a) => a.label === 'The week itself');
    expect(week).toBeDefined();
    // Ordinary Journal moments seed the week anchor, not their own.
    expect(week!.query).toContain('The New Standards');
    expect(anchors.filter((a) => a.query.includes('The New Standards'))).toHaveLength(1);
  });

  it('excludes Echoes itself, Briefly one-liners, and hidden items', () => {
    const d = structuredClone(doc);
    d.items['echoes-1']!.body = 'ECHOES-SENTINEL should not seed its own retrieval';
    d.items['briefly-forge']!.commentary = 'BRIEFLY-SENTINEL too thin to anchor';
    d.items['journal-excluded']!.body = 'HIDDEN-SENTINEL is in no edition';
    const all = echoesAnchors(d).map((a) => a.query).join('\n');
    expect(all).not.toContain('ECHOES-SENTINEL');
    expect(all).not.toContain('BRIEFLY-SENTINEL');
    expect(all).not.toContain('HIDDEN-SENTINEL');
  });
});

describe('pooling the retrieved passages', () => {
  const passage = (issue: number | undefined, date: string, url: string) => ({
    issue_number: issue, publish_date: date, url, text: `about ${url}`,
  });

  it('drops the current issue and its two predecessors', () => {
    const anchored: AnchoredPassages[] = [{
      label: 'A',
      passages: [
        passage(350, '2026-05-23', 'u350'),
        passage(349, '2026-05-16', 'u349'),
        passage(348, '2026-05-09', 'u348'),
        passage(261, '2023-09-16', 'u261'),
      ],
    }];
    const pooled = poolEchoPassages(anchored, 350, '2026-05-23');
    expect(pooled[0]!.passages.map((p) => p.url)).toEqual(['u261']);
  });

  it('ranks deep archive ahead of the last six months', () => {
    const anchored: AnchoredPassages[] = [{
      label: 'A',
      passages: [
        passage(337, '2026-01-18', 'recent'),
        passage(196, '2021-09-18', 'deep'),
        passage(undefined, '', 'undated'),
      ],
    }];
    const urls = poolEchoPassages(anchored, 350, '2026-05-23')[0]!.passages.map((p) => p.url);
    expect(urls.indexOf('deep')).toBeLessThan(urls.indexOf('recent'));
    // Undated passages cannot be aged and rank as deep archive.
    expect(urls.indexOf('undated')).toBeLessThan(urls.indexOf('recent'));
  });

  it('keeps a url once across anchors and caps each anchor', () => {
    const many = Array.from({ length: 9 }, (_, i) => passage(200 + i, '2022-01-01', `u${i}`));
    const anchored: AnchoredPassages[] = [
      { label: 'A', passages: many },
      { label: 'B', passages: [passage(204, '2022-01-01', 'u4')] },
      { label: 'C', passages: [] },
    ];
    const pooled = poolEchoPassages(anchored, 350, '2026-05-23');
    expect(pooled.map((a) => a.label)).toEqual(['A']);
    expect(pooled[0]!.passages).toHaveLength(4);
  });
});

describe('the seasonal lens', () => {
  const rows = [
    { number: 350, publication_date: '2026-05-23', status: 'draft' },
    { number: 297, publication_date: '2025-05-24', status: 'published' },
    { number: 296, publication_date: '2025-05-17', status: 'published' },
    { number: 245, publication_date: '2024-05-25', status: 'published' },
  ];

  it('picks the published issue nearest a year before', () => {
    expect(pickSeasonalIssue(rows, '2026-05-23', 350)?.number).toBe(297);
  });

  it('returns null when nothing lands within the tolerance', () => {
    expect(pickSeasonalIssue(rows.slice(0, 1), '2026-05-23', 350)).toBeNull();
    expect(pickSeasonalIssue([], '2026-05-23', 350)).toBeNull();
  });

  it('excerpts an issue as words, not markup', () => {
    const excerpt = issueExcerpt(doc);
    expect(excerpt).toContain('The New Standards');
    expect(excerpt).not.toContain('<img');
    expect(excerpt.length).toBeLessThanOrEqual(2800);
  });
});
