/**
 * The audio edition.
 *
 * Every word in the script is spoken. Section transitions are script lines, not
 * markers — a line that appears here and is not read aloud is a bug
 * (docs/rendering-contracts.md, Audio).
 *
 * The blank line between blocks is not a pause. The synthesizer does not
 * honour it: measured against WT350's transcript (2026-09-21) the gap before a
 * block ran 0.0–1.6 s with no relation to structure — a section opener got
 * none, a Journal day label none, two posts ran together. So every block
 * carries the boundary it sits on, and the assembler
 * (`server/integrations/audio.ts`) synthesizes blocks one at a time and puts
 * silence of that boundary's length between them. The renderer decides where
 * the pauses are; the assembler decides how long.
 */

import type { IssueDoc, Item } from '../types.ts';
import { spokenLongDate, wallClock, weekday } from '../dates.ts';
import { askThingyUrl, echoBlock } from '../echoes.ts';
import type { PlannedNode } from './plan.ts';
import { bodyLines, isLinkSection, planEdition, postBlocks, withRehostedImages } from './plan.ts';
import { speakable } from './speech.ts';

/**
 * What sits between a block and the one before it. The assembler maps each to
 * a length of silence; the names are the structure, so a change of taste is
 * one table edit there and no change here.
 */
export type Boundary =
  /** The first block of the programme. */
  | 'none'
  /** Before a section opener or closer, the opening, and the close. */
  | 'section'
  /** The first block after an opener: a beat, then the content. */
  | 'lead'
  /** Between items: link to link, post to post, a Journal day label. */
  | 'item'
  /** Between the paragraphs, list entries, and quote edges of one item. */
  | 'paragraph'
  /** Between the lines of a haiku. */
  | 'line';

/**
 * A chapter mark, for the players that show them. A link item's chapter
 * carries its URL — the podcast could never hand a listener the links, and
 * this is how it does. An image is shown, never described.
 */
export interface Chapter {
  title: string;
  url?: string;
  image?: string;
}

export type Speaker = 'jamie' | 'thingy';

/**
 * One block of the script, tagged with what it is.
 *
 * The Audio lens renders these rather than re-deriving the script, so what
 * Jamie reads on screen is the text that will actually be synthesized. A lens
 * that built its own version of the script could drift from the mp3.
 */
export interface ScriptBlock {
  kind: 'open' | 'transition' | 'closer' | 'cue' | 'close';
  text: string;
  pauseBefore: Boundary;
  /** The node this block came from, for the lens's anchors. */
  nodeId?: string;
  itemId?: string;
  /**
   * A Briefly link speaks title-first while the page prints
   * description-first; the lens highlights the title and says so once.
   */
  reversed?: boolean;
  /** The spoken title, so the lens can highlight exactly that span. */
  title?: string;
  /** Who says it. Thingy's blocks are synthesized in Thingy's voice; absent means Jamie. */
  speaker?: Speaker;
  /** This block begins a chapter. */
  chapter?: Chapter;
}

export const ISSUE_URL_BASE = 'https://weekly.thingelstad.com/archive/';
export const MEMBERS_URL = 'https://weekly.thingelstad.com/members/';
/**
 * Thingy's portrait — the identity image the site and the chat use — shown as
 * the chapter art whenever Thingy is the one speaking (Jamie, 2026-09-21).
 * Attribution the listener can see as well as hear.
 */
export const THINGY_IMAGE = 'https://weekly.thingelstad.com/img/thingy.png';

/** The site, spelled out; the assembler's lexicon handles the surname. */
export const SPOKEN_SITE = 'weekly dot thingelstad dot com';

export const HAIKU_TRANSITION = "And to close, this week's haiku.";
export const HAIKU_TRANSITION_MID = "This week's haiku.";

/** Jamie hands over; Thingy introduces itself in its own voice, then speaks. */
export const MEMBERSHIP_TRANSITION = 'Next, a word about membership, from Thingy, my agentic librarian.';
export const ECHOES_TRANSITION = 'Before we go, Echoes from the archive, from Thingy, my agentic librarian.';
export const THINGY_HELLO = 'Hello, this is Thingy.';

/**
 * The opening carries what the retired intro bumper said — that this is
 * generated, and where the newsletter is — plus the issue's own identity,
 * which Studio spoke and the bumper could not. Two blocks: the issue, then
 * the note about the edition.
 */
export function opening(doc: IssueDoc): string[] {
  const n = doc.issue.number;
  const title = editorialTitle(doc);
  const w = wallClock(doc.issue.publication_date);
  const when = w ? `${spokenLongDate(w)}, ${w.y}` : '';
  const identity = title ? `This is The Weekly Thing, issue ${n}: ${terminate(title)}` : `This is The Weekly Thing, issue ${n}.`;
  const published = when ? `Published ${when}, and written by Jamie Thingelstad.` : 'Written by Jamie Thingelstad.';
  return [
    `${identity} ${published}`,
    `This audio edition is generated. Every link and photo is in the newsletter at ${SPOKEN_SITE}, where you can also sign up for the email.`,
  ];
}

/** One sentence after the last section — Echoes stays the last thing said before it. */
export function closing(issueNumber: number): string {
  return `That brings us to the end of The Weekly Thing, issue ${issueNumber}. Thanks for listening.`;
}

/** The title without the issue's own name, or nothing when that is all there is. */
function editorialTitle(doc: IssueDoc): string {
  const n = doc.issue.number;
  const t = String(doc.issue.title ?? '')
    .replace(/^The Weekly Thing\b/i, '')
    .replace(/^\s*(?:#|WT)?\s*/i, '')
    .trim();
  return !t || t === String(n) ? '' : t;
}

/** Add a full stop unless the text already ends in terminal punctuation. */
export function terminate(text: string): string {
  const t = speakable(text).trim().replace(/[:;,]$/, '.');
  if (!t) return '';
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * A title as it should be said. Page titles carry their site or tagline after
 * a separator — "Your car is selling your data | The Verge", "Monarch -
 * Spotlight Search with Superpowers" — and 55% of the links since WT300 do.
 * Which of the two it is cannot be told apart (716 distinct hosts across
 * 1,112 links, 617 seen once), and neither needs to be: spoken as an aside
 * after a comma, a source and a tagline both read as what they are.
 */
export function spokenTitle(title: string | undefined): string {
  // After a question or exclamation the aside needs no comma: "…reviews? Gergely Orosz."
  // An em or en dash separates even with no space after it ("…Blind —Bridget
  // Kromhout", the 2017 archive); a hyphen needs space on both sides or it is
  // a compound word.
  const spoken = String(title ?? '').replace(/([^\s])\s+(?:\|\s+|-\s+|[–—]\s*)/g, (_m, last: string) =>
    /[.!?…]/.test(last) ? `${last} ` : `${last}, `);
  return terminate(spoken);
}

const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

function countWord(n: number): string {
  return COUNT[n] ?? String(n);
}

/** One spoken piece of an item, with the boundary it sits on inside the item. */
interface Piece {
  text: string;
  boundary: Boundary;
}

const LIST_MARK = /^\s*(?:([-*+])|(\d{1,9})[.)])\s+/;
const QUOTE_MARK = /^>\s?/;

/**
 * Prose as spoken pieces: one per paragraph, so the pauses fall where the
 * paragraph breaks are. Print structure is turned into speech rather than
 * dropped:
 *
 * - A blockquote is framed "Quote." … "End quote." — without the frame a
 *   quoted author's words are indistinguishable from Jamie's (WT350's Voss
 *   quotes were). A multi-paragraph quote keeps its paragraph pauses.
 * - A bulleted list speaks each entry with an ordinal — "First," "Second," —
 *   because that is how a person reads a list aloud; a numbered list says the
 *   number as written. Each entry is its own piece.
 * - A heading is spoken, on an item boundary, with a lead after it.
 * - Emphasis and links are their words; images are nothing.
 */
export function prosePieces(body: string | undefined): Piece[] {
  const out: Piece[] = [];
  let afterHeading = false;
  for (const block of splitMixed(postBlocks(body))) {
    const lines = block.split('\n');
    const first: Boundary = afterHeading ? 'lead' : 'paragraph';
    afterHeading = false;

    if (QUOTE_MARK.test(block)) {
      const inner = lines.map((l) => l.replace(QUOTE_MARK, '')).join('\n');
      const paras = inner.split(/\n\s*\n/).map((p) => terminate(p.replace(/\s*\n\s*/g, ' '))).filter(Boolean);
      if (!paras.length) continue;
      paras[0] = `Quote. ${paras[0]}`;
      paras[paras.length - 1] = `${paras[paras.length - 1]} End quote.`;
      paras.forEach((text, i) => out.push({ text, boundary: i === 0 ? first : 'paragraph' }));
      continue;
    }

    if (LIST_MARK.test(block)) {
      // Continuation lines (indented, no marker) belong to the entry above.
      const entries: { ordered: string | null; text: string }[] = [];
      for (const l of lines) {
        const m = LIST_MARK.exec(l);
        if (m) entries.push({ ordered: m[2] ?? null, text: l.slice(m[0].length) });
        else if (entries.length && l.trim()) entries[entries.length - 1]!.text += ` ${l.trim()}`;
      }
      let i = 0;
      for (const e of entries) {
        const text = terminate(e.text);
        if (!text) continue;
        // "First, it is summer" — the entry continues the ordinal's sentence,
        // so a capitalised common word steps down. "I", "AI", "DevOps" stay.
        const spoken = e.ordered !== null ? text : text.replace(/^[A-Z](?=[a-z]+(?:\s|[.,!?;:]|$))/, (c) => c.toLowerCase());
        const lead = e.ordered !== null ? `${e.ordered}.` : `${ORDINAL[i] ?? `Number ${i + 1}`},`;
        out.push({ text: `${lead} ${spoken}`, boundary: i === 0 ? first : 'paragraph' });
        i += 1;
      }
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(block);
    if (heading) {
      const text = terminate(heading[1]!);
      if (text) {
        out.push({ text, boundary: 'item' });
        afterHeading = true;
      }
      continue;
    }

    const text = terminate(block.replace(/\s*\n\s*/g, ' '));
    if (text) out.push({ text, boundary: first });
  }
  return out;
}

/**
 * A list written straight under its lead-in with no blank line between is
 * one Markdown block; spoken, the lead-in is a paragraph and the list is a
 * list. Cut such a block where the first marker appears.
 */
function splitMixed(blocks: string[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => LIST_MARK.test(l));
    if (at > 0 && !QUOTE_MARK.test(block)) {
      out.push(lines.slice(0, at).join('\n'), lines.slice(at).join('\n'));
    } else {
      out.push(block);
    }
  }
  return out;
}

/** Prose with a spoken lead-in welded onto its first piece. */
function withLead(lead: string, pieces: Piece[]): Piece[] {
  if (!pieces.length) return lead ? [{ text: lead, boundary: 'paragraph' }] : [];
  const [head, ...rest] = pieces;
  return [{ text: [lead, head!.text].filter(Boolean).join(' '), boundary: head!.boundary }, ...rest];
}

/** "Link 1 of 5. Title. Commentary." — the count is of items in this edition. */
export function linkBlock(item: Item, index: number, total: number): string {
  return linkPieces(item, index, total)[0]?.text ?? '';
}

function linkPieces(item: Item, index: number, total: number): Piece[] {
  return withLead(`Link ${index} of ${total}. ${spokenTitle(item.title)}`.trim(), prosePieces(item.commentary));
}

/** US state codes as a reader says them; a synthesizer spells "MN". */
const STATE: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'Washington, D.C.',
};

/** "Falcon Heights, MN" → "Falcon Heights, Minnesota". */
export function spokenPlace(location: string | undefined): string {
  return String(location ?? '').trim().replace(/,\s*([A-Z]{2})$/, (_m, code: string) => `, ${STATE[code] ?? code}`);
}

/**
 * The photo speaks its caption — Jamie's words — then where and when it was
 * taken. Never a description: the picture itself is shown as the chapter's
 * art, which is where it belongs (Jamie, 2026-09-21).
 */
function photoPieces(item: Item): Piece[] {
  const caption = terminate(item.media?.caption ?? item.body ?? '');
  if (!caption) return [];
  const where = spokenPlace(item.media?.location);
  const w = wallClock(item.media?.timestamp);
  const when = w ? spokenLongDate(w) : '';
  const taken = where && when ? `Taken in ${where}, on ${when}.` : where ? `Taken in ${where}.` : when ? `Taken on ${when}.` : '';
  const pieces: Piece[] = [{ text: `This week's photo. ${caption}`, boundary: 'paragraph' }];
  if (taken) pieces.push({ text: taken, boundary: 'paragraph' });
  return pieces;
}

function itemPieces(item: Item, planned: PlannedNode, index: number, total: number): Piece[] {
  switch (item.type) {
    case 'currently': {
      // A label with no value is a half-written entry, not a spoken line.
      const value = terminate(bodyLines(item.body).join(' '));
      return value ? [{ text: `${item.label}: ${value}`, boundary: 'paragraph' }] : [];
    }
    case 'haiku':
      // One line per piece, so the pauses fall where the line breaks are.
      return bodyLines(item.body).map(speakable).filter(Boolean).map((text) => ({ text, boundary: 'line' }));
    case 'pinboard_link': {
      if (isLinkSection(planned.node)) return linkPieces(item, index, total);
      const commentary = prosePieces(item.commentary);
      if (commentary.length) return commentary;
      const title = spokenTitle(item.title);
      return title ? [{ text: title, boundary: 'paragraph' }] : [];
    }
    case 'journal_post':
      // A promoted post is an article and opens with its own transition; a
      // Journal moment leads with its title, when it has one.
      return item.presentation === 'promoted'
        ? prosePieces(item.body)
        : withLead(item.title ? terminate(item.title) : '', prosePieces(item.body));
    case 'photo':
      return photoPieces(item);
    case 'echo':
      // The thread, then the question — spoken as the single-body Echoes
      // always was: the link's words, never its URL.
      return prosePieces(echoBlock(item));
    default:
      return prosePieces(item.body);
  }
}

/** The first `<img>` or Markdown image in a body, pointed at the CDN copy. */
function firstImage(doc: IssueDoc, body: string | undefined): string | undefined {
  const s = String(body ?? '');
  const m = /<img\b[^>]*\ssrc=["']([^"']+)["']/i.exec(s) ?? /!\[[^\]]*\]\(([^)\s]+)/.exec(s);
  return m ? withRehostedImages(doc, m[1]!) : undefined;
}

/** A Journal moment's chapter title: its title, or its first sentence, clipped. */
function chapterTitle(item: Item): string {
  const t = String(item.title ?? '').trim();
  if (t) return t;
  const text = speakable(bodyLines(item.body).join(' '));
  const sentence = /^(.*?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return sentence.length > 70 ? `${sentence.slice(0, 67).trimEnd()}…` : sentence;
}

/** The chapter an item opens, or none for items that ride their section's. */
function chapterFor(doc: IssueDoc, item: Item, planned: PlannedNode): Chapter | undefined {
  switch (item.type) {
    case 'pinboard_link':
      return { title: String(item.title ?? '').trim() || 'Link', url: item.source_url };
    case 'journal_post': {
      const image = firstImage(doc, item.body);
      return { title: chapterTitle(item), url: item.source_url, ...(image ? { image } : {}) };
    }
    case 'photo': {
      const image = item.media?.url ? withRehostedImages(doc, item.media.url) : undefined;
      return { title: "This week's photo", url: `${ISSUE_URL_BASE}${doc.issue.number}/`, ...(image ? { image } : {}) };
    }
    case 'echo': {
      const ask = String(item.ask ?? '').trim();
      return ask ? { title: ask, url: askThingyUrl(ask, doc.issue.number), image: THINGY_IMAGE } : undefined;
    }
    case 'echoes':
      return { title: planned.node.label, image: THINGY_IMAGE };
    case 'membership':
      return { title: 'Supporting Membership', url: `${MEMBERS_URL}?ref=WT${doc.issue.number}-audio`, image: THINGY_IMAGE };
    default:
      // Intro rides the Welcome chapter; a headed section's items ride its
      // opener. The unheaded ones — Outro, a Quote — are their own.
      if (item.type === 'intro' || planned.node.publishes_heading) return undefined;
      return { title: planned.node.label };
  }
}

/**
 * The spoken transition into a node, or null where the content carries itself.
 * Intro, Outro, and Markdown blocks simply continue. A link section says how
 * many links follow — the listener's map of the next few minutes.
 */
export function transitionFor(planned: PlannedNode, opts: { last?: boolean } = {}): string | null {
  const { node, items } = planned;

  if (node.type === 'haiku') return opts.last ? HAIKU_TRANSITION : HAIKU_TRANSITION_MID;
  if (node.type === 'membership') return MEMBERSHIP_TRANSITION;
  if (node.type === 'echoes') return ECHOES_TRANSITION;

  if (node.kind === 'promoted_item') {
    const title = items[0]?.item.title ?? node.label;
    return `Next, a longer piece: ${spokenTitle(title)}`;
  }

  if (isLinkSection(node)) {
    const n = items.length;
    const links = n === 1 ? 'One link this week.' : `${capitalize(countWord(n))} links this week.`;
    return `Now, the ${node.label} section. ${links}`;
  }
  if (node.publishes_heading) return `Now, the ${node.label} section.`;
  return null;
}

/**
 * The spoken close of a long node, or null for one short enough to need none.
 * The ear needs the end of a section as much as the start of the next: with
 * only openers, WT350's essay began 0.9 s after the last Notable link and
 * nothing said the section had changed.
 */
export function closerFor(planned: PlannedNode): string | null {
  const { node, items } = planned;
  if (node.kind === 'promoted_item') {
    const title = items[0]?.item.title ?? node.label;
    return `That's the end of ${spokenTitle(title)}`;
  }
  if (isLinkSection(node)) return `That's the end of ${node.label}.`;
  if (node.type === 'journal') return "That's the end of the Journal.";
  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function audioScript(doc: IssueDoc): ScriptBlock[] {
  const n = doc.issue.number;
  const [identity, note] = opening(doc);
  const script: ScriptBlock[] = [
    { kind: 'open', text: identity!, pauseBefore: 'none', chapter: { title: 'Welcome', url: `${ISSUE_URL_BASE}${n}/` } },
    { kind: 'open', text: note!, pauseBefore: 'paragraph' },
  ];

  const edition = planEdition(doc, 'audio');
  edition.forEach((planned, nodeIndex) => {
    const total = planned.items.length;
    const briefly = String(planned.node.type) === 'briefly';

    /** One item's pieces as blocks; the first sits on an item boundary and opens the item's chapter. */
    const blocksFor = (entry: { id: string; item: Item }, index: number): ScriptBlock[] =>
      itemPieces(entry.item, planned, index, total).map((p, i) => {
        const block: ScriptBlock = {
          kind: 'cue', text: p.text, pauseBefore: i === 0 ? 'item' : p.boundary,
          nodeId: planned.node.id, itemId: entry.id,
        };
        if (entry.item.authorship === 'Thingy') block.speaker = 'thingy';
        if (briefly && entry.item.type === 'pinboard_link') {
          block.reversed = true;
          block.title = spokenTitle(entry.item.title);
        }
        if (i === 0) {
          const chapter = chapterFor(doc, entry.item, planned);
          if (chapter) block.chapter = chapter;
        }
        return block;
      });

    const spoken: ScriptBlock[] = [];
    if (planned.groups) {
      for (const group of planned.groups) {
        const groupBlocks = group.items.flatMap((entry) => blocksFor(entry, 0));
        if (!groupBlocks.length) continue;
        if (group.weekday) {
          // Spoken long — "Saturday, August twenty-ninth" — because a bare
          // number through a synthesizer is a coin flip.
          const w = wallClock(group.key);
          spoken.push({
            kind: 'cue', text: terminate(w ? spokenLongDate(w) : group.weekday),
            pauseBefore: 'item', nodeId: planned.node.id,
          });
          groupBlocks[0]!.pauseBefore = 'lead';
        }
        spoken.push(...groupBlocks);
      }
    } else {
      planned.items.forEach((entry, i) => spoken.push(...blocksFor(entry, i + 1)));
    }
    if (!spoken.length) return;

    const last = nodeIndex === edition.length - 1;
    const transition = transitionFor(planned, { last });
    if (transition) {
      const opener: ScriptBlock = {
        kind: 'transition', text: transition, pauseBefore: 'section', nodeId: planned.node.id,
        chapter: { title: planned.node.label, ...(planned.node.type === 'echoes' ? { image: THINGY_IMAGE } : {}) },
      };
      // A section of one item — the essay, Membership — is one chapter, and
      // the item's (with its URL) is the better one; it starts at the opener.
      if (planned.items.length === 1 && spoken[0]!.chapter) {
        opener.chapter = spoken[0]!.chapter;
        delete spoken[0]!.chapter;
      }
      script.push(opener);
      spoken[0]!.pauseBefore = 'lead';
    } else {
      // No opener: the section still gets its beat from what came before.
      spoken[0]!.pauseBefore = 'section';
    }
    // Thingy introduces itself before its first words, in its own voice —
    // once an episode; a second hello would be a stranger.
    if (spoken.some((b) => b.speaker === 'thingy') && !script.some((b) => b.speaker === 'thingy')) {
      script.push({ kind: 'transition', text: THINGY_HELLO, pauseBefore: 'lead', nodeId: planned.node.id, speaker: 'thingy' });
      spoken[0]!.pauseBefore = 'paragraph';
    }
    script.push(...spoken);

    const closer = closerFor(planned);
    if (closer) script.push({ kind: 'closer', text: closer, pauseBefore: 'section', nodeId: planned.node.id });
  });

  script.push({ kind: 'close', text: closing(n), pauseBefore: 'section' });
  return script.filter((b) => b.text.trim().length > 0);
}

/**
 * The synthesized script is the lens's script, joined. One walk produces both
 * — this used to be a second copy of the walk above, which meant the screen
 * could drift from the mp3 while claiming it could not.
 */
export function renderAudio(doc: IssueDoc): string {
  return audioScript(doc).map((b) => b.text).join('\n\n') + '\n';
}

/** Spoken date form, used by the podcast description rather than the script. */
export function spokenDate(iso: string): string {
  const w = wallClock(iso);
  return w ? `${weekday(w)}` : '';
}
