# Service contracts

Two services WT Builder calls during assembly. Both are server-side: the archive
retrieval endpoint takes a service credential and is never reachable from browser
code (see `integrations.md`).

Neither service ever writes. Both return text for a human to accept, edit, or
ignore.

## Editorial review

Requested by a button, never automatically (0011). Each review replaces the last,
so notes are never merged or aged.

### Two calls, proofing first

Proofing and judgement are separate calls, in that order.

| | Proof pass | Judgement pass |
| --- | --- | --- |
| Temperature | 0 | default |
| Archive context | none | last 8 issues |
| Scope | typos, doubled words, broken possessives, wrong homophones, malformed links | balance and rhythm, repetition, length |
| Re-runnable alone | yes | yes |

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

A failed review **leaves the previous notes untouched** and says it failed. Clearing
the margin on failure would destroy the thing Jamie was working from for no reason.

## Drafting

Generates candidate text for one item. Never writes it.

### Request

```json
{
  "item_id": "membership-1",
  "type": "membership",
  "issue": { "number": 350 },
  "context": { "campaign_facts": "…", "assembled_issue": "…" },
  "current": "whatever is in the item now, possibly empty"
}
```

### Response

```json
{ "candidates": ["…", "…", "…"] }
```

**Three candidates** for Membership, Echoes, and Haiku; **two** for link commentary.
Three gives real contrast where the choice is a voice; two reads as a coin flip.
Link commentary is one sentence, where the want is a nudge rather than a menu.

Echoes additionally returns the archive references it used, so its citations are
reviewable:

```json
{
  "candidates": ["…"],
  "archive_references": [ { "issue": 341, "url": "…", "note": "…" } ]
}
```

## Both

- Latency is visible, not hidden: the review button reads `Reading…`, the draft
  affordance shows a spinner. Budget 5–15s.
- Review is button-only, so no debounce and no rate limiting is needed.
- Neither service is called by the first prototype.

## Build status

Neither service is wired yet. The first slice ends at a Buttondown draft
(`AGENTS.md`), and both of these are assembly-time aids rather than parts of
that path. The contracts above are what to build against when they land.
