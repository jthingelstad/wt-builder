/** Composing the Echoes section from selected units. Pure — no model. */

import { describe, expect, it } from 'vitest';

import { composeEchoes } from '../src/shared/echoes.ts';

const wt = (n: number) => ({
  kind: 'issue' as const,
  issue: n,
  url: `https://weekly.thingelstad.com/archive/${n}/`,
});

describe('composing selected echoes', () => {
  it('each echo is its own paragraph, in offered order', () => {
    const { body } = composeEchoes([
      { text: 'The boat went in, as it has every May since [WT221](https://weekly.thingelstad.com/archive/221/).', archive_references: [wt(221)] },
      { text: 'The rails ran through [WT261](https://weekly.thingelstad.com/archive/261/) too.', archive_references: [wt(261)] },
    ]);
    expect(body.split('\n\n')).toHaveLength(2);
    expect(body.indexOf('boat')).toBeLessThan(body.indexOf('rails'));
  });

  it('pools citations in order, deduped by url', () => {
    const { archive_references } = composeEchoes([
      { text: 'a', archive_references: [wt(221), wt(261)] },
      { text: 'b', archive_references: [wt(261), wt(337)] },
    ]);
    expect(archive_references.map((r) => r.issue)).toEqual([221, 261, 337]);
  });

  it('one selected echo is a one-paragraph section', () => {
    const { body, archive_references } = composeEchoes([
      { text: '  Just this one.  ', archive_references: [wt(196)] },
    ]);
    expect(body).toBe('Just this one.');
    expect(archive_references).toHaveLength(1);
  });

  it('empty selection composes nothing', () => {
    const { body, archive_references } = composeEchoes([]);
    expect(body).toBe('');
    expect(archive_references).toEqual([]);
  });
});

describe('each echo carries a door into Thingy', () => {
  it('renders the question as a link that opens Thingy with it asked, attributed to the issue', async () => {
    const { composeEchoes, askThingyUrl } = await import('../src/shared/echoes.ts');
    const { body } = composeEchoes([
      { text: 'Code review came up in [WT210](https://weekly.thingelstad.com/archive/210/).', archive_references: [], ask: "How has Jamie's view of code review changed?" },
      { text: 'A thread with no question.', archive_references: [] },
    ], 350);
    const url = askThingyUrl("How has Jamie's view of code review changed?", 350);
    expect(url.startsWith('https://thingy.thingelstad.com/chat/?prompt=')).toBe(true);
    expect(url).toContain('from=weekly-thing-350');
    expect(body).toContain(`_Ask Thingy:_ [How has Jamie's view of code review changed?](${url})`);
    expect(body.endsWith('A thread with no question.')).toBe(true);
  });
});
