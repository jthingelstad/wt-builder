/**
 * Editorial review and drafting.
 *
 * Both services are server-side, both are requested by a button, and neither
 * ever writes: they return text for Jamie to accept, edit, or ignore
 * (docs/service-contracts.md).
 */

import Anthropic from '@anthropic-ai/sdk';

import type { IssueDoc, Item } from '../shared/types.ts';
import { renderAnnotated } from '../shared/render/annotate.ts';
import { bodyLines } from '../shared/render/plan.ts';

const MODEL = 'claude-opus-5';

/**
 * The contract asks for temperature 0 on the proof pass. Claude Opus 5 rejects
 * sampling parameters outright, so determinism is expressed as the lowest
 * effort plus a tightly scoped prompt — which is the documented replacement.
 */
const PROOF_EFFORT = 'low';
const JUDGEMENT_EFFORT = 'high';

/** Repetition that matters is recent: "you said this last month", not "in 2019". */
export const ARCHIVE_ISSUES = 8;

export type NoteKind = 'PROOF' | 'BALANCE' | 'REPETITION' | 'LENGTH';

export interface Note {
  kind: NoteKind;
  /** Null anchors the note to the issue as a whole; it renders in the summary bar. */
  item_id: string | null;
  text: string;
  /** PROOF only: the exact substring the note is about. Never an offset. */
  was?: string;
  now?: string;
  /** Where the substring occurs more than once. Defaults to the first. */
  nth?: number;
  archive_ref?: number;
}

export interface Review {
  summary: string;
  notes: Note[];
  at: string;
  /**
   * Which passes actually ran *this* review. A pass that did not run keeps its
   * previous notes — carried forward, not regenerated — so false here with
   * notes of that pass's kinds present means "held over from last time".
   */
  passes: { proof: boolean; judgement: boolean };
  /** Each pass's own summary, kept apart so a partial re-run can keep the other's. */
  summaries?: { proof?: string; judgement?: string };
}

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'notes'],
  properties: {
    summary: { type: 'string' },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'item_id', 'text'],
        properties: {
          kind: { type: 'string', enum: ['PROOF', 'BALANCE', 'REPETITION', 'LENGTH'] },
          item_id: { type: ['string', 'null'] },
          text: { type: 'string' },
          was: { type: 'string' },
          now: { type: 'string' },
          nth: { type: 'integer' },
          archive_ref: { type: 'integer' },
        },
      },
    },
  },
} as const;

const PROOF_PROMPT = `You are proofreading one issue of The Weekly Thing before it ships.

Report only mechanical errors: typos, doubled words, broken possessives, wrong
homophones, and malformed links. A typo is never a matter of taste — do not
report anything that is a judgement about style, length, balance, or word
choice. If the prose is clean, return an empty notes array.

Every note must use kind "PROOF", name the item id it belongs to, and carry the
exact substring in "was" plus the corrected text in "now". The substring must
appear verbatim in that item — it is how the note anchors, and a note whose
substring cannot be found is dropped. Where the substring occurs more than once
in the item, add "nth".

Keep "summary" to one sentence stating how many mechanical errors you found.`;

const JUDGEMENT_PROMPT = `You are reading one issue of The Weekly Thing the way its editor would, before
it ships. You are not proofreading — mechanical errors are handled separately
and you should ignore them.

Report on:
- BALANCE: a section that overwhelms the issue, or commentary that is thin
  where it matters.
- REPETITION: a point made in a recent issue, which you are given below. Say
  which issue, and set archive_ref to its number.
- LENGTH: how this issue compares to the recent ones in overall size.

Anchor a note to the item id it is about. A note about the issue as a whole
takes item_id null. Be specific and be sparing: three good observations beat
ten adequate ones. If the issue reads well, say so and return few notes.

Write "summary" as two or three sentences to the editor — lead with what is
strongest in the issue.`;

export interface CallResult {
  summary: string;
  notes: Note[];
}

async function callReviewer(
  system: string,
  userText: string,
  effort: 'low' | 'medium' | 'high',
): Promise<CallResult> {
  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    output_config: {
      effort,
      format: { type: 'json_schema', schema: NOTES_SCHEMA },
    },
    messages: [{ role: 'user', content: userText }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  if (response.stop_reason === 'refusal') {
    throw new Error('the reviewer declined this issue');
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = JSON.parse(text) as CallResult;
  return { summary: parsed.summary ?? '', notes: parsed.notes ?? [] };
}

/**
 * A note anchors to an item id plus, for PROOF, an exact substring. If the
 * substring is no longer present the note is stale and drops silently, which is
 * exactly right when every review replaces the last.
 */
export function pruneStale(doc: IssueDoc, notes: Note[]): Note[] {
  return notes.filter((note) => {
    if (note.item_id === null) return true;
    const item = doc.items[note.item_id];
    if (!item) return false;
    if (note.kind !== 'PROOF' || !note.was) return true;
    return itemText(item).includes(note.was);
  });
}

function itemText(item: Item): string {
  return [item.title, item.body, item.commentary, item.label]
    .filter(Boolean)
    .join('\n');
}

export interface ReviewRequest {
  doc: IssueDoc;
  /** Rendered recent issues, newest first. */
  recentIssues?: { number: number; rendered: string }[];
  /** Run one pass alone — both are independently re-runnable. */
  only?: 'proof' | 'judgement';
  /**
   * The review being replaced. A pass that does not run this time — skipped
   * by `only`, or failed — keeps its notes from here rather than losing them.
   */
  previous?: Review;
}

/**
 * Assemble the review from whichever passes ran. Pure, so the merge semantics
 * are testable without a model.
 *
 * A pass owns its kinds: proof owns PROOF, judgement owns the rest. A pass
 * that ran replaces its kinds wholesale; a pass that did not carries the
 * previous review's notes of those kinds forward untouched. That is what
 * "each review replaces the last" means once the passes are independently
 * re-runnable — per pass, not per review.
 */
export function assembleReview(opts: {
  doc: IssueDoc;
  proof: CallResult | null;
  judgement: CallResult | null;
  previous?: Review;
}): Review {
  const { doc, proof, judgement, previous } = opts;
  const prevNotes = previous?.notes ?? [];

  const proofNotes = proof
    ? proof.notes.filter((n) => n.kind === 'PROOF')
    : prevNotes.filter((n) => n.kind === 'PROOF');
  const judgementNotes = judgement
    ? judgement.notes.filter((n) => n.kind !== 'PROOF')
    : prevNotes.filter((n) => n.kind !== 'PROOF');

  const summaries = {
    proof: proof ? proof.summary : previous?.summaries?.proof,
    judgement: judgement ? judgement.summary : previous?.summaries?.judgement,
  };

  return {
    // The judgement summary leads: it is the two sentences to the editor.
    summary: [summaries.judgement, summaries.proof].filter(Boolean).join(' '),
    notes: pruneStale(doc, [...proofNotes, ...judgementNotes]),
    at: new Date().toISOString(),
    passes: { proof: Boolean(proof), judgement: Boolean(judgement) },
    summaries,
  };
}

/**
 * Two calls, proofing first. The split exists so a typo is never ranked against
 * an opinion and can be re-checked cheaply after Jamie fixes things.
 *
 * A failed pass does not fail the review: whatever succeeded is returned, and
 * the pass that did not keeps its previous notes (see assembleReview).
 */
export async function review(req: ReviewRequest): Promise<Review> {
  const { doc } = req;
  const rendered = renderAnnotated(doc, 'website');

  const wantProof = req.only !== 'judgement';
  const wantJudgement = req.only !== 'proof';

  const issueLine = `Issue ${doc.issue.number}, publishing ${doc.issue.publication_date}.`;

  let proof: CallResult | null = null;
  if (wantProof) {
    try {
      proof = await callReviewer(PROOF_PROMPT, `${issueLine}\n\n${rendered}`, PROOF_EFFORT);
    } catch (err) {
      console.warn(`[review] proof pass failed: ${(err as Error).message}`);
    }
  }

  let judgement: CallResult | null = null;
  if (wantJudgement) {
    const archive = (req.recentIssues ?? []).slice(0, ARCHIVE_ISSUES);
    const context = archive.length
      ? `\n\nRecent issues, for judging repetition and length:\n\n${archive
          .map((i) => `--- Issue ${i.number} ---\n${i.rendered}`)
          .join('\n\n')}`
      : '\n\nNo recent issues are available, so judge repetition conservatively.';

    try {
      judgement = await callReviewer(
        JUDGEMENT_PROMPT,
        `${issueLine}\n\n${rendered}${context}`,
        JUDGEMENT_EFFORT,
      );
    } catch (err) {
      console.warn(`[review] judgement pass failed: ${(err as Error).message}`);
    }
  }

  // The review fails only when no requested pass succeeded; the route then
  // leaves the previous review in place. A pass that was not requested is
  // not a failure — it is the carry-forward case.
  const anyRequestedSucceeded = (wantProof && proof) || (wantJudgement && judgement);
  if (!anyRequestedSucceeded) {
    throw new Error('the review failed; your previous notes are untouched');
  }

  return assembleReview({ doc, proof, judgement, previous: req.previous });
}

// ── drafting ──────────────────────────────────────────────────────────────

/**
 * Three candidates where the choice is a voice; two for link commentary, where
 * the want is a nudge rather than a menu.
 */
export function candidateCount(type: Item['type']): number {
  return type === 'pinboard_link' ? 2 : 3;
}

const DRAFT_PROMPTS: Partial<Record<Item['type'], string>> = {
  membership: `Write the Membership section for this issue of The Weekly Thing.
It is attributed to Thingy in print, so write in Thingy's voice — an assistant
that helps with the newsletter — never as Jamie. One short paragraph. State the
campaign facts plainly and warmly. Do not invent a figure, a deadline, or a
partner that is not in the facts given.`,

  echoes: `Write Echoes: a short closing callback that connects something in this
issue to the newsletter's archive. It is attributed to Thingy, so write in
Thingy's voice, never as Jamie. Two or three sentences. Cite the issue you are
calling back to by number. Only reference archive material you were given —
never invent an issue or a claim about one.`,

  haiku: `Write a haiku for this issue of The Weekly Thing — three lines, in
Jamie's voice. It should catch something real from the issue rather than a
generic seasonal image. Return each candidate as three lines separated by
newlines.`,

  pinboard_link: `Write one sentence of commentary for this link, in Jamie's
voice: direct, specific, and unhyped. Say why it is worth a reader's attention.
Do not restate the title.`,
};

export interface DraftRequest {
  doc: IssueDoc;
  itemId: string;
  /** Campaign facts for Membership; archive passages for Echoes. */
  context?: string;
}

export interface DraftResult {
  candidates: string[];
  archive_references?: { issue: number; url: string; note?: string }[];
}

const CANDIDATES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: { type: 'array', items: { type: 'string' } },
  },
} as const;

export async function draft(req: DraftRequest): Promise<DraftResult> {
  const item = req.doc.items[req.itemId];
  if (!item) throw new Error(`no item ${req.itemId}`);

  const system = DRAFT_PROMPTS[item.type];
  if (!system) throw new Error(`${item.type} has no drafting prompt`);

  const n = candidateCount(item.type);
  const current = bodyLines(item.body).join(' ');
  const assembled = renderAnnotated(req.doc, 'website');

  const parts = [
    `Return exactly ${n} distinct candidates. Make them genuinely different from each other, not variations on one phrasing.`,
    req.context ? `\nContext you must work from:\n${req.context}` : '',
    current ? `\nWhat the item says now, which you are improving on:\n${current}` : '',
    item.type === 'pinboard_link'
      ? `\nThe link:\n${item.title ?? ''}\n${item.source_url ?? ''}`
      : `\nThe assembled issue, for grounding:\n${assembled}`,
  ];

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: CANDIDATES_SCHEMA },
    },
    messages: [{ role: 'user', content: parts.filter(Boolean).join('\n') }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  if (response.stop_reason === 'refusal') {
    throw new Error('the drafting service declined this request');
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = JSON.parse(text) as { candidates?: string[] };
  return { candidates: (parsed.candidates ?? []).slice(0, n) };
}
