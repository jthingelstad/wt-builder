/**
 * The syllable counter behind the haiku check (src/shared/syllables.ts). It
 * is a guess from spelling, so these pin the rules it has (silent e, -ed,
 * -es, vowel groups, y, -le, numbers, punctuation, the exceptions) and the
 * haiku that matter: WT352's, the fixture's, and the prompt's examples.
 */

import { describe, expect, it } from 'vitest';

import { haikuForm, lineSyllables, spokenNumber, syllables } from '../src/shared/syllables.ts';

const counts = (words: Record<string, number>) => {
  for (const [word, n] of Object.entries(words)) expect(syllables(word), word).toBe(n);
};

describe('syllables in a word', () => {
  it('silent e, and the e that is not', () => {
    counts({ plate: 1, stays: 1, white: 1, make: 1, tree: 1, free: 1, the: 1, be: 1, apple: 2, little: 2, table: 2, acre: 2, centre: 2, theatre: 3 });
  });

  it('-ed is silent unless it follows t or d', () => {
    counts({ walked: 1, played: 1, jumped: 1, wanted: 2, needed: 2, tried: 1, carried: 2, created: 3 });
  });

  it('-es is silent unless it follows a hiss', () => {
    counts({ tokens: 2, ghosts: 1, makes: 1, boxes: 2, wishes: 2, places: 2, changes: 2, matches: 2 });
  });

  it('vowel groups, y, and the pairs that split', () => {
    counts({ boat: 1, rain: 1, great: 1, idea: 3, area: 3, radio: 3, piano: 3, quiet: 2, science: 2, nation: 2, usual: 3, quality: 3, butterfly: 3, yes: 1, happy: 2, rhythm: 2, crying: 2, being: 2 });
  });

  it('-le, -ly, -ment, -ful after a silent e', () => {
    counts({ candle: 2, lovely: 2, lonely: 2, statement: 2, hopeful: 2, careless: 2, settlement: 3 });
  });

  it('the exceptions dictionary wins', () => {
    counts({ persuade: 2, patio: 3, algorithm: 4, realism: 4, element: 3 });
  });

  it('acronyms are spelled out, punctuation and Markdown fall away', () => {
    counts({ AI: 2, QR: 2, USB: 3, NASA: 2, 'red,': 1, '**bold**': 1, '"quoted"': 2 });
    expect(lineSyllables('AWS')).toBe(5);
  });
});

describe('numbers are counted as spoken', () => {
  it('years in pairs, 2000 to 2009 whole', () => {
    expect(spokenNumber('1999')).toBe('nineteen ninety nine');
    expect(lineSyllables('1999')).toBe(5);
    expect(lineSyllables('2008')).toBe(4);
    expect(lineSyllables('2026')).toBe(5);
  });

  it('plain numbers, and & and %', () => {
    expect(lineSyllables('352')).toBe(6);
    expect(lineSyllables('7')).toBe(2);
    expect(lineSyllables('salt & pepper')).toBe(4);
    expect(lineSyllables('50%')).toBe(4);
  });

  it('hyphens split words', () => {
    expect(lineSyllables('Hand-drawn')).toBe(2);
    expect(lineSyllables('long-awaited')).toBe(4);
  });
});

describe('the haiku form', () => {
  it("WT352's haiku is 5-7-5", () => {
    const form = haikuForm('White ghosts on the plate,\na red bar where tokens were —\nbutterfly stays put.');
    expect(form).toEqual({ counts: [5, 7, 5], shape: '5-7-5', ok: true });
  });

  it("the fixture's haiku and the prompt's examples are 5-7-5", () => {
    for (const text of [
      'Summer pages turn\nEach item finds its own place\nOld echoes return',
      'Hand-drawn QR dreams,\nRedis arrays tell stories —\nDads learn to listen',
      'Coffee stirs the gut\nWhile AI dreams in the night\nBoth keep us awake',
    ]) expect(haikuForm(text).ok, text).toBe(true);
  });

  it('a short line says what it counted', () => {
    expect(haikuForm('White ghosts on the plate,\na red bar where tokens —\nbutterfly stays put.').shape).toBe('5-6-5');
  });

  it('Markdown line breaks and blank lines do not count as lines', () => {
    expect(haikuForm('White ghosts on the plate,\\\n\na red bar where tokens were —\\\nbutterfly stays put.\n').ok).toBe(true);
  });

  it('two lines or four are not a haiku', () => {
    expect(haikuForm('White ghosts on the plate,\na red bar where tokens were')).toMatchObject({ counts: [5, 7], ok: false });
    expect(haikuForm('a\nb\nc\nd').ok).toBe(false);
  });
});
