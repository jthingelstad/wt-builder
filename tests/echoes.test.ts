/**
 * Echoes are items. Each echo prints as its thread and its door into Thingy;
 * the editions assemble the section from the items. And an issue from before
 * — one `echoes` item whose body was composed at pick time (WT350) — must
 * render exactly as it did, because it is published and nothing migrates it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc, Item } from '../src/shared/types.ts';
import { askThingyLine, askThingyUrl, echoBlock, echoBlocks } from '../src/shared/echoes.ts';
import { renderWebsite } from '../src/shared/render/website.ts';
import { renderEmail } from '../src/shared/render/email.ts';
import { renderAudio } from '../src/shared/render/audio.ts';
import { renderAnnotated } from '../src/shared/render/annotate.ts';

const fixture = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
  ) as IssueDoc;

const thingy = (extra: Partial<Item>): Item => ({
  type: 'echo', authorship: 'Thingy', source: 'Thingy', attribution: 'Thingy',
  channels: { website: true, email: true, audio: true }, ...extra,
});

describe('one echo, as it prints', () => {
  it('is the thread, then the question as a link that opens Thingy with it asked', () => {
    const url = askThingyUrl("How has Jamie's view of code review changed?", 350);
    expect(url.startsWith('https://thingy.thingelstad.com/chat/?prompt=')).toBe(true);
    expect(url).toContain('from=weekly-thing-350');
    expect(echoBlocks({ body: 'Code review came up in [WT210](https://weekly.thingelstad.com/archive/210/).', ask: "How has Jamie's view of code review changed?" }, 350))
      .toEqual([
        'Code review came up in [WT210](https://weekly.thingelstad.com/archive/210/).',
        `_Ask Thingy:_ [How has Jamie's view of code review changed?](${url})`,
      ]);
  });

  it('a thread with no question is just the thread; no thread is nothing', () => {
    expect(echoBlocks({ body: '  A thread with no question.  ' })).toEqual(['A thread with no question.']);
    expect(echoBlocks({ body: '', ask: 'Orphan question?' })).toEqual([]);
    expect(askThingyLine('   ')).toBe('');
    expect(echoBlock({ body: 'a', ask: 'b?' }, 1)).toBe(`a\n\n${askThingyLine('b?', 1)}`);
  });

  it('is attributed to the issue by number, or to the newsletter without one', () => {
    expect(askThingyUrl('q').endsWith('from=weekly-thing')).toBe(true);
  });
});

describe('the Echoes section iterates its items', () => {
  it('prints every echo inside one frame, in section order, each with its own door', () => {
    const doc = fixture();
    const echoes = doc.nodes.find((n) => n.type === 'echoes')!;
    echoes.items = ['e-1', 'e-2', 'e-3'];
    doc.items['e-1'] = thingy({ body: 'First thread.', ask: 'First question?' });
    doc.items['e-2'] = thingy({ body: 'Second thread, no door.' });
    doc.items['e-3'] = thingy({ body: 'Third thread.', ask: 'Third question?' });

    const site = renderWebsite(doc);
    const tail = site.slice(site.indexOf('## Echoes'));
    expect(tail.match(/from-thingy-label/g)).toHaveLength(1);
    expect(tail.indexOf('First thread.')).toBeLessThan(tail.indexOf('First question?'));
    expect(tail.indexOf('First question?')).toBeLessThan(tail.indexOf('Second thread, no door.'));
    expect(tail.indexOf('Second thread, no door.')).toBeLessThan(tail.indexOf('Third thread.'));
    expect(tail.match(/_Ask Thingy:_/g)).toHaveLength(2);
    expect(tail).toContain('from=weekly-thing-350');

    const mail = renderEmail(doc);
    const mailTail = mail.slice(mail.indexOf('## Echoes'));
    expect(mailTail.match(/class="from-thingy"/g)).toHaveLength(1);
    expect(mailTail.match(/<em>Ask Thingy:<\/em>/g)).toHaveLength(2);
    expect(mailTail.indexOf('First thread.')).toBeLessThan(mailTail.indexOf('Second thread'));

    const audio = renderAudio(doc);
    const spoken = audio.slice(audio.indexOf('Before we go'));
    expect(spoken).toContain('First thread.\n\nAsk Thingy: First question?\n\nSecond thread, no door.\n\nThird thread.\n\nAsk Thingy: Third question?');
    expect(spoken).not.toContain('http');
  });

  it('an echo moved out of the editions is skipped, and an all-hidden section prints no heading', () => {
    const doc = fixture();
    const echoes = doc.nodes.find((n) => n.type === 'echoes')!;
    doc.items[echoes.items[0]!]!.channels = { website: false, email: true, audio: true };
    const site = renderWebsite(doc);
    expect(site).not.toContain('return to building');
    expect(site).toContain('Shortcuts has been the workflow');
    for (const id of echoes.items) doc.items[id]!.channels = { website: false, email: false, audio: false };
    expect(renderWebsite(doc)).not.toContain('## Echoes');
    expect(renderAudio(doc)).not.toContain('Before we go');
  });

  it('the annotated edition the reviewer reads marks each echo by id', () => {
    const out = renderAnnotated(fixture());
    expect(out).toContain('<!--item:echo-building-->');
    expect(out).toContain('<!--item:echo-shortcuts-->');
    expect(out.indexOf('<!--item:echo-building-->')).toBeLessThan(out.indexOf('<!--item:echo-shortcuts-->'));
  });
});

describe('an issue from before echoes were items renders unchanged', () => {
  // WT350's shape: one `echoes` item whose body the picker composed —
  // threads and Ask-Thingy lines already in the text, citations pooled.
  const composed = [
    'The Kubb tournament reached its 8th annual running this week, after [WT262](https://weekly.thingelstad.com/archive/262/).',
    '_Ask Thingy:_ [How has the Kubb Tournament grown?](https://thingy.thingelstad.com/chat/?prompt=How+has+the+Kubb+Tournament+grown%3F&from=weekly-thing-350)',
    'The call for privacy regulation has a long run-up: [WT281](https://weekly.thingelstad.com/archive/281/).',
    '_Ask Thingy:_ [What has Jamie written about privacy?](https://thingy.thingelstad.com/chat/?prompt=What+has+Jamie+written+about+privacy%3F&from=weekly-thing-350)',
  ].join('\n\n');

  const single = () => {
    const doc = fixture();
    const echoes = doc.nodes.find((n) => n.type === 'echoes')!;
    for (const id of echoes.items) delete doc.items[id];
    echoes.items = ['echoes-1'];
    doc.items['echoes-1'] = {
      type: 'echoes', authorship: 'Thingy', source: 'Thingy', attribution: 'Thingy', status: 'reviewed',
      channels: { website: true, email: true, audio: true },
      body: composed,
      archive_references: [
        { kind: 'issue', issue: 262, url: 'https://weekly.thingelstad.com/archive/262/' },
        { kind: 'issue', issue: 281, url: 'https://weekly.thingelstad.com/archive/281/' },
      ],
    };
    return doc;
  };

  it('website: the body as written, inside the frame, under the heading', () => {
    const out = renderWebsite(single());
    expect(out.slice(out.indexOf('## Echoes'))).toBe([
      '## Echoes',
      '<div class="from-thingy">',
      '<p class="from-thingy-label"><a href="https://thingy.thingelstad.com">From Thingy</a>, my agentic librarian</p>',
      composed,
      '</div>',
      '',
    ].join('\n\n').trimEnd() + '\n');
  });

  it('email: the body as HTML inside the inline-styled frame', () => {
    const out = renderEmail(single());
    const tail = out.slice(out.indexOf('## Echoes'), out.indexOf('{% if medium'));
    expect(tail.match(/class="from-thingy"/g)).toHaveLength(1);
    expect(tail).toContain('<p>The Kubb tournament reached its 8th annual running this week, after <a href="https://weekly.thingelstad.com/archive/262/" target="_blank" rel="noreferrer">WT262</a>.</p><p><em>Ask Thingy:</em> <a href="https://thingy.thingelstad.com/chat/?prompt=How+has+the+Kubb+Tournament+grown%3F&amp;from=weekly-thing-350" target="_blank" rel="noreferrer">How has the Kubb Tournament grown?</a></p><p>The call for privacy regulation');
  });

  it('audio: one spoken block per paragraph, the links as their words', () => {
    const out = renderAudio(single());
    expect(out).toContain([
      'Before we go, Echoes from the archive, from Thingy, my agentic librarian.',
      'The Kubb tournament reached its 8th annual running this week, after Weekly Thing 262.',
      'Ask Thingy: How has the Kubb Tournament grown?',
      'The call for privacy regulation has a long run-up: Weekly Thing 281.',
      'Ask Thingy: What has Jamie written about privacy?',
      'That brings us to the end of The Weekly Thing, issue 350. Thanks for listening.',
    ].join('\n\n'));
  });

  it('a single body with nothing in it prints no Echoes at all', () => {
    const doc = single();
    doc.items['echoes-1']!.body = '';
    expect(renderWebsite(doc)).not.toContain('## Echoes');
    expect(renderEmail(doc)).not.toContain('## Echoes');
  });
});
