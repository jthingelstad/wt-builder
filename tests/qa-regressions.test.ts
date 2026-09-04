/**
 * Regressions found by a QA pass over a half-written issue swept from live
 * Pinboard and Micro.blog. Each of these shipped broken output before.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc, Item } from '../src/shared/types.ts';
import { allChannels } from '../src/shared/types.ts';
import { renderWebsite } from '../src/shared/render/website.ts';
import { renderAudio } from '../src/shared/render/audio.ts';
import { speakable, isSilent } from '../src/shared/render/speech.ts';
import { candidateToItem } from '../src/server/integrations/pinboard.ts';
import { sourceRows } from '../src/shared/render/source.ts';
import { markdownToSafeHtml } from '../src/shared/markdown.ts';
import { shouldWriteBack } from '../src/client/api.ts';

/** A skeleton issue whose items are deliberately half-written. */
function issue(items: Record<string, Partial<Item>>, nodes: IssueDoc['nodes']): IssueDoc {
  const full: Record<string, Item> = {};
  for (const [id, i] of Object.entries(items)) {
    full[id] = {
      type: 'markdown', authorship: 'Jamie', source: 'direct',
      channels: allChannels(), ...i,
    } as Item;
  }
  return {
    schema_version: 2,
    issue: {
      id: 'wt350', number: 350, title: 'QA', status: 'draft',
      publication_date: '2026-08-29', window_days: 7,
    },
    nodes, items: full,
  };
}

const node = (over: Partial<IssueDoc['nodes'][number]>): IssueDoc['nodes'][number] => ({
  id: 'n', kind: 'section', type: 'markdown', label: 'N',
  movable: true, publishes_heading: false, items: [], ...over,
});

describe('markup never reaches the synthesizer', () => {
  // Micro.blog post source is Markdown with raw <img> tags. Spoken, TTS reads
  // the URL out character by character.
  const post =
    'Great coffee this morning at [Johnson Public House](https://www.johnsonpublichouse.com) ' +
    'in Madison. <img src="https://www.thingelstad.com/uploads/2026/bbe1d53fe0.jpg" width="600" alt="">';

  it('speaks a link as its text, never its URL', () => {
    expect(speakable(post)).toContain('Johnson Public House');
    expect(speakable(post)).not.toContain('http');
    expect(speakable(post)).not.toContain('](');
  });

  it('drops image tags entirely rather than reading them', () => {
    expect(speakable(post)).not.toContain('<img');
    expect(speakable(post)).not.toContain('width=');
  });

  it('drops Markdown images, alt text and all', () => {
    expect(speakable('Look ![a lake at dusk](https://x.test/l.jpg) there')).toBe('Look there');
  });

  it('strips emphasis marks, which are silent', () => {
    expect(speakable('This is **important** and _urgent_')).toBe('This is important and urgent');
  });

  it('keeps the audio script free of markup end to end', () => {
    const doc = issue(
      { 'j-1': { type: 'journal_post', source: 'Micro.blog', authorship: 'syndicated',
                 presentation: 'journal', published_at: '2026-08-22T12:56:00-05:00',
                 source_url: 'https://www.thingelstad.com/p.html', body: post } },
      [node({ id: 'journal', type: 'journal', label: 'Journal', publishes_heading: true, items: ['j-1'] })],
    );
    const script = renderAudio(doc);
    expect(script).not.toMatch(/<img|\]\(|https?:\/\//);
    expect(script).toContain('Johnson Public House');
  });

  it('reports silence for markup that carries no words', () => {
    expect(isSilent('<img src="https://x.test/a.jpg">')).toBe(true);
    expect(isSilent('**   **')).toBe(true);
    expect(isSilent('real words')).toBe(false);
  });

  it('renders imported Markdown and images as safe reader-facing HTML', () => {
    const html = markdownToSafeHtml(post);
    expect(html).toContain('<a href="https://www.johnsonpublichouse.com/"');
    expect(html).toContain('<img src="https://www.thingelstad.com/uploads/2026/bbe1d53fe0.jpg"');
    expect(html).not.toContain('&lt;img');
  });

  it('renders an ordered list as a list, not a run-on paragraph', () => {
    // WT350: the State Fair food log rendered as one paragraph because the
    // canvas renderer had no ordered-list case.
    const html = markdownToSafeHtml(
      'State Fair Food Log:\n\n1. Elote Tots\n2. Muffin Top\n3. Mini Donuts',
    );
    expect(html).toContain('<ol><li>Elote Tots</li><li>Muffin Top</li><li>Mini Donuts</li></ol>');
    expect(html).not.toContain('1. Elote Tots 2.');
  });

  it('does not turn a mid-paragraph year into a list', () => {
    const html = markdownToSafeHtml('Since\n2003. The club has met monthly.');
    expect(html).toContain('<p>Since 2003. The club has met monthly.</p>');
    expect(html).not.toContain('<ol');
  });

  it('escapes unsafe raw HTML and URL schemes', () => {
    const html = markdownToSafeHtml('<script>alert(1)</script> [bad](javascript:alert(2))');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });
});

describe('half-written items publish nothing', () => {
  it('an unwritten haiku does not publish "****"', () => {
    const doc = issue(
      { 'h-1': { type: 'haiku', source: 'generated', body: '' } },
      [node({ id: 'haiku', type: 'haiku', label: 'Haiku', items: ['h-1'] })],
    );
    expect(renderWebsite(doc)).not.toContain('****');
  });

  it('an unwritten Currently entry does not publish a dangling label', () => {
    const doc = issue(
      { 'c-1': { type: 'currently', label: 'Building', body: '' } },
      [node({ id: 'currently', type: 'currently', label: 'Currently', publishes_heading: true, items: ['c-1'] })],
    );
    expect(renderWebsite(doc)).not.toContain('**Building:**');
  });

  it('an unwritten Thingy item does not publish a bare byline', () => {
    const doc = issue(
      { 'm-1': { type: 'membership', authorship: 'Thingy', source: 'Thingy',
                 attribution: 'Thingy', body: '' } },
      [node({ id: 'membership', type: 'membership', label: 'Membership', items: ['m-1'] })],
    );
    expect(renderWebsite(doc)).not.toContain('_By Thingy_');
  });

  it('does not announce a section that has nothing to say', () => {
    const doc = issue(
      { 'h-1': { type: 'haiku', source: 'generated', body: '' } },
      [node({ id: 'haiku', type: 'haiku', label: 'Haiku', items: ['h-1'] })],
    );
    const script = renderAudio(doc);
    expect(script).not.toContain("this week's haiku");
    expect(script.trim().endsWith('That brings us to the end of The Weekly Thing.')).toBe(true);
  });

  it('does not speak a Journal weekday with no posts under it', () => {
    const doc = issue(
      { 'j-1': { type: 'journal_post', source: 'Micro.blog', authorship: 'syndicated',
                 presentation: 'journal', published_at: '2026-08-22T12:00:00-05:00',
                 body: '<img src="https://x.test/only-an-image.jpg">' } },
      [node({ id: 'journal', type: 'journal', label: 'Journal', publishes_heading: true, items: ['j-1'] })],
    );
    const script = renderAudio(doc);
    expect(script).not.toContain('Saturday');
    expect(script).not.toContain('Now, the Journal section.');
  });
});

describe('placement wins over the capture tag', () => {
  const link = (over: Partial<Item> = {}): Partial<Item> => ({
    type: 'pinboard_link', authorship: 'syndicated', source: 'Pinboard',
    title: 'A Link', source_url: 'https://x.test/a',
    commentary: 'Worth a look.', ...over,
  });

  it('renders an untagged link filed under Briefly in Briefly form', () => {
    // Swept without a section tag, then placed in Briefly by default.
    const doc = issue({ 'l-1': link({ section: undefined }) },
      [node({ id: 'briefly', type: 'briefly', label: 'Briefly', publishes_heading: true, items: ['l-1'] })]);
    const out = renderWebsite(doc);
    expect(out).toContain('Worth a look. → **[A Link](https://x.test/a)**');
    expect(out).not.toContain('### [A Link]');
  });

  it('renders a Notable-tagged link moved into Briefly in Briefly form', () => {
    const doc = issue({ 'l-1': link({ section: 'Notable' }) },
      [node({ id: 'briefly', type: 'briefly', label: 'Briefly', publishes_heading: true, items: ['l-1'] })]);
    expect(renderWebsite(doc)).toContain('→ **[A Link]');
  });

  it('renders a Briefly-tagged link moved into Notable as a heading', () => {
    const doc = issue({ 'l-1': link({ section: 'Briefly' }) },
      [node({ id: 'notable', type: 'notable', label: 'Notable', publishes_heading: true, items: ['l-1'] })]);
    expect(renderWebsite(doc)).toContain('### [A Link](https://x.test/a)');
  });
});

describe('write-back stays inside its contract', () => {
  // Pinboard's add endpoint replaces the whole bookmark: any field not sent is
  // reset to its default, which is shared=yes and toread=no. Editing
  // commentary once published a private bookmark and dropped it from the
  // unread queue the sweep reads from.
  it('carries source-owned flags onto the item at sweep time', () => {
    const item = candidateToItem({
      id: 'pinboard:abc', origin: 'Pinboard', url: 'https://x.test/a',
      title: 'A', commentary: 'c', tags: ['weekly-thing'],
      flags: { toread: 'yes', shared: 'no' },
    });
    expect(item.source_flags).toEqual({ toread: 'yes', shared: 'no' });
  });

  it('carries the capture time onto the item — the window judges by it', () => {
    // Dropped once: swept links landed without published_at and were immune
    // to the window while journal posts obeyed it.
    const item = candidateToItem({
      id: 'pinboard:abc', origin: 'Pinboard', url: 'https://x.test/a',
      title: 'A', published_at: '2026-08-22T14:00:00Z',
    });
    expect(item.published_at).toBe('2026-08-22T14:00:00Z');
  });

  it('defaults a bookmark with no captured flags to private and unread', () => {
    const item = candidateToItem({
      id: 'pinboard:abc', origin: 'Pinboard', url: 'https://x.test/a', title: 'A',
    });
    // Absent flags must not become "public and read" by omission.
    expect(item.source_flags).toBeUndefined();
  });

  it('automatically writes only source-owned fields', () => {
    const pinboard = candidateToItem({
      id: 'pinboard:abc', origin: 'Pinboard', url: 'https://x.test/a', title: 'A',
    });
    expect(shouldWriteBack(pinboard, { commentary: 'Local note' })).toBe(true);
    expect(shouldWriteBack(pinboard, { channels: allChannels() })).toBe(false);

    const microblog = {
      ...pinboard,
      type: 'journal_post' as const,
      source: 'Micro.blog' as const,
    };
    expect(shouldWriteBack(microblog, { body: 'Revised post' })).toBe(true);
    expect(shouldWriteBack(microblog, { commentary: 'Issue-only note' })).toBe(false);
  });
});

describe('the send screen offers every leg that exists', () => {
  // A working send leg that the UI cannot reach is invisible. This regressed
  // once (a built leg flagged unbuilt), so the reachability is pinned here.
  // The `built` flag itself is gone — a destination is offered by having a
  // card, so the guard is that each card exists and carries a runnable action.
  it('gives every implemented destination a card that can be run', async () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/client/components/Send.tsx', import.meta.url)), 'utf8');

    const keys = [...src.matchAll(/key: '(buttondown|website|podcast)'/g)].map((m) => m[1]);
    expect(new Set(keys)).toEqual(new Set(['podcast', 'website', 'buttondown']));

    for (const key of ['podcast', 'website', 'buttondown']) {
      const start = src.indexOf(`key: '${key}'`);
      const next = keys
        .map((k) => src.indexOf(`key: '${k}'`))
        .filter((i) => i > start)
        .sort((a, b) => a - b)[0] ?? src.indexOf('];', start);
      const block = src.slice(start, next);
      // A verb is the action button's label; without one the card cannot send.
      expect(block, `${key} has no action`).toMatch(/verb: '/);
      expect(block, `${key} shows no steps`).toContain('steps: [');
    }
  });

  it('runs the legs in the order the design specifies', () => {
    // Podcast first: the website handoff publishes an audio reference, so the
    // file has to exist for that reference to resolve.
    const src = readFileSync(
      fileURLToPath(new URL('../src/client/components/Send.tsx', import.meta.url)), 'utf8');
    const order = [...src.matchAll(/key: '(buttondown|website|podcast)'/g)].map((m) => m[1]);
    expect(order).toEqual(['podcast', 'website', 'buttondown']);
  });

  // Whether the server actually dispatches each destination is pinned in
  // tests/routes.test.ts, over HTTP. A source-grep version of that test lived
  // here once and passed against the exact regression it was written to catch
  // — the severed guard contained the same strings it looked for.
});

describe('the source lens shows words, not markup', () => {
  it('strips Markdown from a Journal post used as a title', () => {
    const doc = issue(
      { 'j-1': { type: 'journal_post', source: 'Micro.blog', authorship: 'syndicated',
                 body: 'Great coffee at [Johnson Public House](https://jph.test) in Madison. '
                     + '<img src="https://x.test/a.jpg" width="600">' } },
      [node({ id: 'journal', type: 'journal', label: 'Journal', items: ['j-1'] })],
    );
    const row = sourceRows(doc)[0]!;
    expect(row.title).toContain('Johnson Public House');
    expect(row.title).not.toContain('](');
    expect(row.title).not.toContain('<img');
  });
});
