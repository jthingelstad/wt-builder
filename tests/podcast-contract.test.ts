/**
 * The published contract with another.thingelstad.com, held the strongest
 * way available: the publish surface's own frontmatter parser and permalink
 * derivation, vendored in tests/podcast-vendored-parser.ts, parsing what we
 * emit. If Another's parser and ours ever disagree, this file says so before
 * a subscriber's client does. tests/podcast-parser-drift.test.ts holds the
 * copy against the live source when the sibling checkout is on disk.
 */

import { describe, expect, it } from 'vitest';

import type { EpisodeDoc } from '../src/shared/podcast/types.ts';
import {
  audioRepoPath, audioSecondsValue, centralIso, episodeMarkdown, episodeStem, guidFor, mentionedSection,
  packageTextFiles, permalink, slugFromTitle, transcriptText, validate,
} from '../src/shared/podcast/contract.ts';
import { computePermalink, parseFrontmatter } from './podcast-vendored-parser.ts';

/** The tagged mp3 as the send measured it: what went into the audio bucket. */
const AUDIO = { bytes: 13237856, seconds: 635.352 };

function episode(over: Partial<EpisodeDoc['episode']> = {}): EpisodeDoc {
  return {
    schema_version: 1,
    episode: {
      id: 'at2',
      number: 2,
      title: 'What does an archive owe its author?',
      slug: 'what-does-an-archive-owe',
      summary: 'Nine years of newsletters, one corpus, and the question of memory.',
      date: '2026-09-14T19:30:00-05:00',
      status: 'draft',
      ...over,
    },
    segments: [
      {
        id: 's1', title: 'Open',
        cards: [{ id: 'c1', blocks: [{ t: 'line', text: 'The chalkboard sign again' }, { t: 'line', text: 'Why archives' }] }],
        links: [{ text: 'Weekly Thing', url: 'https://weekly.thingelstad.com' }],
      },
      {
        id: 's2', title: 'The Librarian',
        cards: [{ id: 'c2', blocks: [{ t: 'line', text: 'What retrieval changes' }] }],
        links: [
          { text: 'Thingy', url: 'https://thingy.thingelstad.com' },
          { text: 'Weekly Thing', url: 'https://weekly.thingelstad.com' }, // duplicate on purpose
        ],
      },
    ],
    notes: [],
    show_notes: 'An episode about what nine years of writing turns into.',
    transcript: 'Hello and welcome.\n\nThis is the episode.',
    audio: { source_filename: 'ep2.wav', duration_seconds: 900, bytes: 9_000_000, mastered_at: '2026-09-14T20:00:00-05:00' },
    sends: {},
  };
}

describe('the emitted episode survives the real parser', () => {
  it('round-trips every frontmatter field', () => {
    const { data } = parseFrontmatter(episodeMarkdown(episode(), AUDIO));
    expect(data.title).toBe('What does an archive owe its author?');
    expect(data.number).toBe(2);
    expect(data.slug).toBe('what-does-an-archive-owe');
    expect(data.date).toBe('2026-09-14T19:30:00-05:00');
    expect(data.audio).toBe('/uploads/2026/another-thing-2.mp3');
    expect(data.audioBytes).toBe(13237856);
    // A decimal stays a string through the parser; the site reads it with Number().
    expect(data.audioSeconds).toBe('635.352');
    expect(data.transcript).toBe('002-what-does-an-archive-owe.txt');
    expect(data.summary).toBe('Nine years of newsletters, one corpus, and the question of memory.');
    expect(data.guidIsPermalink).toBe(true);
    expect(data.explicit).toBeUndefined();
  });

  it('carries explicit only when it is set', () => {
    expect(parseFrontmatter(episodeMarkdown(episode({ explicit: true }), AUDIO)).data.explicit).toBe(true);
  });

  it("agrees with the parser's permalink and GUID derivation, UTC and all", () => {
    const doc = episode();
    const { data } = parseFrontmatter(episodeMarkdown(doc, AUDIO));
    const theirs = computePermalink(new Date(String(data.date)), String(data.slug));
    expect(permalink(doc.episode.date!, doc.episode.slug)).toBe(theirs);
    expect(data.guid).toBe(`https://another.thingelstad.com${theirs}`);
  });

  it('a 7 PM Central date rolls the GUID to the next UTC day, by design', () => {
    expect(permalink('2026-09-14T19:30:00-05:00', 'slug')).toBe('/2026/09/15/slug.html');
    expect(guidFor('2026-09-14T19:30:00-05:00', 'slug')).toBe('https://another.thingelstad.com/2026/09/15/slug.html');
  });

  it('the body is show notes plus the deduped link list, never the outline', () => {
    const { body } = parseFrontmatter(episodeMarkdown(episode(), AUDIO));
    expect(body).toContain('nine years of writing');
    expect(body).toContain('## Mentioned in this episode');
    expect(body.match(/weekly\.thingelstad\.com/g)).toHaveLength(1);
    expect(body).not.toContain('chalkboard');
  });

  it('a title the parser could misread survives it', () => {
    for (const title of ['# Not a comment', 'Colons: a subtitle', '"Quoted" at the start', 'Ends in a quote"', ' padded ', '"Whole"', "'Single'", ' He said "hi" ', `"Both" 'kinds'`]) {
      expect(parseFrontmatter(episodeMarkdown(episode({ title }), AUDIO)).data.title, title).toBe(title);
      expect(parseFrontmatter(episodeMarkdown(episode({ summary: title }), AUDIO)).data.summary, title).toBe(title);
    }
  });

  it('carries the audio facts after audio:, in the order the site documents, and nothing the site derives', () => {
    const md = episodeMarkdown(episode(), AUDIO);
    const keys = md.split('\n---')[0]!.split('\n').slice(1).map((l) => l.split(':')[0]);
    expect(keys).toEqual(['title', 'number', 'slug', 'date', 'audio', 'audioBytes', 'audioSeconds', 'transcript', 'summary', 'guid', 'guidIsPermalink']);
    for (const forbidden of ['duration:', 'mime', 'length:']) expect(md.toLowerCase()).not.toContain(forbidden);
    expect(md).not.toMatch(/^permalink:/m);
  });

  it('writes the measured seconds to the millisecond, and a whole number as the site reads it', () => {
    expect(parseFrontmatter(episodeMarkdown(episode(), { bytes: 1, seconds: 600.12345 })).data.audioSeconds).toBe('600.123');
    expect(Number(parseFrontmatter(episodeMarkdown(episode(), { bytes: 1, seconds: 600 })).data.audioSeconds)).toBe(600);
    expect(audioSecondsValue(635.3524)).toBe('635.352');
  });

  it('refuses audio facts that are not measurements', () => {
    for (const bad of [{ bytes: 0, seconds: 600 }, { bytes: 1.5, seconds: 600 }, { bytes: 10, seconds: 0 }, { bytes: 10, seconds: Number.NaN }]) {
      expect(() => episodeMarkdown(episode(), bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('packages the page and the transcript, and no transcript file without one', () => {
    expect(packageTextFiles(episode(), AUDIO).map((f) => f.path)).toEqual([
      'content/episodes/002-what-does-an-archive-owe.md',
      'content/episodes/002-what-does-an-archive-owe.txt',
    ]);
    const bare = episode();
    bare.transcript = '';
    expect(packageTextFiles(bare, AUDIO).map((f) => f.path)).toEqual(['content/episodes/002-what-does-an-archive-owe.md']);
    expect(parseFrontmatter(episodeMarkdown(bare, AUDIO)).data.transcript).toBeUndefined();
  });
});

describe('paths, names and dates', () => {
  it('files carry the zero-padded number; the slug never does', () => {
    expect(episodeStem(2, 'a-slug')).toBe('002-a-slug');
    expect(audioRepoPath(2, '2026-09-14T19:30:00-05:00')).toBe('uploads/2026/another-thing-2.mp3');
  });

  it('the audio year is the UTC year: a New Year\'s Eve evening files under the next', () => {
    expect(audioRepoPath(9, '2026-12-31T19:30:00-06:00')).toBe('uploads/2027/another-thing-9.mp3');
  });

  it('slugs from titles are parser-safe and bounded', () => {
    expect(slugFromTitle('What does an archive owe its author?')).toBe('what-does-an-archive-owe-its');
    expect(slugFromTitle('Hello!!! World')).toBe('hello-world');
  });

  it('the transcript ships as plain text with a trailing newline', () => {
    expect(transcriptText(episode())).toBe('Hello and welcome.\n\nThis is the episode.\n');
  });

  it('stamps a date in Central with its offset, daylight and standard', () => {
    expect(centralIso(Date.parse('2025-10-05T23:48:44Z'))).toBe('2025-10-05T18:48:44-05:00');
    expect(centralIso(Date.parse('2026-01-15T01:00:00Z'))).toBe('2026-01-14T19:00:00-06:00');
  });
});

describe('validation blocks what the parser would misread', () => {
  const blocking = (doc: EpisodeDoc) => validate(doc).filter((p) => p.severity === 'blocks').map((p) => p.text);

  it('a clean episode packages cleanly, with no warnings either', () => {
    expect(validate(episode())).toEqual([]);
  });

  it('a numeric or yes/no title or summary blocks: the parser coerces it, quoted or not', () => {
    expect(blocking(episode({ title: '2026' }))).toHaveLength(1);
    expect(blocking(episode({ summary: 'true' }))).toHaveLength(1);
  });

  it('a newline in a value blocks: frontmatter is line-based', () => {
    expect(blocking(episode({ title: 'Two\nlines' })).length).toBeGreaterThan(0);
  });

  it('a date without an offset blocks: the GUID hangs on its UTC day', () => {
    expect(blocking(episode({ date: '2026-09-14' })).length).toBeGreaterThan(0);
  });

  it('a slug outside the safe alphabet, or led by a number, blocks', () => {
    expect(blocking(episode({ slug: 'Has Spaces' })).length).toBeGreaterThan(0);
    expect(blocking(episode({ slug: '002-numbered' })).length).toBeGreaterThan(0);
  });

  it('an unmastered episode blocks', () => {
    const doc = episode();
    delete doc.audio;
    expect(blocking(doc).some((t) => t.includes('mastered'))).toBe(true);
  });

  it('a missing transcript, summary or show notes only warns', () => {
    const doc = episode({ summary: '' });
    doc.transcript = '';
    doc.show_notes = '';
    expect(blocking(doc)).toEqual([]);
    expect(validate(doc).filter((p) => p.severity === 'warns')).toHaveLength(3);
  });

  it('an episode with no links still packages: the section is just absent', () => {
    const doc = episode();
    doc.segments.forEach((s) => (s.links = []));
    expect(blocking(doc)).toEqual([]);
    expect(mentionedSection(doc.segments)).toBe('');
  });
});
