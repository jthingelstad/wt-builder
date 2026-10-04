/**
 * Syllables, counted the way an English speaker would say them, closely
 * enough to tell a haiku from three short lines.
 *
 * WT352's generated haiku was not 5-7-5 and nearly went out; Jamie, 2026-10-04:
 * "we should build an evaluator on that to have it generate and then check --
 * i don't want to have a non-haiku sent". This is that check. It is a
 * heuristic — English spelling does not say how a word is spoken — so a
 * result is shown with its counts ("5-6-5") and never gates anything: Jamie
 * can see where it disagrees with his ear and carry on.
 *
 * Pure, and on both sides: the wand filters candidates with it on the server,
 * and the editor's row hint and the review read the same counts.
 *
 * The rules, in order: a word the rules get wrong is looked up (EXCEPTIONS);
 * a known compound or a silent-e stem before a suffix is counted in parts;
 * then vowel groups are counted, with y a vowel except before a vowel or at
 * the start, a silent final e dropped (but not "-le" or "-re" after a
 * consonant: "table", "acre"), "-ed" silent except after t or d, "-es" silent
 * except after a sibilant ("pages", "boxes"), and a few vowel pairs that are
 * two syllables ("radio", "media", "stadium", "being"). Numbers are spoken
 * ("10" is "ten"), an all-capital short word is spelled ("AI", "MCP"), and
 * punctuation, dashes and Markdown marks are not words.
 */

/** Words the rules miscount, with how they are said. Lowercase, letters only. */
const EXCEPTIONS: Record<string, number> = {
  // a silent-looking final e that is spoken
  recipe: 3, maybe: 2, apostrophe: 4, catastrophe: 4, acne: 2, cafe: 2, karate: 3,
  simile: 3, anemone: 4, coyote: 3, sesame: 3, adobe: 3, finale: 3, epitome: 4,
  persuade: 2, forte: 2, posse: 2, hyperbole: 4, sake: 1, abalone: 4, extempore: 4,
  // vowel pairs said as two
  idea: 3, ideas: 3, area: 3, areas: 3, create: 2, created: 3, creates: 2, creating: 3,
  creative: 3, creation: 3, react: 2, reality: 4, realize: 3, video: 3, videos: 3,
  rodeo: 3, stereo: 3, radio: 3, piano: 3, quiet: 2, quietly: 3, science: 2, client: 2,
  clients: 2, diet: 2, poem: 2, poems: 2, poet: 2, poetry: 3, lion: 2, giant: 2, ruin: 2,
  ruins: 2, fluid: 2, cruel: 2, fuel: 2, dual: 2, duel: 2, being: 2, beings: 2,
  chaos: 2, oasis: 3, naive: 2, cooperate: 4, coordinate: 4, reunion: 3, neon: 2,
  museum: 3, theory: 3, theater: 3, theatre: 3, geography: 4, geometry: 4, iowa: 3,
  hawaii: 3, ohio: 3, deity: 3, archaic: 3, mosaic: 3, prosaic: 3, genuine: 3,
  // vowel pairs said as one
  million: 2, millions: 2, billion: 2, billions: 2, onion: 2, union: 2, opinion: 3,
  companion: 3, familiar: 3, brilliant: 2, william: 2, junior: 2, senior: 2,
  aisle: 1, isle: 1, every: 2, everything: 3, everyone: 3, everywhere: 3, evening: 2,
  different: 2, business: 2, family: 3, chocolate: 2, interesting: 3, vegetable: 3,
  camera: 3, several: 2, favorite: 3, general: 3, natural: 3, temperature: 4,
  comfortable: 3, restaurant: 3, wednesday: 2, february: 4, colonel: 2, choir: 1,
  arent: 1, werent: 1, element: 3, elements: 3,
  // -ed spoken
  hundred: 2, hundreds: 2, sacred: 2, naked: 2, wicked: 2, rugged: 2, crooked: 2,
  ragged: 2, jagged: 2, kindred: 2, hatred: 2, wretched: 2, beloved: 3, learned: 1,
  // single words the rules split or join wrongly
  rhythm: 2, rhythms: 2, algorithm: 4, algorithms: 4, realism: 4, patio: 3, patios: 3,
  prism: 2, prisms: 2, fire: 1, fires: 1, hour: 1, hours: 1,
  our: 1, flower: 2, flowers: 2, power: 2, tower: 2, people: 2, wherever: 3,
  whenever: 3, however: 3, forever: 3, whatever: 3, somewhere: 2, someone: 2,
  something: 2, sometimes: 2, somehow: 2, sometime: 2, everybody: 4, nobody: 3,
  anyone: 3, lifetime: 2, tokens: 2, coffee: 2, toward: 2, towards: 2, iron: 2,
  orange: 2, oranges: 3, squirrel: 2, real: 1, ai: 2, wifi: 2, iphone: 2, ipad: 2,
  ebook: 2, email: 2, emails: 2, okay: 2, ok: 2, tv: 2, mr: 2, mrs: 2, dr: 2,
};

const VOWELS = 'aeiouy';
const isVowel = (c: string | undefined) => c !== undefined && VOWELS.includes(c);

/** Compounds whose first part ends in a silent e: counted as two words. */
const SILENT_E_PARTS = [
  'some', 'home', 'fire', 'life', 'time', 'there', 'care', 'house', 'stone', 'side',
  'safe', 'love', 'base', 'note', 'face', 'wide', 'nine', 'five', 'game', 'name',
  'place', 'space', 'lake', 'more', 'whole', 'snow', 'like', 'bike', 'make', 'wake',
];

/** Suffixes after a silent-e stem: "lonely" is "lone" + "ly", not lo-ne-ly. */
const SUFFIXES = ['ly', 'ment', 'ments', 'ful', 'less', 'ness', 'ty'];

/**
 * Whether the letter at i is a vowel. Y is a consonant at the start ("you",
 * "year") and between two vowels ("player", "beyond"), a vowel otherwise
 * ("happy", "flying", "they").
 */
function vowelAt(s: string, i: number): boolean {
  const c = s[i];
  if (c !== 'y') return isVowel(c) && c !== 'y';
  if (i === 0) return false;
  return !('aeiou'.includes(s[i - 1]!) && 'aeiou'.includes(s[i + 1] ?? ''));
}

/** Vowel runs, counted as syllables, with qu a consonant ("unique", "quick"). */
function vowelGroups(w: string): number {
  const s = w.replace(/qu/g, 'kw');
  let count = 0;
  let i = 0;
  while (i < s.length) {
    if (!vowelAt(s, i)) { i++; continue; }
    let j = i + 1;
    while (j < s.length && vowelAt(s, j)) j++;
    const group = s.slice(i, j);
    const before = s[i - 1] ?? '';
    count++;
    // A pair said as two syllables, unless a softening consonant makes it one
    // ("nation", "social", "delicious" against "radio", "media", "curious").
    if (/^(io|ia|iou|iu)$/.test(group) && !/[tscxg]/.test(before)) count++;
    else if (group === 'ua' && !/[qg]/.test(before)) count++;
    i = j;
  }
  return count;
}

/** The syllables in one word of letters (lowercase, no punctuation). */
function wordSyllables(raw: string): number {
  let w = raw;
  if (!w) return 0;
  if (Object.hasOwn(EXCEPTIONS, w)) return EXCEPTIONS[w]!;
  if (w.length <= 2) return 1;

  for (const part of SILENT_E_PARTS) {
    const rest = w.slice(part.length);
    if (w.startsWith(part) && rest.length >= 3 && /[aeiouy]/.test(rest)) return wordSyllables(part) + wordSyllables(rest);
  }
  for (const suffix of SUFFIXES) {
    const stem = w.slice(0, -suffix.length);
    if (w.endsWith(suffix) && stem.length >= 3 && /[aeiouy][^aeiouy]+e$/.test(stem) && !/[^aeiouy][lr]e$/.test(stem)) {
      return wordSyllables(stem) + wordSyllables(suffix);
    }
  }

  let extra = 0;
  // "being", "doing", "flying": the vowel before -ing is its own syllable
  // ("saying" already has two: its y is a consonant).
  if (/[aeiou]ing$/.test(w) || /[^aeiou]ying$/.test(w)) extra++;
  // "happier", "earliest"
  if (w.length > 5 && /[^aeiou]i(er|est)$/.test(w)) extra++;
  // "prism", "realism"
  if (/[^aeiou]ism$/.test(w)) extra++;

  if (w.endsWith('es') && w.length > 3) {
    // Spoken after a sibilant ("pages", "boxes", "wishes"); otherwise the
    // plural of a silent-e word ("makes", "echoes", "stories").
    if (!/(s|x|z|ch|sh|c|g)es$/.test(w)) w = w.slice(0, -1);
  } else if (w.endsWith('ed') && w.length > 3 && !'aeiou'.includes(w[w.length - 3]!) && !/[td]ed$/.test(w)) {
    w = w.slice(0, -2);
  }
  if (w.endsWith('e') && !w.endsWith('ee') && w.length > 2) {
    // "table", "little", "acre", "genre" keep the e's syllable; "white",
    // "plate", "were", "smile" do not.
    if (!/[^aeiouy](le|re)$/.test(w) || /[rl](le|re)$/.test(w)) w = w.slice(0, -1);
  }
  return Math.max(1, vowelGroups(w) + extra);
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** An integer as it is said: 352 is "three hundred fifty two", 2026 "twenty twenty six". */
export function spokenNumber(digits: string): string {
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || digits.length > 9) return digits.split('').map((d) => ONES[Number(d)]).join(' ');
  const below100 = (x: number) => (x < 20 ? ONES[x]! : `${TENS[Math.floor(x / 10)]}${x % 10 ? ` ${ONES[x % 10]}` : ''}`);
  const below1000 = (x: number): string =>
    x < 100 ? below100(x) : `${ONES[Math.floor(x / 100)]} hundred${x % 100 ? ` ${below100(x % 100)}` : ''}`;
  // A year is said in pairs.
  if (digits.length === 4 && n >= 1100 && n < 2100 && n % 100 !== 0 && !(n >= 2000 && n < 2010)) {
    return `${below100(Math.floor(n / 100))} ${n % 100 < 10 ? `oh ${ONES[n % 100]}` : below100(n % 100)}`;
  }
  if (n < 1000) return below1000(n);
  if (n < 1_000_000) return `${below1000(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${below1000(n % 1000)}` : ''}`;
  return `${below1000(Math.floor(n / 1_000_000))} million${n % 1_000_000 ? ` ${spokenNumber(String(n % 1_000_000))}` : ''}`;
}

/** Syllables in one spoken letter: W is "double-u". */
const letterSyllables = (c: string) => (c.toLowerCase() === 'w' ? 3 : 1);

/** The syllables in one whitespace-separated token: a word, a number, an acronym, or nothing. */
export function syllables(token: string): number {
  // Markdown and typography that are not spoken.
  const t = token.replace(/[*_`~#>[\](){}"“”‘«»…,.;:!?|/\\—–]/g, ' ').replace(/’/g, "'").trim();
  if (!t) return 0;
  if (/\s/.test(t)) return t.split(/\s+/).reduce((n, part) => n + syllables(part), 0);
  // Hyphenated words are their parts; a lone hyphen is a dash.
  if (t.includes('-')) return t.split('-').reduce((n, part) => n + syllables(part), 0);
  let total = 0;
  for (const run of t.match(/\d+|[A-Za-z']+|&|%|\+|@/g) ?? []) {
    if (/^\d+$/.test(run)) total += syllables(spokenNumber(run));
    else if (run === '&') total += 1;
    else if (run === '%') total += 2;
    else if (run === '+' || run === '@') total += 1;
    else total += wordOf(run);
  }
  return total;
}

function wordOf(run: string): number {
  const letters = run.replace(/'/g, '');
  if (!letters) return 0;
  // "AI", "MCP", "HTML": spelled. Longer capitals with a vowel ("NASA") are said.
  if (letters.length >= 2 && letters === letters.toUpperCase() && /[A-Z]/.test(letters)
    && (letters.length <= 3 || !/[AEIOUY]/.test(letters))) {
    return [...letters].reduce((n, c) => n + letterSyllables(c), 0);
  }
  const lower = run.toLowerCase();
  // "didn't", "couldn't": the n't is a syllable after a consonant.
  const nt = /([^aeiou'])n't$/.exec(lower);
  if (nt) return wordSyllables(lower.slice(0, -3).replace(/'/g, '')) + 1;
  return wordSyllables(lower.replace(/'/g, ''));
}

/** Syllables in a line of text. */
export function lineSyllables(line: string): number {
  return line.split(/\s+/).reduce((n, token) => n + syllables(token), 0);
}

export interface HaikuForm {
  /** Syllables per non-empty line. */
  counts: number[];
  /** "5-7-5", or "5-6-5", or "5-7" for two lines. */
  shape: string;
  /** Three lines, counted 5, 7 and 5. */
  ok: boolean;
}

/** The three-line, 5-7-5 check, on a haiku as stored (lines separated by newlines). */
export function haikuForm(text: string): HaikuForm {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/\\$/, '').trim())
    .filter(Boolean);
  const counts = lines.map(lineSyllables);
  return {
    counts,
    shape: counts.join('-'),
    ok: counts.length === 3 && counts[0] === 5 && counts[1] === 7 && counts[2] === 5,
  };
}
