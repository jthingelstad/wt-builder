/**
 * Turning written text into speakable text.
 *
 * Micro.blog post source is Markdown with raw `<img>` tags embedded — that is
 * what Jamie actually wrote, and it is correct for print. Spoken, it is a
 * disaster: TTS reads "less than i-m-g s-r-c equals h-t-t-p-s colon slash
 * slash..." aloud. Anything that is markup rather than words has to come out
 * before the script reaches the synthesizer.
 */

/** Strip markup, keeping the words a reader would actually say. */
export function speakable(text: string | undefined): string {
  let s = String(text ?? '');

  // Images carry no spoken content at all — drop them whole, alt text included,
  // because an alt string mid-sentence reads as a non-sequitur.
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  s = s.replace(/<img\b[^>]*>/gi, ' ');
  s = s.replace(/<figure\b[\s\S]*?<\/figure>/gi, ' ');

  // A link is spoken as its text; the URL is not said out loud.
  s = s.replace(/\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1');

  // Any other HTML is structure, not words.
  s = s.replace(/<br\s*\/?>/gi, ' ');
  s = s.replace(/<\/(p|div|li|h[1-6])>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');

  // Entities a reader sees as characters.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, ' and ')
    .replace(/&lt;/g, ' ')
    .replace(/&gt;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Emphasis marks are silent.
  s = s.replace(/(\*\*|__|\*|_|`)/g, '');

  // Emoji are for the eye; a synthesizer reads "☕️" as "hot beverage" or as
  // nothing, and either is wrong out loud.
  s = s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');

  // A bare URL left in prose is unspeakable; drop it rather than spell it.
  s = s.replace(/\bhttps?:\/\/\S+/gi, ' ');

  // "WT349" is print shorthand; read as letters and digits it sounds like a
  // part number (Jamie, 2026-09-21). Spoken, it is the issue's name.
  s = s.replace(/\bWT(\d{1,4})\b/g, 'Weekly Thing $1');

  // Tidy the seams left behind.
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Words the synthesizer says wrong as written, and the spelling that makes it
 * say them right. Applied to what the synthesizer is given, never to what is
 * shown: the lens and the transcript keep the real spelling.
 *
 * Empty on purpose. "Thingelstad" was respelled "Thing-el-stad" here for one
 * evening (2026-09-21) because a transcript of the plain spelling read
 * "thinglestad" — and the hyphenated form was then read aloud as the letters
 * E, L. Jamie's ear: the plain spelling was fine. A transcript cannot tell
 * letters from a syllable; only listening can. Add an entry here only after
 * hearing it.
 */
export const LEXICON: [RegExp, string][] = [];

export function pronounce(text: string): string {
  let s = text;
  for (const [from, to] of LEXICON) s = s.replace(from, to);
  return s;
}

/** True when nothing speakable survives — an empty block must not be emitted. */
export function isSilent(text: string | undefined): boolean {
  return speakable(text).length === 0;
}
