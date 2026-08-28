/** Editorial anchoring and annotation. No network. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { renderAnnotated } from '../src/shared/render/annotate.ts';
import { candidateCount, pruneStale, type Note } from '../src/server/editorial.ts';

const doc = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;

describe('annotating the edition for review', () => {
  it('marks every rendered item with its id', () => {
    const out = renderAnnotated(doc);
    expect(out).toContain('<!--item:intro-1-->');
    expect(out).toContain('<!--item:journal-concert-->');
    expect(out).toContain('<!--item:echoes-1-->');
  });

  it('omits items that are in no edition', () => {
    expect(renderAnnotated(doc)).not.toContain('<!--item:journal-excluded-->');
  });

  it('reads as the rendered edition, not the item tree', () => {
    const out = renderAnnotated(doc);
    expect(out).toContain('## Notable');
    expect(out).toContain('Fabulous show by The New Standards');
    expect(out).not.toContain('"channels"');
  });
});

describe('note anchoring', () => {
  const note = (over: Partial<Note>): Note => ({
    kind: 'PROOF', item_id: 'journal-concert', text: 'Doubled word.', ...over,
  });

  it('keeps a PROOF note whose substring is still present', () => {
    const kept = pruneStale(doc, [note({ was: 'The New Standards', now: 'the New Standards' })]);
    expect(kept).toHaveLength(1);
  });

  it('drops a PROOF note whose substring is gone — the edit already happened', () => {
    const kept = pruneStale(doc, [note({ was: 'the The New Standards', now: 'The New Standards' })]);
    expect(kept).toHaveLength(0);
  });

  it('keeps a whole-issue note, which anchors to nothing', () => {
    const kept = pruneStale(doc, [note({ kind: 'LENGTH', item_id: null, was: undefined })]);
    expect(kept).toHaveLength(1);
  });

  it('drops a note pointing at an item that no longer exists', () => {
    expect(pruneStale(doc, [note({ item_id: 'deleted-item' })])).toHaveLength(0);
  });

  it('keeps a judgement note without a substring', () => {
    expect(pruneStale(doc, [note({ kind: 'BALANCE', was: undefined })])).toHaveLength(1);
  });
});

describe('candidate counts', () => {
  it('offers three where the choice is a voice', () => {
    expect(candidateCount('membership')).toBe(3);
    expect(candidateCount('echoes')).toBe(3);
    expect(candidateCount('haiku')).toBe(3);
  });

  it('offers two for link commentary, where the want is a nudge', () => {
    expect(candidateCount('pinboard_link')).toBe(2);
  });
});
