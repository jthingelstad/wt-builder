/**
 * The audio script's mechanical read, before the model's (plan item 3).
 *
 * The model read WT352's script, flagged four voice issues, and missed "The
 * Replacements)": a stray bracket is easy for a reader of meaning to skip
 * and certain for a synthesizer to stumble on. So the script review starts
 * with a pass that cannot miss what it looks for: stray brackets, web
 * addresses, Markdown and HTML left behind, and emoji, in the text the voice
 * will be given (`audioScript`, after `speakable`). Only an unbalanced
 * bracket counts: "(as a dot)" is prose, and is fine.
 *
 * It reports; it never rewrites, and it never blocks: its findings join the
 * model's in the script review, which Jamie approves or overrides.
 */

export interface ScriptFinding {
  /** Index of the block in the script. */
  block: number;
  /** The words around it, short, exactly as the script has them. */
  quote: string;
  problem: string;
  suggestion?: string;
  /** Found by this lint rather than the model. */
  mechanical?: boolean;
  /** The item (or section) the block speaks, when it speaks one. */
  anchor?: string;
  /** That item's or section's name, for the Send view. */
  where?: string;
}

/** A few words either side of `at..at+len`, so Jamie can find it. */
function around(text: string, at: number, len: number): string {
  const before = text.slice(0, at).split(/\s+/).slice(-3).join(' ');
  const after = text.slice(at + len).split(/\s+/).slice(0, 2).join(' ');
  return `${before}${text.slice(at, at + len)}${after}`.replace(/\s+/g, ' ').trim().slice(0, 80);
}

interface Rule {
  re: RegExp;
  problem: (token: string) => string;
}

const said = (what: string) => `${what} would be read aloud, or trip the voice.`;

const RULES: Rule[] = [
  { re: /\]\(/g, problem: () => 'A Markdown link was not turned into words ("](").' },
  { re: /\bhttps?:\/\/[^\s)\]]+|\bwww\.[^\s)\]]+/gi, problem: () => said('A web address') },
  { re: /\*\*|__/g, problem: (t) => said(`Markdown "${t}"`) },
  { re: /(?<![\p{L}\p{N}_])_[^_\s][^_\n]*?_(?![\p{L}\p{N}_])/gu, problem: () => said('Markdown emphasis "_…_"') },
  { re: /`/g, problem: () => said('A backtick') },
  { re: /!\[/g, problem: () => said('A Markdown image "!["') },
  { re: /^[ \t]*#{1,6}(?=\s)/gm, problem: () => said('A Markdown heading mark "#"') },
  { re: /^[ \t]*>/gm, problem: () => said('A Markdown quote mark ">"') },
  { re: /<\/?[a-z][a-z0-9-]*(?=[\s/>])/gi, problem: (t) => said(`The HTML tag "<${t.replace(/^<\/?/, '').toLowerCase()}>"`) },
  { re: /&(?:[a-z][a-z0-9]{1,30}|#\d{1,7}|#x[0-9a-f]{1,6});/gi, problem: (t) => said(`The HTML entity "${t}"`) },
  { re: /[:;]-?[()]/g, problem: (t) => `An emoticon "${t}": the voice says the punctuation, or nothing.` },
  { re: /\p{Extended_Pictographic}/gu, problem: (t) => `An emoji "${t}": the voice says its name, or nothing.` },
];

/** Brackets that do not pair: a closer with no opener, an opener never closed. */
function strayBrackets(text: string): { at: number; ch: string }[] {
  const stray: { at: number; ch: string }[] = [];
  const open: { at: number; ch: string }[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[' };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[') open.push({ at: i, ch });
    else if (ch === ')' || ch === ']') {
      if (open.at(-1)?.ch === pairs[ch]) open.pop();
      else stray.push({ at: i, ch });
    }
  }
  return [...stray, ...open].sort((a, b) => a.at - b.at);
}

/** Every mechanical finding in the script, in reading order. */
export function lintScript(blocks: readonly { text: string }[]): ScriptFinding[] {
  const out: ScriptFinding[] = [];
  blocks.forEach(({ text }, block) => {
    const found: { at: number; finding: ScriptFinding }[] = [];
    const seen = new Set<string>();
    const add = (at: number, len: number, problem: string) => {
      if (seen.has(problem)) return; // once per block is enough to find it
      seen.add(problem);
      found.push({ at, finding: { block, quote: around(text, at, len), problem, mechanical: true } });
    };
    for (const { at, ch } of strayBrackets(text)) {
      // "](" is reported as a link left behind, not as its two halves.
      if ((ch === ']' && text[at + 1] === '(') || (ch === '(' && text[at - 1] === ']')) continue;
      // ":-)" is an emoticon, reported as one (WT352's "the first ring.:-)").
      if (/[:;]-?$/.test(text.slice(Math.max(0, at - 2), at)) && (ch === ')' || ch === '(')) continue;
      add(at, 1, ch === ')' || ch === ']'
        ? `A "${ch}" with nothing to close: the voice may say it, or stumble.`
        : `A "${ch}" that never closes: the voice may say it, or stumble.`);
    }
    for (const rule of RULES) {
      for (const m of text.matchAll(rule.re)) add(m.index!, m[0].length, rule.problem(m[0].trim()));
    }
    out.push(...found.sort((a, b) => a.at - b.at).map((f) => f.finding));
  });
  return out;
}

/**
 * The script review: the lint's findings first, then the model's that the
 * lint did not already make (same block, overlapping words). Any finding
 * makes the verdict "look"; the summary says what the lint added, so a
 * model's "nothing would trip a listener" is not left standing alone.
 */
export function joinScriptReview(
  lint: ScriptFinding[],
  model: { verdict: 'ready' | 'look'; summary: string; findings: ScriptFinding[] },
): { verdict: 'ready' | 'look'; summary: string; findings: ScriptFinding[] } {
  const overlaps = (a: ScriptFinding, b: ScriptFinding) =>
    a.block === b.block && (a.quote.includes(b.quote) || b.quote.includes(a.quote));
  const theirs = model.findings.filter((f) => !lint.some((l) => overlaps(l, f)));
  const findings = [...lint, ...theirs];
  const n = lint.length;
  const summary = !n
    ? model.summary
    : [model.summary, `The mechanical check found ${n} thing${n === 1 ? '' : 's'} the voice would say or stumble on.`]
      .filter(Boolean).join(' ');
  return { verdict: findings.length ? 'look' : model.verdict, summary, findings };
}
