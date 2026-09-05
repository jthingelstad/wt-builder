# Service contracts

Two services WT Builder calls during assembly. Both are server-side: the archive
retrieval endpoint takes a service credential and is never reachable from browser
code (see `integrations.md`).

Neither service ever writes. Both return text for a human to accept, edit, or
ignore.

## Editorial review

Requested by a button, never automatically (0011). Each review replaces the
last **per pass**: a pass that runs replaces its own kinds wholesale, and a
pass that does not run — skipped, or failed — carries its previous notes
forward untouched. Notes are never merged within a pass or aged.

### Two calls, proofing first

Proofing and judgement are separate calls, in that order.

| | Proof pass | Judgement pass |
| --- | --- | --- |
| Reasoning effort | `low` | `high` |
| Archive context | none | last 8 issues |
| Scope | typos, doubled words, broken possessives, wrong homophones, malformed links | balance and rhythm, repetition, length |
| Re-runnable alone | yes | yes |

The proof pass wants determinism, and the original contract asked for
`temperature: 0`. Claude Opus 5 **rejects `temperature` with a 400** — the
replacement is low reasoning effort plus a tightly scoped prompt, which is what
`src/server/editorial.ts` does.

Two reasons for the split. A typo must never be a matter of taste, and it must
never lose a slot to an opinion — one model call ranking both together will
sometimes drop the typo. And after Jamie fixes things, the cheap deterministic pass
can run again without regenerating all the commentary.

### Request

Send **the rendered website edition, annotated with item ids** — not the raw item
tree. The reviewer should read what a reader reads; the ids are what lets a note
point at something.

```json
{
  "issue": { "number": 350, "publish_date": "2026-09-05" },
  "edition": "website",
  "rendered": "…markdown, each block preceded by <!--item:briefly-forge-->…",
  "recent_issues": [
    { "number": 349, "rendered": "…" }
  ]
}
```

`recent_issues` is present on the judgement call only, and holds **8** issues.
Repetition that matters is recent — the question is "you said this last month", not
"you said this in 2019". Eight issues is roughly 240KB of text: one ordinary call,
no retrieval infrastructure. Deep archive is Echoes' job, not review's.

### Response

```json
{
  "summary": "The Technology Advisory Council post is the strongest thing here…",
  "notes": [
    {
      "kind": "PROOF",
      "item_id": "journal-concert",
      "text": "Doubled word.",
      "was": "the The New Standards",
      "now": "The New Standards"
    },
    {
      "kind": "REPETITION",
      "item_id": "briefly-shortcuts",
      "text": "You made nearly this point in 346.",
      "archive_ref": 346
    },
    {
      "kind": "LENGTH",
      "item_id": null,
      "text": "267 words. Your last four ran nearer 900."
    }
  ]
}
```

`kind` is one of `PROOF`, `BALANCE`, `REPETITION`, `LENGTH`. A null `item_id`
anchors the note to the issue as a whole and it renders in the summary bar rather
than the margin.

### Anchoring: substrings, never offsets

A note anchors to an item id plus, for `PROOF`, **the exact substring** it is about.
No character offsets: an offset rots on the next keystroke, whereas a substring is
self-validating — if it is no longer present, the note is stale and drops silently,
which is exactly right when every review replaces the last. It also gives the
one-click `Fix` affordance for free, since `was` and `now` are already the edit.

Where a substring occurs more than once in the item, add `"nth": 2`. Default is the
first occurrence.

### Failure

A review where *no requested pass* succeeds fails whole, and **leaves the
previous notes untouched**. Clearing the margin on failure would destroy the
thing Jamie was working from for no reason. Where one requested pass succeeds
and the other fails, the failed pass's previous notes are carried forward —
`passes` records which pass actually ran, so a held-over note is legible.

## Drafting

Generates candidate text for one item. Never writes it.

### Request

```json
{
  "item_id": "membership-1",
  "type": "membership",
  "issue": { "number": 350 },
  "context": "optional extra context from the client",
  "current": "whatever is in the item now, possibly empty"
}
```

For Membership, the service fetches the campaign facts itself from the
website repo's `apps/site/_data/support.json` — the same file `/members/`
renders from, so the draft cannot disagree with what a reader sees: the
year's nonprofit, the price, the past years' totals, and the frame (free
for everyone; 100% of fees to the nonprofit; membership is a giving
program, never a paywall). A failed fetch degrades to the evergreen frame —
the prompt forbids inventing figures.

### Response

```json
{ "candidates": ["…", "…", "…"] }
```

**Three candidates** for Membership and Haiku; **two** for link commentary.
Three gives real contrast where the choice is a voice; two reads as a coin flip.
Link commentary is one sentence, where the want is a nudge rather than a menu.

**Membership candidates are pairs** (Jamie, 2026-09-05): each carries `cta`
(the invitation) and `thanks` (what an existing Supporting Member sees
instead, in the email's premium branch). One pick fills both — `body` and
`member_thanks` — so the two branches always agree in register. An empty
`member_thanks` falls back to the historical form: the invitation with the
static thanks line appended.

```json
{ "candidates": [ { "cta": "…", "thanks": "…" } ] }
```

**The bylined prompts wear one wardrobe:** Echoes and Membership prepend
the vendored Thingy print persona (`prompts/thingy-persona.md`, synced
verbatim from the Librarian's canonical charter via `npm run
persona:sync`; tests hold the sha and, when the sibling checkout is
present, the upstream match). The reviewer and every other wand stay
generic services — the byline is the boundary.

**Echoes returns units, not candidates** (Jamie, 2026-09-04): up to five
self-contained echoes, best first, each one or two sentences tracing one
thread with its own citations. Jamie selects any subset and the section
composes from it in offered order (`src/shared/echoes.ts`) — the section's
length follows the quality of what the archive actually offered. Each echo
carries its own references, so citations stay reviewable per unit; an issue
reference carries its number, a blog or podcast reference a title:

```json
{
  "echoes": [
    {
      "text": "The boat went in this week, as it has every May since [WT221](…).",
      "archive_references": [ { "kind": "issue", "issue": 221, "url": "…", "note": "…" } ]
    },
    {
      "text": "…",
      "archive_references": [ { "kind": "blog", "title": "thingelstad.com Data Center", "url": "…", "note": "…" } ]
    }
  ]
}
```

The ask-Thingy door rides at most one echo and is always offered last, so a
selected door closes the section.

### Echoes retrieval

Built 2026-08-28; restructured 2026-09-03 around the settled intent — connect
what is in THIS issue to the archive, primarily the Weekly Thing's own issues,
with blog and podcast pulls welcome. Echoes drafting calls the Librarian's
`/retrieve` (service-secret auth, `LIBRARIAN_RETRIEVE_URL` +
`LIBRARIAN_RETRIEVE_SECRET`) and **fails loud** when retrieval is unavailable
or returns nothing usable — the quality bar is real semantic retrieval, never
a silently degraded guess.

- **One retrieval per anchor, not one blended query.** The issue's strongest
  present items are the anchors: each promoted Journal post and each
  Notable/Featured link stands alone; the intro, Currently, photo, and
  ordinary Journal moments pool into one "week itself" anchor — where the
  rituals and seasons live. At most 5 anchors (`echoesAnchors`). One
  1200-char blend of the boat, the railroads, and the semester abroad
  averages into mush; per-anchor queries find the sharp echoes.
- **A recency floor, applied client-side.** The current issue and its two
  predecessors are excluded outright, and passages older than six months
  rank ahead of younger ones (`poolEchoPassages`). Last week is repetition,
  not an echo — and the review's judgement pass already owns the last 8
  issues. No `/retrieve` contract change: passages carry `issue_number` and
  `publish_date`, so the filter runs here.
- **A deterministic seasonal lens.** The issue published closest to a year
  before this one (within 28 days, `pickSeasonalIssue` over the local
  records — the pre-Builder import means all of them) rides along as a
  cited, dated excerpt. Rituals rhyme annually; semantic retrieval has no
  calendar.
- **Shape varies by issue** (settled with Jamie 2026-09-03): one echo traced
  well, or two-to-three short callbacks when the resonance genuinely
  spreads. 1–4 citations, never padded toward a count. Whole archive
  citable, issues preferred.
- **The ask-Thingy door is occasional by construction:** at most one of the
  three candidates may close with the invitation to ask Thingy live; picking
  it — or not — is the editorial act, which is what "occasional" means in a
  system where every word ships because Jamie chose it.

The model reports every source it actually cited, and accepting a candidate
stores them on the item as `archive_references`.

## Both

- Latency is visible, not hidden: the review button reads `Reading…`, the draft
  affordance shows a spinner. Budget 5–15s.
- Review is button-only, so no debounce and no rate limiting is needed.
- Both are advisory. Neither gates sending, and neither writes a word into the
  issue.

## Build status

**Both are wired and have run against Claude.** Review is in
`src/server/editorial.ts` and surfaces as the summary bar plus margin notes;
drafting surfaces as the wand in the editorial margin, which offers candidates
and writes nothing until Jamie picks one.

Review opens an existing read rather than re-running it — re-reading on every
open spends a model call to show Jamie something he has already seen. `Read
again` is the explicit re-run.
