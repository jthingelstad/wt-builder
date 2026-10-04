/**
 * The audio script's mechanical lint (src/shared/render/script-lint.ts): what
 * the model missed on WT352 ("The Replacements)"), and the residue a voice
 * would say aloud. The representative issue's script must come out clean:
 * if it does not, the renderer left something behind.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { audioScript } from '../src/shared/render/audio.ts';
import { joinScriptReview, lintScript } from '../src/shared/render/script-lint.ts';

const fixture = () =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8')) as IssueDoc;

const problems = (text: string) => lintScript([{ text }]).map((f) => f.problem);

describe('the representative issue', () => {
  it('its audio edition lints clean', () => {
    const blocks = audioScript(fixture());
    expect(blocks.length).toBeGreaterThan(20);
    expect(lintScript(blocks)).toEqual([]);
  });

  it('residue typed into an item is caught in the rendered script, on its block', () => {
    const doc = fixture();
    doc.items['link-flipcash']!.commentary = 'I loved The Replacements) back then. Also &mdash; this.';
    const blocks = audioScript(doc);
    const found = lintScript(blocks);
    expect(found.map((f) => [blocks[f.block]!.itemId, f.quote])).toEqual([
      ['link-flipcash', 'loved The Replacements) back'],
      ['link-flipcash', 'then. Also &mdash; this.'],
    ]);
  });
});

describe('brackets: only an unbalanced one counts', () => {
  it('a stray closer, and an opener that never closes', () => {
    expect(lintScript([{ text: 'I loved The Replacements) live.' }])).toEqual([
      { block: 0, quote: 'loved The Replacements) live.', problem: 'A ")" with nothing to close: the voice may say it, or stumble.', mechanical: true },
    ]);
    expect(problems('A list [of things')).toEqual(['A "[" that never closes: the voice may say it, or stumble.']);
    expect(problems('done]')).toEqual(['A "]" with nothing to close: the voice may say it, or stumble.']);
  });

  it('parenthetical prose is fine, nested too', () => {
    expect(problems('Dots (as a dot) are back (and [briefly] so).')).toEqual([]);
  });

  it('a link left behind is one finding, not its halves', () => {
    expect(problems('See this](https://example.com/a) now')).toEqual([
      'A Markdown link was not turned into words ("](").',
      'A web address would be read aloud, or trip the voice.',
    ]);
  });

  it("an emoticon is an emoticon (WT352's \"the first ring.:-)\")", () => {
    expect(problems('the first ring.:-).')).toEqual(['An emoticon ":-)": the voice says the punctuation, or nothing.']);
  });
});

describe('residue a voice would say', () => {
  it('web addresses', () => {
    expect(problems('Go to https://example.com/x today')).toEqual(['A web address would be read aloud, or trip the voice.']);
    expect(problems('or www.example.com')).toEqual(['A web address would be read aloud, or trip the voice.']);
    expect(problems('weekly dot thingelstad dot com')).toEqual([]);
  });

  it('Markdown', () => {
    expect(problems('this is **bold**')).toEqual(['Markdown "**" would be read aloud, or trip the voice.']);
    expect(problems('this is _emphasis_ here')).toEqual(['Markdown emphasis "_…_" would be read aloud, or trip the voice.']);
    expect(problems('a `code` span')).toEqual(['A backtick would be read aloud, or trip the voice.']);
    expect(problems('an ![image')).toContain('A Markdown image "![" would be read aloud, or trip the voice.');
    expect(problems('# A heading')).toEqual(['A Markdown heading mark "#" would be read aloud, or trip the voice.']);
    expect(problems('Intro\n> a quote')).toEqual(['A Markdown quote mark ">" would be read aloud, or trip the voice.']);
  });

  it('HTML tags and entities', () => {
    expect(problems('a <code>thing</code> here')).toEqual(['The HTML tag "<code>" would be read aloud, or trip the voice.']);
    expect(problems('rock &amp; roll, it&#8217;s')).toEqual([
      'The HTML entity "&amp;" would be read aloud, or trip the voice.',
      'The HTML entity "&#8217;" would be read aloud, or trip the voice.',
    ]);
  });

  it('bare emoji', () => {
    expect(problems('Coffee ☕ time')).toEqual(['An emoji "☕": the voice says its name, or nothing.']);
  });

  it('words a voice says fine are left alone', () => {
    for (const text of [
      'Weekly Thing 352. This is the issue for October 4, 2026.',
      'Quote. It was the best of times. End quote.',
      'snake_case and 3 < 4 and AT&T and #1 and 50% and "quoted"',
      'He said: (well) fine.',
    ]) expect(problems(text), text).toEqual([]);
  });
});

describe('joining the model\'s read', () => {
  const lint = lintScript([{ text: 'x' }, { text: 'I loved The Replacements) live.' }]);

  it('the lint leads, the model\'s overlapping finding is dropped, and the summary says what the lint added', () => {
    const out = joinScriptReview(lint, {
      verdict: 'ready',
      summary: 'Nothing would trip a listener.',
      findings: [
        { block: 1, quote: 'Replacements)', problem: 'stray parenthesis' },
        { block: 0, quote: 'x', problem: 'a letter alone' },
      ],
    });
    expect(out.verdict).toBe('look');
    expect(out.findings.map((f) => [f.block, f.mechanical ?? false])).toEqual([[1, true], [0, false]]);
    expect(out.summary).toBe('Nothing would trip a listener. The mechanical check found 1 thing the voice would say or stumble on.');
  });

  it('with nothing from the lint, the model\'s read stands as it was', () => {
    const model = { verdict: 'ready' as const, summary: 'Ready.', findings: [] };
    expect(joinScriptReview([], model)).toEqual(model);
  });
});
