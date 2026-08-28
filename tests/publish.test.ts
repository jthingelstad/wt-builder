/**
 * The website handoff, held to the contract read off Studio and a real
 * published archive page. These fields are indexed by the site's templates.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import {
  archivePage, coverImage, extractLinks, issueEntry, siteInputs, subjectFor,
} from '../src/server/publish.ts';
import {
  chunkScript, id3Tags, FINAL_CHANNELS, FINAL_SAMPLE_RATE,
  LOUDNORM_I, LOUDNORM_TP, MAX_CHARS,
} from '../src/server/integrations/audio.ts';
import { bannerUrl, coverSource, SQUARE_SIZE } from '../src/server/integrations/cover.ts';
import { blobSha } from '../src/server/integrations/github.ts';

const base = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;
const doc = (over: Partial<IssueDoc['issue']> = {}): IssueDoc => {
  const d = structuredClone(base);
  Object.assign(d.issue, over);
  return d;
};

describe('the subject line', () => {
  it('is WT{n} — {title} for a real editorial title', () => {
    expect(subjectFor(doc({ title: 'Owning the Rails' }))).toBe('WT350 — Owning the Rails');
  });

  it('strips the newsletter name a placeholder title carries', () => {
    expect(subjectFor(doc({ title: 'The Weekly Thing 350' }))).toBe('WT350');
  });

  it('never prints the number twice', () => {
    expect(subjectFor(doc({ title: '350' }))).toBe('WT350');
    expect(subjectFor(doc({ title: '' }))).toBe('WT350');
  });
});

describe('link extraction', () => {
  it('splits links by their section', () => {
    const e = extractLinks(doc());
    expect(e.notable_links.map((l) => l.domain)).toEqual(['avc.xyz', 'james-pritchard.com']);
    expect(e.briefly_links).toHaveLength(3);
    expect(e.links).toHaveLength(5);
  });

  it('carries the Markdown link as heading context', () => {
    const first = extractLinks(doc()).notable_links[0]!;
    expect(first.heading_context).toBe(`[${first.text}](${first.url})`);
  });

  it("excludes Jamie's own domain — an issue citing itself is not outbound", () => {
    const e = extractLinks(doc());
    expect(e.domains).not.toContain('www.thingelstad.com');
    expect(e.domains).not.toContain('thingelstad.com');
    expect(e.domains).toContain('avc.xyz');
  });

  it('sorts and deduplicates the fingerprint', () => {
    const d = extractLinks(doc()).domains;
    expect([...d].sort()).toEqual(d);
    expect(new Set(d).size).toBe(d.length);
  });

  it('counts words from what actually renders', () => {
    expect(extractLinks(doc()).word_count).toBeGreaterThan(100);
  });
});

describe('the archive page', () => {
  it('carries every field the real published page has', () => {
    const real = readFileSync(
      '/Users/otto/Projects/weekly.thingelstad.com/apps/site/archive/349.md', 'utf8');
    const keys = (md: string) =>
      new Set(md.split('---')[1]!.split('\n').filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.split(':')[0]!));
    // The reference page has audio, so compare the fully-populated case.
    const mine = keys(
      archivePage(doc(), {
        buttondownId: 'em_x',
        audio: {
          audio_url: 'https://files.thingelstad.com/x.mp3',
          audio_duration_seconds: 60,
          audio_byte_size: 999,
          audio_voice: 'openai-tts-1-hd:echo',
        },
      }),
    );
    for (const field of keys(real)) {
      expect(mine, `missing front-matter field: ${field}`).toContain(field);
    }
  });

  it('points image at the generated cover, not an issue photo', () => {
    const page = archivePage(doc());
    expect(page).toContain(`image: ${coverImage(350)}`);
    expect(page).toContain('/weekly-thing/350/cover.jpg');
  });

  it('drops the H1 — the layout prints the title from front matter', () => {
    const body = archivePage(doc()).split('---')[2]!;
    expect(body).not.toContain('# The Weekly Thing');
    expect(body).toContain('Welcome back from summer break');
  });

  it('omits audio fields when there is no audio', () => {
    expect(archivePage(doc())).not.toContain('audio_url:');
  });

  it('carries the audio reference when there is', () => {
    const page = archivePage(doc(), {
      audio: { audio_url: 'https://files.thingelstad.com/x.mp3', audio_duration_seconds: 60,
               audio_byte_size: 999, audio_voice: 'openai-tts-1-hd:echo' },
    });
    expect(page).toContain('audio_url: https://files.thingelstad.com/x.mp3');
    expect(page).toContain('audio_byte_size: 999');
  });
});

describe('the handoff file set', () => {
  it('commits the page, the index, and the status', () => {
    const paths = siteInputs(doc()).map((f) => f.path);
    expect(paths).toEqual([
      'apps/site/archive/350.md',
      'apps/site/_data/emails.json',
      'apps/site/_data/status.json',
    ]);
  });

  it('rewrites the index whole, in issue order', () => {
    const prior = [issueEntry(doc({ number: 348 })), issueEntry(doc({ number: 349 }))];
    const files = siteInputs(doc(), { priorEntries: prior });
    const emails = JSON.parse(files.find((f) => f.path.endsWith('emails.json'))!.content);
    expect(emails.map((e: { number: number }) => e.number)).toEqual([348, 349, 350]);
  });

  it('never lets a stale prior entry shadow this issue', () => {
    const stale = { ...issueEntry(doc()), subject: 'STALE' };
    const files = siteInputs(doc(), { priorEntries: [stale] });
    const emails = JSON.parse(files.find((f) => f.path.endsWith('emails.json'))!.content);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).not.toBe('STALE');
  });
});

describe('audio chunking', () => {
  it('keeps every chunk under the cap', () => {
    const script = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} of the script.`).join('\n\n');
    for (const chunk of chunkScript(script)) expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
  });

  it('splits on paragraph boundaries, where a pause already is', () => {
    const chunks = chunkScript('One.\n\nTwo.\n\nThree.');
    expect(chunks).toEqual(['One.\n\nTwo.\n\nThree.']);
  });

  it('splits an over-long paragraph on sentence ends', () => {
    const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const chunks = chunkScript(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });

  it('drops nothing from the script', () => {
    const script = 'Alpha.\n\nBravo.\n\nCharlie.';
    expect(chunkScript(script).join('\n\n')).toBe(script);
  });
});

describe('git blob hashing', () => {
  it('matches git hash-object', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(blobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('audio mastering', () => {
  it('tags the mp3 from what the issue already knows', () => {
    const tags = id3Tags(doc({ title: 'Owning the Rails', number: 349 }));
    expect(tags.title).toBe('WT349 — Owning the Rails');
    expect(tags.track).toBe('349');
    expect(tags.artist).toBe('Jamie Thingelstad');
    expect(tags.album).toBe('The Weekly Thing');
    expect(tags.date).toBe('2026-09-05');
  });

  it('normalizes to the podcast convention', () => {
    // -16 LUFS / -1.5 dBTP is the podcast standard and what Studio ships.
    expect(LOUDNORM_I).toBe(-16);
    expect(LOUDNORM_TP).toBe(-1.5);
    expect(FINAL_SAMPLE_RATE).toBe(44100);
    expect(FINAL_CHANNELS).toBe(1);
  });
});

describe('cover art', () => {
  it("uses the issue's own photo as the source", () => {
    expect(coverSource(doc())).toBe(
      'https://files.thingelstad.com/weekly-thing/349/cover.jpg',
    );
  });

  it('falls back to show art when an issue has no photo', () => {
    const d = doc();
    for (const item of Object.values(d.items)) {
      if (item.type === 'photo') item.channels = { website: false, email: false, audio: false };
    }
    expect(coverSource(d)).toBeNull();
  });

  it('publishes the banner where the archive page points', () => {
    expect(bannerUrl(350)).toBe('https://files.thingelstad.com/weekly-thing/350/cover.jpg');
    expect(bannerUrl(350)).toBe(coverImage(350));
  });

  it('makes square art large enough for Apple Podcasts', () => {
    expect(SQUARE_SIZE).toBeGreaterThanOrEqual(1400);
    expect(SQUARE_SIZE).toBeLessThanOrEqual(3000);
  });
});
