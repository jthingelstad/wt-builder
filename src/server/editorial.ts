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
import { config } from './config.ts';
import * as librarian from './integrations/librarian.ts';

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
export function candidateCount(type: Item['type'] | 'issue'): number {
  return type === 'pinboard_link' ? 2 : 3;
}

/**
 * The newsletter's voice, distilled from Jamie's own editorial spec
 * (librarian-thing docs/voice-and-style.md). Prepended to every prompt that
 * drafts in or near his voice, because these guardrails override everything.
 */
const VOICE = `The Weekly Thing's voice: first-person, observational, dry,
curious — never salesy. Short sentences mixed with longer reflective ones.
A reader and practitioner, not a pundit; candid opinions, rarely hot takes.

Hard guardrails, which override everything else:
- No superlatives ("best", "amazing", "premier") and no marketing phrases
  ("cutting-edge", "curated with care", "hand-picked").
- No thought-leader or ad-copy language; declarative framing, never
  imperatives like "Level up your reading!".
- Prefer specific over general: "47 links about AI agents in the last year"
  beats "stay on top of AI".
- No emoji unless quoting a subject that contains one.`;

const DRAFT_PROMPTS: Partial<Record<Item['type'], string>> = {
  membership: `Write the Membership section for this issue of The Weekly Thing.
It is attributed to Thingy in print, so write in Thingy's voice — an assistant
that helps with the newsletter — never as Jamie. One short paragraph.

Understand the program before you write, because generic newsletter-support
copy gets it exactly backwards:

- The Weekly Thing is free for everyone, always. Membership is NOT a paywall,
  NOT premium content, and NOT "support Jamie's work".
- Supporting Membership is a community giving program: 100% of membership
  fees go directly to a nonprofit selected each year. The member's money
  funds the nonprofit, not the newsletter.
- Name the current year's nonprofit and say in a phrase why it matters —
  from the facts given, never invented.
- The ask is warm and unhurried: an invitation to give through the
  newsletter, not a plea to sustain it. "Less than a coffee a month" is the
  register. A one-time gift of any amount is equally welcome.
- Never invent a figure, a deadline, a goal, or urgency. Never mention
  member perks as the reason to join — the giving is the reason.`,

  echoes: `Write Echoes — the short archive note that closes the issue. It is
the reader's doorway back into the archive: they should leave wanting to open
a past issue.

Voice: the archive librarian, not Jamie. Third person about Jamie ("Jamie
tracked this in WT210"), composed and warm — Jamie writes loose, you write
composed. Knowledgeable without being smug. No hype words ("fascinating
parallel", "deep cut", "remarkable") — be specific or say nothing. No
speculation about Jamie's mood, family, or motivations beyond what a cited
issue shows.

Shape: 2–5 sentences, roughly 60–110 words, one paragraph, no heading. Cite
2–4 distinct past issues, every one as a markdown link —
[WT210](https://weekly.thingelstad.com/archive/210/) — and every citation
tied to something specific in THIS issue: a named link, a Journal entry, a
recurring place or project. A citation that just says "Jamie has written
about this before" is a failure. End by opening a door, not closing a topic
— no tidy conclusions, no "keep exploring!".

Ground every claim in the archive passages provided below. Never invent an
issue number or a claim about one. Report the issues you actually cited in
archive_references, with a note saying what each one carries.`,

  haiku: `Write a haiku to close this issue of The Weekly Thing — three short
lines, in Jamie's voice.

Read the assembled issue and find what the week was about. Pull concrete
nouns from the actual issue — never abstractions like "the future" or
"technology", never a generic seasonal image, never greeting-card register.
Jamie's convention is haiku-shaped rather than strictly 5-7-5: three short
lines where the third turns or lands. Plain, observational, mildly wry. An
em-dash at the end of line two is a common Weekly Thing pattern, not a rule.

Two real examples of the shape working — concrete images from the issue,
the third line doing the human turn:

  Hand-drawn QR dreams,
  Redis arrays tell stories —
  Dads learn to listen

  Coffee stirs the gut
  While AI dreams in the night
  Both keep us awake

Return each candidate as three lines separated by newlines.`,

  pinboard_link: `Write commentary for this link in Jamie's voice — the reason
it is in the issue. Every link has one; the reader and Jamie learn together.

Direct, specific, unhyped. Say what the thing actually is or what it made
Jamie think — a candid opinion is welcome, a sales pitch is not. Do not
restate the title. If the link is in Briefly, one crisp sentence; in Notable
or Featured, one to three sentences with room for an aside.`,
};

/**
 * The head wand: the issue's title theme and dek, drafted together. The
 * title becomes "WT{n} — {theme}" everywhere subjects print; the dek is the
 * description on social cards, the archive page, and the issue index.
 */
const ISSUE_PROMPT = `Draft the title theme and description for this issue of
The Weekly Thing.

Each candidate is exactly two lines:
- Line 1 — the theme: 3–6 words, title case, no punctuation at the end. It
  completes "WT{n} — {theme}", so never include the number or "WT". Concrete
  and issue-specific, drawn from what is actually in the issue — never
  generic ("Tech Roundup") and never clever at the expense of clarity.
- Line 2 — the description: a comma-separated list of 5–8 concrete topics
  lifted from the issue — named products, projects, people, places,
  technologies — ending in a single period. Target 130–150 characters, hard
  maximum 160. Prefer the editorial core (Notable, Featured, Briefly, the
  Journal's substance) over incidental links. Never pad with section names
  ("Currently", "a photo", "a haiku", "Echoes") — every entry is a topic a
  reader could care about. With a thin issue, a shorter honest list beats a
  padded one.

Make the candidates genuinely different angles on the issue, not synonyms.`;

/**
 * The membership program's facts, formatted for the drafting prompt.
 *
 * Pure so it is testable; the shape is apps/site/_data/support.json in the
 * website repo — the same file the /members/ page renders from, which makes
 * it the one source that cannot disagree with what a reader sees.
 */
export function campaignFacts(support: {
  yearly_price?: number;
  current?: {
    nonprofit?: string;
    description?: string;
    year?: number;
    year_label?: string;
  };
  past?: { nonprofit?: string; year?: number; amount_raised?: number }[];
}): string {
  const lines: string[] = [];
  const c = support.current ?? {};
  if (c.nonprofit) {
    lines.push(
      `This year's nonprofit (${c.year_label ?? c.year ?? 'current year'}): ${c.nonprofit}.`,
    );
  }
  if (c.description) lines.push(`About them: ${c.description}`);
  if (support.yearly_price) {
    lines.push(
      `Membership is $${support.yearly_price}/year, recurring — or a one-time gift of any amount.`,
    );
  }
  const past = (support.past ?? []).filter((p) => p.nonprofit);
  if (past.length) {
    const total = past.reduce((n, p) => n + (p.amount_raised ?? 0), 0);
    lines.push(
      `Past years funded ${past.map((p) => p.nonprofit).join(', ')} — $${total.toFixed(2)} raised so far.`,
    );
  }
  lines.push('100% of membership fees go to the nonprofit. The newsletter is free for everyone.');
  return lines.join('\n');
}

/**
 * Fetch the live program facts from the website repo. The client passes no
 * campaign context, and asking Jamie to paste his own program description
 * into a field every year is how the first generated CTA came out generic.
 * Returns null on any failure — the prompt then forbids invention, so a
 * fetch failure degrades to the evergreen frame rather than to fiction.
 */
async function fetchCampaignFacts(): Promise<string | null> {
  try {
    const url = `https://raw.githubusercontent.com/${config.websiteRepo}/main/apps/site/_data/support.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return campaignFacts(await res.json());
  } catch {
    return null;
  }
}

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

/** Echoes also reports which issues it cited, so citations are reviewable. */
const ECHOES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates', 'archive_references'],
  properties: {
    candidates: { type: 'array', items: { type: 'string' } },
    archive_references: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'url'],
        properties: {
          issue: { type: 'integer' },
          url: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * The retrieval query for Echoes: what this issue is actually about, as
 * text an embedding can hold — titles, labels, and the first stretch of
 * each present item's words. Pure, so the shape is testable.
 */
export function echoesQuery(doc: IssueDoc): string {
  const parts: string[] = [];
  for (const item of Object.values(doc.items)) {
    if (item.type === 'echoes') continue;
    if (!Object.values(item.channels).some(Boolean)) continue;
    for (const field of [item.title, item.commentary, item.body]) {
      const flat = bodyLines(field).join(' ').trim();
      if (flat) parts.push(flat.slice(0, 160));
    }
  }
  return parts.join('\n').slice(0, 1200);
}

/** Passages formatted for the prompt: citable, compact, specific. */
function passageContext(passages: librarian.Passage[]): string {
  return passages
    .slice(0, 10)
    .map((p) => {
      const head = [
        p.issue_number ? `WT${p.issue_number}` : null,
        p.subject,
        p.publish_date?.slice(0, 10),
        p.section,
      ].filter(Boolean).join(' · ');
      return `[${head}] ${p.url ?? ''}\n${String(p.text ?? '').slice(0, 500)}`;
    })
    .join('\n\n');
}

export async function draft(req: DraftRequest): Promise<DraftResult> {
  // The head wand: 'issue' is not an item — it drafts the title theme + dek.
  const isIssue = req.itemId === 'issue';
  const item = isIssue ? null : req.doc.items[req.itemId];
  if (!isIssue && !item) throw new Error(`no item ${req.itemId}`);

  const type = isIssue ? 'issue' : item!.type;
  const system = isIssue
    ? `${VOICE}\n\n${ISSUE_PROMPT}`
    : DRAFT_PROMPTS[item!.type] && `${VOICE}\n\n${DRAFT_PROMPTS[item!.type]}`;
  if (!system) throw new Error(`${type} has no drafting prompt`);

  const n = candidateCount(type as Item['type'] | 'issue');
  const current = isIssue
    ? [req.doc.issue.title, req.doc.issue.dek].filter(Boolean).join('\n')
    : bodyLines(item!.body).join(' ');
  const assembled = renderAnnotated(req.doc, 'website');

  // Membership grounds itself in the live program facts; whatever the client
  // passed rides along as additional context.
  const campaign = type === 'membership' ? await fetchCampaignFacts() : null;

  // Echoes grounds itself in the archive, and fails loud without it — the
  // editorial spec's quality bar is real semantic retrieval, never a
  // silently degraded guess (docs/service-contracts.md).
  let passages: librarian.Passage[] = [];
  if (type === 'echoes') {
    passages = await librarian.retrieve(echoesQuery(req.doc));
    if (!passages.length) {
      throw new Error('the archive returned no passages — rerun Echoes rather than inventing');
    }
  }

  // The link's own section decides commentary length (Briefly vs Notable).
  const linkSection = item?.type === 'pinboard_link'
    ? req.doc.nodes.find((nd) => nd.items.includes(req.itemId))?.label ?? item.section
    : undefined;

  const parts = [
    `Return exactly ${n} distinct candidates. Make them genuinely different from each other, not variations on one phrasing.`,
    isIssue ? `\nThis is issue WT${req.doc.issue.number}.` : '',
    campaign ? `\nThe program, from the live members page:\n${campaign}` : '',
    passages.length ? `\nArchive passages, retrieved for this issue — cite only from these:\n${passageContext(passages)}` : '',
    req.context ? `\nContext you must work from:\n${req.context}` : '',
    current ? `\nWhat it says now, which you are improving on:\n${current}` : '',
    item?.type === 'pinboard_link'
      ? `\nThe link (in the ${linkSection ?? 'Notable'} section):\n${item.title ?? ''}\n${item.source_url ?? ''}`
      : `\nThe assembled issue, for grounding:\n${assembled}`,
  ];

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: type === 'echoes' ? ECHOES_SCHEMA : CANDIDATES_SCHEMA },
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

  const parsed = JSON.parse(text) as {
    candidates?: string[];
    archive_references?: { issue: number; url: string; note?: string }[];
  };
  const result: DraftResult = { candidates: (parsed.candidates ?? []).slice(0, n) };
  if (type === 'echoes' && parsed.archive_references) {
    result.archive_references = parsed.archive_references;
  }
  return result;
}
