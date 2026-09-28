/**
 * The back catalogue's page handling: the audio record goes into a page's
 * front matter without touching anything else, and comes back out.
 */

import { describe, expect, it } from 'vitest';

import { frontMatter, hasCurrentAudio, pageKeys, plausibleDuration, rerenderedPage, withAudio } from '../src/server/backfill.ts';
import { RERENDER_NOTICE } from '../src/server/publish.ts';
import { VOICE_ID } from '../src/server/integrations/audio.ts';

const page = `---
layout: layouts/issue.njk
number: 50
subject: 'Weekly Thing #50 / Apr 21, 2018'
publish_date: '2018-04-21T12:00:00Z'
image: https://files.thingelstad.com/weekly-thing/50/cover.jpg
domains:
- example.com
permalink: /archive/50/
tags: issue
audio_url: https://files.thingelstad.com/weekly-thing/50/weekly-thing-50.mp3
audio_duration_seconds: 700
audio_byte_size: 1
audio_voice: openai-tts-1-hd:echo
---
<!-- Generated -->
Body text with --- inside it.
`;

const fields = {
  audio_url: 'https://files.thingelstad.com/weekly-thing/50/weekly-thing-50-abcd1234.mp3',
  audio_duration_seconds: 812,
  audio_byte_size: 19488102,
  audio_voice: VOICE_ID,
  audio_chapters_url: 'https://files.thingelstad.com/weekly-thing/50/weekly-thing-50-abcd1234.chapters.json',
  audio_transcript_url: 'https://files.thingelstad.com/weekly-thing/50/weekly-thing-50-abcd1234.vtt',
  audio_chapters: [{ title: 'Welcome', url: 'https://weekly.thingelstad.com/archive/50/', start: 0 }, { title: 'Notable: Links', start: 61.2 }],
};

describe('back catalogue pages', () => {
  it('reads one-line scalars from the front matter, quoted or not', () => {
    const { get } = frontMatter(page);
    expect(get('number')).toBe('50');
    expect(get('subject')).toBe('Weekly Thing #50 / Apr 21, 2018');
    expect(get('permalink')).toBe('/archive/50/');
    expect(get('missing')).toBe('');
  });

  it('reads a JSON-quoted scalar the way YAML does', () => {
    // WT Builder writes every string as a JSON string since 2026-09-28
    // (review 2026-09-27 §1.3); a double-quoted value is JSON-unescaped.
    const quoted = page
      .replace("subject: 'Weekly Thing #50 / Apr 21, 2018'", 'subject: "WT50 \\u2014 \\"Quoted\\" \\\\ back\\tslash"')
      .replace('audio_voice: openai-tts-1-hd:echo', 'audio_voice: "openai-tts-1-hd:echo+nova"');
    const { get } = frontMatter(quoted);
    expect(get('subject')).toBe('WT50 \u2014 "Quoted" \\ back\tslash');
    expect(get('audio_voice')).toBe('openai-tts-1-hd:echo+nova');
  });

  it('replaces the old audio record and leaves the rest of the page alone', () => {
    const out = withAudio(page, fields);
    expect(out).not.toContain('weekly-thing-50.mp3');
    expect(out).not.toContain('audio_voice: openai-tts-1-hd:echo\n');
    expect(out).toContain(`audio_voice: "${VOICE_ID}"`);
    expect(out).toContain('audio_chapters:\n- start: 0\n  title: "Welcome"\n  url: "https://weekly.thingelstad.com/archive/50/"\n- start: 61.2\n  title: "Notable: Links"');
    expect(out).toContain("subject: 'Weekly Thing #50 / Apr 21, 2018'");
    expect(out.endsWith('---\n<!-- Generated -->\nBody text with --- inside it.\n')).toBe(true);
    // Idempotent: writing the record twice is writing it once.
    expect(withAudio(out, fields)).toBe(out);
    expect(hasCurrentAudio(page)).toBe(false);
    expect(hasCurrentAudio(out)).toBe(true);
  });

  it('knows a reading that is far too short or long for its script', () => {
    const blocks = [{ kind: 'cue' as const, text: 'x'.repeat(12_000), pauseBefore: 'none' as const }];
    expect(plausibleDuration(blocks, 800)).toBeNull();
    expect(plausibleDuration(blocks, 100)).toMatch(/not a plausible reading/);
    expect(plausibleDuration(blocks, 4000)).toMatch(/not a plausible reading/);
  });
});

describe('re-rendering a page from its canonical text', () => {
  const canonical = `---
number: 50
subject: 'Weekly Thing #50 / Apr 21, 2018'
publish_date: '2018-04-21T12:00:00Z'
image: https://files.thingelstad.com/weekly-thing/50/cover.jpg
domains:
- example.com
- example.org
---
Repaired body, with --- inside it.
`;
  const withRecord = withAudio(page, fields);

  it('takes the body and editorial front matter from the canonical text, and names this command', () => {
    const out = rerenderedPage(withRecord, canonical);
    expect(frontMatter(out).body).toBe(`${RERENDER_NOTICE}\nRepaired body, with --- inside it.\n`);
    expect(out).toContain('domains:\n- example.com\n- example.org\n');
    expect(out).not.toContain('<!-- Generated -->');
  });

  it('keeps layout, permalink, tags and the audio record exactly where they stood', () => {
    const out = rerenderedPage(withRecord, canonical);
    expect(pageKeys(out, canonical).owned).toEqual(pageKeys(withRecord, canonical).owned);
    expect(pageKeys(out, canonical).editorial).toEqual(pageKeys(canonical, canonical).editorial);
    expect(frontMatter(out).front.startsWith('layout: layouts/issue.njk\nnumber: 50\n')).toBe(true);
    // Idempotent, and the audio record still goes on over it the same way.
    expect(rerenderedPage(out, canonical)).toBe(out);
    expect(withAudio(out, fields)).toBe(out);
  });

  it('never takes an owned key from the canonical text', () => {
    const stray = canonical.replace('number: 50\n', 'number: 50\npermalink: /elsewhere/\n');
    expect(rerenderedPage(withRecord, stray)).not.toContain('/elsewhere/');
  });
});
