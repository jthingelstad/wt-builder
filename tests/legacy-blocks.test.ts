/**
 * The back catalogue's scripts, as blocks. The samples span the eras: the
 * Tinyletter start (5), the rule-delimited weeks (35), MailChimp (100), the
 * first Buttondown year (150), the signed issues (250), the last of the old
 * pipeline's own renders (300), and the one midweek special.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { legacyBlocks, legacyTitle } from '../src/shared/render/legacy-blocks.ts';

const root = new URL('..', import.meta.url);
const script = (n: string | number) => readFileSync(fileURLToPath(new URL(`backfill/scripts/${n}.txt`, root)), 'utf8');
const blocks = (n: string | number) => legacyBlocks(script(n), { number: n });

const SAMPLES = [5, 35, 100, 150, 250, 300];

describe('legacyBlocks', () => {
  it('opens with the preamble as the Welcome chapter and closes with the sign-off', () => {
    for (const n of SAMPLES) {
      const b = blocks(n);
      expect(b[0]).toMatchObject({ kind: 'open', pauseBefore: 'none', chapter: { title: 'Welcome', url: `https://weekly.thingelstad.com/archive/${n}/` } });
      expect(b[0]!.text).toMatch(new RegExp(`^The Weekly Thing, issue ${n}\\.`));
      expect(b[b.length - 1]).toMatchObject({ kind: 'close', pauseBefore: 'section' });
      expect(b[b.length - 1]!.text).toMatch(/^That brings us to the end/);
    }
  });

  it('turns every section opener into a chapter on a section boundary, with a lead after it', () => {
    for (const n of SAMPLES) {
      const b = blocks(n);
      const openers = b.filter((x) => x.kind === 'transition');
      expect(openers.length).toBeGreaterThan(2);
      for (const o of openers) {
        expect(o.pauseBefore).toBe('section');
        expect(o.chapter?.title).toBeTruthy();
        expect(o.chapter?.url).toBeUndefined();
        expect(b[b.indexOf(o) + 1]!.pauseBefore).toBe('lead');
      }
      expect(b.filter((x) => x.chapter).length).toBe(openers.length + 1);
      for (const c of b.filter((x) => x.kind === 'closer')) expect(c.pauseBefore).toBe('section');
    }
  });

  it('names the sections the way the openers do', () => {
    const titles = blocks(100).filter((x) => x.chapter).map((x) => x.chapter!.title);
    expect(titles).toEqual(['Welcome', 'Featured Links', 'My Weekly Photo', 'Notable Links', 'Give Back', 'More Links', 'Microposts', 'Fortune']);
    // The two openers that are not "Now, the X section." still name a chapter.
    let fyi = 0;
    for (const n of [100, 140, 150, 200, 250]) {
      if (!script(n).includes('Now, for your information.')) continue;
      fyi += 1;
      expect(blocks(n).some((x) => x.chapter?.title === 'FYI')).toBe(true);
    }
    expect(fyi).toBeGreaterThan(0);
  });

  it('puts links, journal entries, and day labels on item boundaries', () => {
    const b = blocks(300);
    const links = b.filter((x) => /^Link \w+ of \w+\./.test(x.text));
    expect(links.length).toBe(14); // seven Notable, seven Briefly
    for (const l of links) expect(l.pauseBefore).toBe('item');
    const counts = b.filter((x) => x.text.startsWith('There are seven links this week'));
    expect(counts.length).toBe(2);
    for (const c of counts) expect(c.pauseBefore).toBe('lead');
    // The title is spoken as the current edition speaks one: separator as a comma, no quotes.
    expect(links[4]!.text).toBe("Link five of seven. Traceroute Isn't Real, Gekk.");
    const b250 = blocks(250);
    const days = b250.filter((x) => /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day @ /.test(x.text));
    expect(days.length).toBeGreaterThan(3);
    // The first label after the Journal opener sits on the lead; the rest are items.
    for (const d of days) expect(d.pauseBefore).toBe(b250[b250.indexOf(d) - 1]!.kind === 'transition' ? 'lead' : 'item');
  });

  it('never leaves markup or a line break inside a block', () => {
    for (const n of [...SAMPLES, 171, 175, '140-special']) {
      for (const x of blocks(n)) {
        expect(x.text).toBeTruthy();
        expect(x.text).not.toMatch(/\n/);
        expect(x.text).not.toMatch(/^[-*|] /);
        expect(x.text).not.toMatch(/^\|/);
        // A link title is spoken without its quote marks or its " | site" separator.
        if (x.text.startsWith('Link ')) expect(x.text).not.toMatch(/ \| |"$/);
      }
    }
  });

  it('speaks a bulleted list with ordinals, as the current edition does', () => {
    const texts = blocks(35).map((x) => x.text);
    expect(texts.some((t) => t.startsWith('First, '))).toBe(true);
    expect(texts.some((t) => t.startsWith('Second, '))).toBe(true);
  });

  it('spells the month in a photo date, which abbreviated is read as a word', () => {
    expect(blocks(35).some((x) => x.text.startsWith('December 31, twenty seventeen at 9:03 PM'))).toBe(true);
    expect(blocks(5).some((x) => x.text.startsWith('June 3, twenty seventeen, 8:49 PM'))).toBe(true);
    expect(blocks(35).some((x) => /\bDec \d/.test(x.text))).toBe(false);
  });

  it('drops the markup the transform let through as paragraphs', () => {
    for (const n of [223, 253, 256]) {
      for (const x of blocks(n)) expect(x.text).not.toMatch(/^(\*|link|[.…]+)\.?$/i);
    }
  });

  it('reads a table row by row', () => {
    const texts = blocks(175).map((x) => x.text);
    expect(texts).toContain('BTC: Stored value. I think of it as gold.');
  });

  it('recovers the rule-delimited sections of the winter 2017 issues', () => {
    const titles = blocks(35).filter((x) => x.chapter).map((x) => x.chapter!.title);
    expect(titles).toEqual(expect.arrayContaining(['Photog', 'Links']));
    expect(blocks(35).filter((x) => /^Link \w+\./.test(x.text)).length).toBeGreaterThan(8);
  });

  it('does not read an Ethereum signature aloud', () => {
    const b = blocks(250);
    expect(b.some((x) => x.chapter?.title === 'Signature')).toBe(true);
    expect(b.some((x) => /^0x[0-9a-f]{40,}$/i.test(x.text))).toBe(false);
    expect(b.some((x) => x.text.startsWith('Signed by thingelstad.eth'))).toBe(true);
    // 251–260 put the Fortune under the Signature; it is its own section again.
    const titles = blocks(253).filter((x) => x.chapter).map((x) => x.chapter!.title);
    expect(titles.slice(-2)).toEqual(['Signature', 'Fortune']);
    expect(blocks(253).some((x) => x.text === 'Fortune.')).toBe(false);
  });

  it('speaks the special as a Special Thing, at its own slug', () => {
    const b = legacyBlocks(script('140-special'), { number: '140-special', slug: 'special-thing-140-matching-donations-to-second' });
    expect(b[0]!.text).toMatch(/^The Weekly Thing, Special Thing 140\./);
    expect(b[0]!.chapter?.url).toBe('https://weekly.thingelstad.com/archive/special-thing-140-matching-donations-to-second/');
    expect(b[b.length - 1]!.text).toMatch(/Special Thing 140\./);
  });

  it('titles the mp3 from the subject, whatever shape the subject took', () => {
    expect(legacyTitle('Weekly Thing for May 13, 2017', 1)).toBe('WT1 — May 13, 2017');
    expect(legacyTitle('Weekly Thing #50 / Apr 21, 2018', 50)).toBe('WT50 — Apr 21, 2018');
    expect(legacyTitle('Weekly Thing 265 / Magic, Copilot, Shortery', 265)).toBe('WT265 — Magic, Copilot, Shortery');
    expect(legacyTitle('WT349 — Owning the Rails', 349)).toBe('WT349 — Owning the Rails');
    expect(legacyTitle('Special Thing #140 / Matching Donations to Second Harvest!', '140-special')).toBe('Special Thing 140 — Matching Donations to Second Harvest!');
    expect(legacyTitle('Weekly Thing 300 / Traceroute, 34x34x34, Typst', 300)).toBe('WT300 — Traceroute, 34x34x34, Typst');
  });
});
