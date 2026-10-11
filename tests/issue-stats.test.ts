/**
 * The Stats view's "What's in it" and "Across issues" (2026-10-11): counted
 * from the website edition, so a pre-Builder issue and a Builder one are
 * measured alike, and said in words a person reads.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { renderWebsite } from '../src/shared/render/index.ts';
import { acrossIssues, contentStats, outboundKeys, photosIn, wordsIn } from '../src/server/issue-stats.ts';
import { acrossIssues as sayAcross, whatsInIt } from '../src/client/issue-stats.ts';

const fixture = () => JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;

/** Numbers no archive page has, so no test reads the sibling checkout's podcast lengths. */
let next = 990700;
function row(doc: IssueDoc, over: Partial<{ status: string; publication_date: string }> = {}) {
  const number = ++next;
  doc.issue.number = number;
  doc.issue.id = `wt${number}`;
  return {
    id: doc.issue.id,
    number,
    publication_date: over.publication_date ?? doc.issue.publication_date,
    status: over.status ?? 'published',
    updated_at: `v${number}`,
    doc,
  };
}

/** A pre-Builder issue: its published body, imported whole (never as items). */
function legacy(body: string, publication_date: string) {
  const doc = fixture();
  doc.issue.imported = true;
  doc.issue.publication_date = publication_date;
  doc.nodes = [{ id: 'published', kind: 'mdblock', type: 'mdblock', label: 'Published text', movable: false, publishes_heading: false, items: ['published-text'] } as IssueDoc['nodes'][number]];
  doc.items = { 'published-text': { type: 'markdown', authorship: 'Jamie', source: 'direct', channels: { website: true, email: true, audio: true }, body } };
  return row(doc, { publication_date });
}

describe('counting the edition', () => {
  it('counts the words a reader reads: no URLs, no image markup, no tags', () => {
    expect(wordsIn('Hello [the world](https://example.com/a-b-c) — again.')).toBe(4);
    expect(wordsIn('![A long alt text here](https://x.test/p.jpg) Two words')).toBe(2);
    expect(wordsIn('<img src="https://x.test/p.jpg" alt="nope"> <em>One</em>')).toBe(1);
    expect(wordsIn('It’s 2026 · $20/month')).toBe(4);
  });

  it('counts pictures, Markdown and HTML alike', () => {
    expect(photosIn('![a](x.jpg) text <img src="y.jpg"> <IMG src=z>')).toBe(3);
  });

  it('a link is off Jamie\'s sites and is not a picture: WT100\'s photo posts are not links', () => {
    const keys = outboundKeys([
      '[A](https://example.com/a) and [again](https://example.com/a?utm_source=x)',
      '[![](https://cdn.uploads.micro.blog/890/2019/a.jpg)](https://cdn.uploads.micro.blog/890/2019/a.jpg)',
      '[Me](https://www.thingelstad.com/2026/10/01/x.html) [WT](https://weekly.thingelstad.com/archive/352/)',
      '<img src="https://files.thingelstad.com/p.jpg"> [Other](https://www.other.org/b)',
    ].join('\n'));
    expect(keys).toEqual(['example.com/a', 'other.org/b']);
  });
});

describe('what an issue holds', () => {
  it('reads a Builder issue by section and by source, and the sections add up to the edition', () => {
    const r = row(fixture());
    const c = contentStats(r, [r]);
    expect(c.words).toBe(wordsIn(renderWebsite(r.doc)));
    expect(c.words).toBeGreaterThan(0);
    const inSections = c.sections.reduce((n, s) => n + s.words, 0);
    expect(c.words - inSections).toBe(wordsIn(`# ${r.doc.issue.title}`));
    expect(c.sources.map((s) => s.label)).toContain('Pinboard');
    expect(c.links).toBe(outboundKeys(renderWebsite(r.doc)).length);
    // Nothing before it: every link is new.
    expect(c.new_links).toBe(c.links);
    expect(c.domains.length).toBeLessThanOrEqual(5);
    expect(c.reading_minutes).toBe(Math.max(1, Math.round(c.words / 238)));
    expect(c.audio_seconds).toBeNull();
  });

  it('a pre-Builder issue is counted from its body, with no sections to split', () => {
    const r = legacy('Good morning! [A link](https://example.com/one) ![p](https://x.test/p.jpg)', '2020-01-04');
    const c = contentStats(r, [r]);
    // Its title heads the edition in both eras, so it is counted in both.
    expect(c).toMatchObject({ words: 4 + wordsIn(`# ${r.doc.issue.title}`), links: 1, photos: 1, sections: [], sources: [] });
  });
});

describe('across issues', () => {
  it('is oldest first, and a link is new only the first time a published issue carries it', () => {
    const a = legacy('[One](https://example.com/one)', '2020-01-04');
    const draft = legacy('[One](https://example.com/one) [Three](https://example.com/three)', '2020-01-11');
    draft.status = 'draft';
    const b = legacy('[One](https://example.com/one) [Two](https://example.com/two) [Three](https://example.com/three)', '2020-01-18');
    const rows = acrossIssues([b, draft, a], () => undefined);
    expect(rows.map((r) => r.number)).toEqual([a.number, draft.number, b.number]);
    expect(rows.map((r) => [r.links, r.new_links])).toEqual([[1, 1], [2, 1], [3, 2]]);
    // The same rule as What's in it.
    expect(contentStats(b, [a, draft, b]).new_links).toBe(2);
  });

  it('carries how long a Builder issue took, and never one made before', () => {
    const a = legacy('x', '2020-01-04');
    const builder = row(fixture());
    const rows = acrossIssues([a, builder], () => 90 * 60_000);
    expect(rows.find((r) => r.number === a.number)).not.toHaveProperty('built_ms');
    expect(rows.find((r) => r.number === builder.number)!.built_ms).toBe(90 * 60_000);
  });
});

describe('saying it', () => {
  const content = {
    words: 2586, reading_minutes: 11, links: 30, new_links: 26, photos: 1, audio_seconds: 1018,
    sections: [['Notable', 1009], ['Briefly', 509], ['Journal', 452], ['Echoes', 188], ['Promoted', 126], ['Intro', 61], ['Haiku', 0]]
      .map(([label, words]) => ({ label: label as string, words: words as number, items: 1 })),
    sources: [{ label: 'Pinboard', items: 19 }, { label: 'Thingy', items: 5 }],
    domains: [{ domain: 'github.com', links: 2 }, { domain: 'example.com', links: 1 }],
  };

  it('What\'s in it: four stats, the five largest sections and the rest, bars against the largest', () => {
    const it = whatsInIt(353, content);
    expect(it.eyebrow).toBe("WHAT'S IN IT · THE WEEKLY THING 353");
    expect(it.stats).toEqual([
      { value: '2,586', label: 'words, 11 minutes to read' },
      { value: '30', label: 'links, 26 new' },
      { value: '1', label: 'photo' },
      { value: '17 m', label: 'to listen to' },
    ]);
    // One section past the five keeps its own name; an empty one is left out.
    expect(it.words.map((w) => w.label)).toEqual(['Notable', 'Briefly', 'Journal', 'Echoes', 'Promoted', 'Intro']);
    expect(it.domains.map((d) => d.share)).toEqual([1, 0.5]);
  });

  it('says so when there is no podcast yet, and when every link is new', () => {
    const it = whatsInIt(354, { ...content, audio_seconds: null, new_links: 30 });
    expect(it.stats[3]).toEqual({ value: '—', label: 'no podcast yet' });
    expect(it.stats[1]!.label).toBe('links, all new');
  });

  it('Across issues: where this one sits, the years along the strip, and the Builder issues', () => {
    const rows = [100, 200, 300, 400].map((words, i) => ({
      number: 349 + i, publication_date: `${2025 + Math.floor(i / 2)}-0${i + 1}-01`, imported: i < 1,
      words, links: words / 10, new_links: 1, photos: 0, audio_seconds: i === 3 ? null : 600, ...(i ? { built_ms: 60 * 60_000 } : {}),
    }));
    const a = sayAcross(351, rows);
    expect(a.eyebrow).toBe('ACROSS ISSUES · WT349–WT352');
    const words = a.strips.find((s) => s.key === 'words')!;
    expect(words.says).toBe('300 words · more than 67% of issues · the middle issue has 200');
    expect(words.bars.map((b) => b.tone)).toEqual(['before', 'builder', 'this', 'builder']);
    expect(words.here).toEqual({ at: 2.5 / 4, height: 0.75 });
    expect(sayAcross(349, rows).strips[0]!.says).toBe('100 words · fewer than any other issue · the middle issue has 300');
    expect(sayAcross(352, rows).strips[0]!.says).toBe('400 words · more than any other issue · the middle issue has 200');
    expect(a.years).toEqual([{ label: '2025', at: 0 }, { label: '2026', at: 0.5 }]);
    expect(a.builder.map((r) => [r.number, r.current, r.made, r.listen])).toEqual([
      [350, false, '1 h 00 m', '10 m'], [351, true, '1 h 00 m', '10 m'], [352, false, '1 h 00 m', '—'],
    ]);
    // An issue with no podcast has no place on that strip, and says nothing.
    expect(sayAcross(352, rows).strips.find((s) => s.key === 'audio')!.says).toBeNull();
  });
});
