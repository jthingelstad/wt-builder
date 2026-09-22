/**
 * The back catalogue, as blocks.
 *
 * Issues 1–349 were never authored here. Their spoken scripts come from the
 * archive's Markdown through the retired Studio transform (`backfill/`): one
 * flat text per issue with a regular cue vocabulary — section openers and
 * closers, numbered links and journal entries, framed quotes. That regularity
 * is enough to put every block on the boundary the assembler expects, and to
 * open a chapter at every section. Chapters are title-only: the links of a
 * nine-year back catalogue are not worth a chapter each (Jamie, 2026-09-22).
 *
 * What the scripts say is not changed here, with three exceptions that are
 * about how they sound: a list is spoken with ordinals as the current edition
 * speaks one, a Markdown table is read row by row, and the Ethereum
 * signatures a run of 2023 issues printed are not read out as hex.
 */

import type { Boundary, ScriptBlock } from './audio.ts';
import { ISSUE_URL_BASE, prosePieces, spokenTitle, terminate } from './audio.ts';

/** The transform's own cues, as it writes them. */
// Exactly the transform's three opener shapes; a paragraph of prose that
// happens to begin "Now, …" (WT250) is not one, so a name has no sentence
// punctuation in it.
const SECTION_OPEN = /^Now, (?:the ([^.?!]+?) section|(more links)|(for your information))\.$/;
const SECTION_CLOSE = /^That's the end of [^.?!]+\.$/;
const CLOSING = /^That brings us to the end of the Weekly Thing/;
const NUMBER = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?: [a-z]+)?';
const ITEM = new RegExp(`^(?:Link ${NUMBER}(?: of ${NUMBER})?\\.|Journal entry ${NUMBER}\\.)(?=\\s|$)`);
/** A link cue with its quoted title: the title is spoken as the current edition speaks one. */
const LINK_CUE = new RegExp(`^(Link ${NUMBER}(?: of ${NUMBER})?\\.) "(.+)"$`, 's');
const DAY_LABEL = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) @ \d{1,2}:\d{2} [AP]M$/;
const TABLE = /^\|.*\|\s*$/;
const TABLE_RULE = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;
const HEX_SIGNATURE = /^0x[0-9a-f]{40,}$/i;

/** "Dec 31, twenty seventeen at 9:03 PM" — the photo's date, month abbreviated; read as a word it is "desk". */
const MONTH_ABBR = /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? (?=\d{1,2},? )/g;
const MONTHS: Record<string, string> = {
  Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', Jun: 'June', Jul: 'July', Aug: 'August',
  Sep: 'September', Sept: 'September', Oct: 'October', Nov: 'November', Dec: 'December',
};
const monthsSpelled = (text: string) => text.replace(MONTH_ABBR, (_m, abbr: string) => `${MONTHS[abbr]} `);

/** Openers whose spoken form is not "Now, the X section." */
const SECTION_TITLES: Record<string, string> = {
  'more links': 'More Links',
  'for your information': 'FYI',
};

export interface LegacyIssue {
  /** The issue number, or `140-special`. */
  number: number | string;
  /** The archive page's slug when it is not the number (`140-special` is not). */
  slug?: string;
}

/** A Markdown table, one row per piece: the header as a list, each row as "key: value". */
function tablePieces(paragraph: string): { text: string; boundary: Boundary }[] {
  const rows = paragraph
    .split('\n')
    .filter((line) => TABLE.test(line) && !TABLE_RULE.test(line))
    .map((line) => line.trim().slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean));
  return rows
    .map((cells, i) => (i === 0 || cells.length !== 2 ? cells.join(', ') : `${cells[0]}: ${cells[1]}`))
    .map((text) => ({ text: terminate(text), boundary: 'paragraph' as const }))
    .filter((p) => p.text);
}

function piecesOf(paragraph: string): { text: string; boundary: Boundary }[] {
  if (TABLE.test(paragraph.split('\n')[0]!)) return tablePieces(paragraph);
  return prosePieces(paragraph);
}

export function legacyBlocks(script: string, issue: LegacyIssue): ScriptBlock[] {
  const paragraphs = script.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
  const out: ScriptBlock[] = [];
  let afterOpener = false;
  let section: string | null = null;

  for (const [i, paragraph] of paragraphs.entries()) {
    if (i === 0) {
      out.push({
        kind: 'open', text: terminate(paragraph), pauseBefore: 'none',
        chapter: { title: 'Welcome', url: `${ISSUE_URL_BASE}${issue.slug ?? issue.number}/` },
      });
      afterOpener = true;
      continue;
    }
    const open = SECTION_OPEN.exec(paragraph);
    if (open) {
      const named = (open[1] ?? open[2] ?? open[3])!;
      section = SECTION_TITLES[named.toLowerCase()] ?? named;
      out.push({ kind: 'transition', text: paragraph, pauseBefore: 'section', chapter: { title: section } });
      afterOpener = true;
      continue;
    }
    if (SECTION_CLOSE.test(paragraph)) {
      out.push({ kind: 'closer', text: paragraph, pauseBefore: 'section' });
      afterOpener = false;
      section = null;
      continue;
    }
    if (CLOSING.test(paragraph)) {
      out.push({ kind: 'close', text: paragraph, pauseBefore: 'section' });
      afterOpener = false;
      continue;
    }
    // A signature is proof for the eye; read aloud it is a minute of hex.
    if (section === 'Signature' && HEX_SIGNATURE.test(paragraph)) continue;
    // Issues 251–260 set the Fortune as a subheading of the Signature, which
    // the transform spoke as a bare word. It is the Fortune section, as in
    // every other issue: close the one, open the other.
    if (section === 'Signature' && paragraph === 'Fortune') {
      out.push({ kind: 'closer', text: "That's the end of Signature.", pauseBefore: 'section' });
      section = 'Fortune';
      out.push({ kind: 'transition', text: 'Now, the Fortune section.', pauseBefore: 'section', chapter: { title: section } });
      afterOpener = true;
      continue;
    }

    const first: Boundary = afterOpener ? 'lead' : ITEM.test(paragraph) || DAY_LABEL.test(paragraph) ? 'item' : 'paragraph';
    afterOpener = false;
    // "Link one of seven. Traceroute Isn't Real, Gekk." — the separator
    // spoken as a comma, the quotes not spoken at all (WT350, 2026-09-21).
    const link = LINK_CUE.exec(paragraph);
    if (link) {
      const title = spokenTitle(link[2]);
      out.push({ kind: 'cue', text: `${link[1]} ${title}`, pauseBefore: first, title });
      continue;
    }
    for (const [j, piece] of piecesOf(paragraph).entries()) {
      out.push({ kind: 'cue', text: monthsSpelled(piece.text), pauseBefore: j === 0 ? first : piece.boundary });
    }
  }
  return out;
}

/**
 * The ID3 title, from the archive's subject line, in the form the current
 * edition uses: "WT50 — Apr 21, 2018". The subjects changed shape over the
 * years — "Weekly Thing for May 13, 2017", "Weekly Thing #50 / Apr 21, 2018",
 * "Weekly Thing 265 / Magic, Copilot, Shortery", "WT350 — Builders…" — and
 * the one special is "Special Thing #140 / Matching Donations…".
 */
export function legacyTitle(subject: string, number: number | string): string {
  const special = /^(\d+)-special$/.exec(String(number));
  const name = special ? `Special Thing ${special[1]}` : `WT${number}`;
  const tail = subject
    .replace(/^(?:The )?(?:Weekly|Special) Thing\s*(?:#?\d+|for)?\s*(?:\/|—|-|:)?\s*/i, '')
    .replace(/^WT\d+\s*(?:—|-)?\s*/i, '')
    .trim();
  return tail ? `${name} — ${tail}` : name;
}

