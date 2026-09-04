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
