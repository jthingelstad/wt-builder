/**
 * The back catalogue's page handling: the audio record goes into a page's
 * front matter without touching anything else, and comes back out.
 */

import { describe, expect, it } from 'vitest';

import { frontMatter, hasCurrentAudio, plausibleDuration, withAudio } from '../src/server/backfill.ts';
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

  it('replaces the old audio record and leaves the rest of the page alone', () => {
    const out = withAudio(page, fields);
    expect(out).not.toContain('weekly-thing-50.mp3');
    expect(out).not.toContain('audio_voice: openai-tts-1-hd:echo\n');
    expect(out).toContain(`audio_voice: ${VOICE_ID}`);
    expect(out).toContain('audio_chapters:\n- start: 0\n  title: Welcome\n  url: \'https://weekly.thingelstad.com/archive/50/\'\n- start: 61.2\n  title: \'Notable: Links\'');
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
