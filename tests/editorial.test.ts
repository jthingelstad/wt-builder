/** Editorial anchoring and annotation. No network. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { renderAnnotated } from '../src/shared/render/annotate.ts';
import {
  ECHOES_MAX_ANCHORS, draft, echoGrounding, echoesRetrieval, normalizeUrl, passageContext, placeAlts,
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
    expect(out).toContain('<!--item:echo-building-->');
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

  it('keeps a PROOF note on a photo\'s caption, alt and place, and on an echo\'s Ask question', () => {
    const kept = pruneStale(doc, [
      note({ item_id: 'photo-1', was: 'sun coming down', now: 'sun going down' }),
      note({ item_id: 'photo-1', was: 'silhouetted tree line', now: 'silhouetted treeline' }),
      note({ item_id: 'photo-1', was: 'Cannon Lake, Warsaw', now: 'Cannon Lake in Warsaw' }),
      note({ item_id: 'echo-building', was: 'thinking about building', now: 'thinking on building' }),
    ]);
    expect(kept).toHaveLength(4);
  });

  it('keeps a PROOF note on the member thank-you', () => {
    const d = structuredClone(doc);
    d.items['membership-1']!.member_thanks = 'Thank you for giving thorugh the newsletter.';
    expect(pruneStale(d, [note({ item_id: 'membership-1', was: 'thorugh', now: 'through' })])).toHaveLength(1);
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

  it('leaves out a Journal post the window dropped', () => {
    const d = structuredClone(doc);
    const journal = d.nodes.find((n) => n.type === 'journal')!;
    const id = journal.items[0]!;
    d.items[id]!.published_at = '2026-04-01T09:00:00-05:00';
    const opening = String(d.items[id]!.body).trim().slice(0, 20);
    const before = echoesAnchors(doc).find((a) => a.label === 'The week itself')!.query;
    const after = echoesAnchors(d).find((a) => a.label === 'The week itself')!.query;
    expect(before).toContain(opening);
    expect(after).not.toContain(opening);
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
    d.items['echo-building']!.body = 'ECHOES-SENTINEL should not seed its own retrieval';
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

  it('ranks deep archive ahead of the last six months, and undated passages last', () => {
    const anchored: AnchoredPassages[] = [{
      label: 'A',
      passages: [
        passage(undefined, '', 'undated'),
        passage(337, '2026-01-18', 'recent'),
        passage(196, '2021-09-18', 'deep'),
      ],
    }];
    const urls = poolEchoPassages(anchored, 350, '2026-05-23')[0]!.passages.map((p) => p.url);
    // An undated passage cannot be aged; it is never an echo's first choice.
    expect(urls).toEqual(['deep', 'recent', 'undated']);
  });

  it('drops a blog post or episode this issue and the two before it already carry', () => {
    const blog = (date: string, url: string, also?: number[]) => ({
      source_kind: 'blog', publish_date: date, url, text: `about ${url}`, also_in_issues: also,
    });
    const anchored: AnchoredPassages[] = [{
      label: 'A',
      passages: [
        // This week's post: the Journal republishes it.
        blog('2026-05-21', 'this-week'),
        { source_kind: 'podcast', episode_number: 9, publish_date: '2026-05-10', url: 'episode', text: 'said' },
        // Carried by last week's issue, whatever its date.
        blog('2026-04-02', 'in-349', [349]),
        blog('2026-03-01', 'older', [340]),
        blog('2019-06-01', 'deep'),
      ],
    }];
    const urls = poolEchoPassages(anchored, 350, '2026-05-23')[0]!.passages.map((p) => p.url);
    expect(urls).toEqual(['deep', 'older']);
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

describe('asking the Librarian for Echoes', () => {
  it('asks the whole archive, without the site pages or the last three issues', () => {
    expect(echoesRetrieval(352)).toEqual({
      scope: 'all',
      filters: { excludeSourceKinds: ['site_page', 'faq'], excludeIssues: [352, 351, 350] },
    });
  });

  it('heads each passage with the label to cite it by', () => {
    const context = passageContext([{ label: 'The boat', passages: [
      { issue_number: 221, source_kind: 'weekly_thing', label: 'WT221', subject: 'WT221 — Boat Day', publish_date: '2023-05-20T12:00:00Z',
        section: 'Journal', url: 'https://weekly.thingelstad.com/archive/221/', text: 'The boat went in.' },
      { source_kind: 'blog', label: 'Owning the Rails', subject: 'Owning the Rails', publish_date: '2024-05-01',
        also_in_issues: [260], url: 'https://www.thingelstad.com/2024/05/01/owning-the-rails.html', text: 'A post of his.' },
      { source_kind: 'podcast', label: 'AT3', subject: 'On boats', episode_number: 3, publish_date: '2025-10-19',
        url: 'https://another.thingelstad.com/2025/10/19/on-boats.html', text: 'Said aloud.' },
    ] }]);
    expect(context).toContain('[WT221 · WT221 — Boat Day · 2023-05-20 · Journal] https://weekly.thingelstad.com/archive/221/');
    expect(context).toContain('[Owning the Rails · blog post · 2024-05-01 · also in WT260] https://www.thingelstad.com/2024/05/01/owning-the-rails.html');
    expect(context).toContain('[AT3 · Another Thing episode · On boats · 2025-10-19] https://another.thingelstad.com/2025/10/19/on-boats.html');
  });
});

describe('echo citation grounding', () => {
  // A hand-built retrieval: two issues and a blog post, as the Librarian
  // returns them (the URL shapes vary; the check must not care).
  const anchored: AnchoredPassages[] = [
    { label: 'Boat Day', passages: [
      { issue_number: 221, url: 'https://weekly.thingelstad.com/archive/221/#journal', text: 'The boat went in.' },
      { issue_number: 180, url: 'http://www.weekly.thingelstad.com/archive/180', text: 'Lake season.' },
    ] },
    { label: 'Owning the rails', passages: [
      { source_kind: 'blog', url: 'https://www.thingelstad.com/2024/05/01/owning-the-rails/', also_in_issues: [260], text: 'A post of his.' },
      { source_kind: 'podcast', label: 'AT3', episode_number: 3, url: 'https://another.thingelstad.com/2025/10/19/on-boats.html', text: 'Said aloud.' },
    ] },
  ];
  const seasonal = { number: 297 };
  const echo = (text: string, refs: { issue?: number; url: string; kind?: 'issue' | 'blog' }[]) => ({
    text, archive_references: refs.map((r) => ({ kind: r.kind ?? 'issue' as const, ...r })), ask: 'Why the boat?',
  });

  it('normalizes scheme, www, trailing slash, and fragment', () => {
    expect(normalizeUrl('https://www.Weekly.Thingelstad.com/archive/221/#notable'))
      .toBe(normalizeUrl('http://weekly.thingelstad.com/archive/221'));
  });

  it('passes an echo whose every citation traces to a passage or the seasonal issue', () => {
    const e = echo(
      'The boat went in, as in [WT221](https://weekly.thingelstad.com/archive/221/) and a year ago in [WT297](https://weekly.thingelstad.com/archive/297/).',
      [{ issue: 221, url: 'https://weekly.thingelstad.com/archive/221' }, { issue: 297, url: 'https://weekly.thingelstad.com/archive/297/' }],
    );
    expect(echoGrounding(e, anchored, seasonal).flags).toEqual([]);
  });

  it('flags an issue number the archive never returned, in the text and in the references', () => {
    const e = echo('Recalls [WT199](https://weekly.thingelstad.com/archive/199/).', [{ issue: 199, url: 'https://weekly.thingelstad.com/archive/199/' }]);
    const { flags } = echoGrounding(e, anchored, seasonal);
    expect(flags).toEqual(['WT199 is not among the passages the archive returned']);
  });

  it('flags a WTn label that links to a different issue', () => {
    const e = echo('Recalls [WT221](https://weekly.thingelstad.com/archive/180/).', [{ issue: 221, url: 'https://weekly.thingelstad.com/archive/180/' }]);
    const { flags } = echoGrounding(e, anchored, seasonal);
    expect(flags).toContain('WT221 links to /archive/180/');
    expect(flags).toContain('the reference to WT221 links to /archive/180/');
  });

  it('flags a link in the text that is not in the echo\'s own references', () => {
    const e = echo('Recalls [WT221](https://weekly.thingelstad.com/archive/221/) and [WT180](https://weekly.thingelstad.com/archive/180/).', [{ issue: 221, url: 'https://weekly.thingelstad.com/archive/221/' }]);
    expect(echoGrounding(e, anchored, seasonal).flags)
      .toEqual(["weekly.thingelstad.com/archive/180 is linked in the text but not in this echo's references"]);
  });

  it('checks a blog citation by its URL, and a bare WTn mention by its number', () => {
    const ok = echo('He wrote [Owning the Rails](https://thingelstad.com/2024/05/01/owning-the-rails).', [{ kind: 'blog', url: 'https://thingelstad.com/2024/05/01/owning-the-rails/' }]);
    expect(echoGrounding(ok, anchored, seasonal).flags).toEqual([]);
    const invented = echo('He wrote [a post](https://thingelstad.com/2019/01/01/invented/), as WT12 did.', [{ kind: 'blog', url: 'https://thingelstad.com/2019/01/01/invented/' }]);
    const flags = echoGrounding(invented, anchored, seasonal).flags;
    expect(flags).toContain('thingelstad.com/2019/01/01/invented is not among the passages the archive returned');
    expect(flags).toContain('WT12 is not among the passages the archive returned');
  });

  it('a blog post\'s issue counts as retrieved: cite the issue that carried it', () => {
    const e = echo('He wrote it up, and [WT260](https://weekly.thingelstad.com/archive/260/) carried it.', [{ issue: 260, url: 'https://weekly.thingelstad.com/archive/260/' }]);
    expect(echoGrounding(e, anchored, seasonal).flags).toEqual([]);
  });

  it('checks an episode by its number and its page', () => {
    const podcast = (text: string, url: string) => ({
      text, archive_references: [{ kind: 'podcast' as const, title: 'AT3: On boats', url }], ask: 'What about boats?',
    });
    const url = 'https://another.thingelstad.com/2025/10/19/on-boats.html';
    expect(echoGrounding(podcast(`He said it on [AT3](${url}).`, url), anchored, seasonal).flags).toEqual([]);
    const wrongPage = 'https://another.thingelstad.com/2025/10/05/how-do-you-start-a.html';
    expect(echoGrounding(podcast(`He said it on [AT3](${wrongPage}).`, wrongPage), anchored, seasonal).flags)
      .toContain('AT3 links to another.thingelstad.com/2025/10/05/how-do-you-start-a.html, not that episode');
    expect(echoGrounding(podcast(`He said it on AT7 and [AT3](${url}).`, url), anchored, seasonal).flags)
      .toEqual(['AT7 is not among the passages the archive returned']);
  });

  it('without the seasonal issue, citing it is flagged', () => {
    const e = echo('A year ago, [WT297](https://weekly.thingelstad.com/archive/297/).', [{ issue: 297, url: 'https://weekly.thingelstad.com/archive/297/' }]);
    expect(echoGrounding(e, anchored, undefined).flags).toEqual(['WT297 is not among the passages the archive returned']);
  });
});

describe('placing Journal alts on their pictures', () => {
  const images = [{ src: 'a.jpg' }, { src: 'b.jpg' }, { src: 'c.jpg' }];

  it('places each alt on the picture it names, whatever order they come in', () => {
    expect(placeAlts(images, [
      { picture: 3, alt: 'A dock.' }, { picture: 1, alt: 'A boat.' }, { picture: 2, alt: ' A lake. ' },
    ])).toEqual([
      { src: 'a.jpg', alt: 'A boat.' }, { src: 'b.jpg', alt: 'A lake.' }, { src: 'c.jpg', alt: 'A dock.' },
    ]);
  });

  it('rejects an answer that skips a picture, rather than shifting the rest', () => {
    expect(() => placeAlts(images, [{ picture: 1, alt: 'A boat.' }, { picture: 3, alt: 'A dock.' }]))
      .toThrow('the draft named 2 of 3 pictures, not each once — try again');
  });

  it('rejects a picture named twice, or one that is not there', () => {
    expect(() => placeAlts(images, [{ picture: 1, alt: 'x' }, { picture: 1, alt: 'y' }, { picture: 2, alt: 'z' }])).toThrow('not each once');
    expect(() => placeAlts(images, [{ picture: 1, alt: 'x' }, { picture: 2, alt: 'y' }, { picture: 4, alt: 'z' }])).toThrow('not each once');
    expect(() => placeAlts(images, [{ picture: 1, alt: 'x' }, { picture: 2, alt: 'y' }, { picture: 3, alt: 'z' }, { picture: 3, alt: 'w' }])).toThrow('not each once');
  });

  it('an empty alt offers nothing for that picture', () => {
    expect(placeAlts(images.slice(0, 2), [{ picture: 1, alt: '' }, { picture: 2, alt: 'A lake.' }]))
      .toEqual([{ src: 'b.jpg', alt: 'A lake.' }]);
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

  it('leaves out an item held out of every edition, as the editions do', () => {
    const excerpt = issueExcerpt(doc, 100_000);
    expect(excerpt).not.toContain('A post Jamie has intentionally removed from this issue.');
  });

  it('leaves Thingy\'s own items out of the excerpt', () => {
    const excerpt = issueExcerpt(doc, 100_000);
    expect(excerpt).not.toContain('Supporting Members make the Weekly Thing possible');
    expect(excerpt).not.toContain('recalls earlier issues about owning the tools');
    expect(excerpt).toContain('The New Standards');
  });

  it('excerpts an issue as words, not markup', () => {
    const excerpt = issueExcerpt(doc);
    expect(excerpt).toContain('The New Standards');
    expect(excerpt).not.toContain('<img');
    expect(excerpt.length).toBeLessThanOrEqual(2800);
  });
});

describe('the Echoes wands', () => {
  it('the section wand drafts for the Echoes node and refuses any other', async () => {
    await expect(draft({ doc, nodeId: 'currently' })).rejects.toThrow('no Echoes section');
    await expect(draft({ doc, nodeId: 'nope' })).rejects.toThrow('no Echoes section');
  });

  it('an item wand needs an item', async () => {
    await expect(draft({ doc, itemId: 'nope' })).rejects.toThrow('no item nope');
  });
});

describe('the wand is shown only where a draft exists', () => {
  it('every draftable item has a prompt, and every prompted item is draftable', async () => {
    const { DRAFT_PROMPTS } = await import('../src/server/editorial.ts');
    const { DRAFTABLE } = await import('../src/shared/types.ts');
    // photo and journal_post draft alts by vision; an echo redrafts through
    // the 'echoes' prompt. Everything else needs a prompt of its own.
    const special = new Set(['photo', 'journal_post', 'echo']);
    for (const type of DRAFTABLE) {
      if (!special.has(type)) expect(DRAFT_PROMPTS[type], type).toBeTruthy();
    }
    expect(DRAFT_PROMPTS.echoes).toBeTruthy();
    for (const type of Object.keys(DRAFT_PROMPTS)) {
      if (type !== 'echoes') expect(DRAFTABLE.has(type as never), type).toBe(true);
    }
    expect(DRAFTABLE.has('intro')).toBe(false);
  });
});
