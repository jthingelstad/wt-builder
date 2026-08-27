# 0015: The contract changes the prototype implies

Status: accepted

## Context

Decisions 0004–0014 record what the interaction design settled. Several of them
contradict `docs/item-model.md` and `docs/workflow-target.md` as written. A
build started from those contracts would implement a model the design has
already abandoned, and the disagreements are quiet ones — a boolean, a missing
flag — that surface as wrong output rather than as errors.

This record collects the schema and contract deltas in one place so the change
is reviewable as a single act.

## Decision

**1. `included` becomes `channels`.** A single inclusion boolean cannot express
an item that belongs in the email but not the website. It is replaced by
`channels: { website, email, audio }`. An item is in the issue when any channel
is true; hiding is all three false. Edition-only items become a visible state
instead of an accident. Migration: `included: true` → all three true, minus any
channel the rendering contract forbids.

**2. There is no source tray.** Material inside the publishing window lands in
the issue automatically, placed by tags and dates. Inclusion is the default and
exclusion is the editorial act (0007). This deletes the tray from
`workflow-target.md` steps 1–2 and moots the open question of whether tray
removal meant excluded, deferred, or ignored.

**3. Every node is removable, including Echoes.** The skeleton is a common case,
not a rule: special issues have no Notable, no Briefly, no Journal, no Photo —
some are nothing but Markdown and photo blocks. Echoes keeps the properties that
are actually about Echoes (generated late, attributed to Thingy, last when
present, never in audio) and loses the property that it must exist.

**4. Two new node types, both repeatable.** An **ad hoc section** with an
editable heading, and a headless **Markdown block**. Photo becomes repeatable
for the same reason: an issue of ten Markdown-and-photo pairs is a legitimate
issue.

**5. Sections carry `publishes_heading`.** Photo, Haiku, and Membership publish
without a heading. The builder shows their names in the structural gutter so the
editor knows what a block is without the reader being told.

**6. The issue number is monotonically incrementing**, defaulting to one past
the last published issue, and stays editable so pre-Builder issues can be
imported by number.

## Consequences

- `docs/item-model.md` and `docs/workflow-target.md` are rewritten in this
  change. `docs/rendering-contracts.md` gains a heading column and loses the
  claim that Echoes is always present.
- `fixtures/representative-issue.json` must carry `channels` instead of
  `included`, and the fixture's `AGENTS.md` obligation — contract and fixture in
  the same change — applies.
- `fixtures/expected/*.md` are stale for reasons beyond this record: weekday-only
  Journal groups, no `draft` in the kicker, and the three headless sections. They
  are renderer tests and will fail on day one until regenerated.
- The AGENTS.md guardrail "Echoes is fixed last" is now "Echoes, when present,
  renders last".
- Four open questions in `item-model.md` are answered and move to a
  **Resolved questions** section rather than staying live.

**7. Micro.blog writes back**, on Pinboard's terms: last-writer-wins, automatic,
with saving / synced / failed states, and a local edit never discarded on a failed
write. `integrations.md`'s read-only-initially stance is superseded. Placement,
inclusion, and presentation are still never written back — those are facts about
the issue, not the post.

**8. The source window closes Friday at 00:00.** The span therefore ends Thursday,
and anything captured on Friday belongs to the next issue. Previously the window
ran through Friday, which made a Friday-afternoon bookmark's issue ambiguous.

**9. Membership and Haiku are spoken.** Both leave `To validate`: Membership with
Thingy introduced as its author before the words, Haiku one line per spoken block.
Audio also gains spoken "Link N of M" signposts in link sections, and section
transitions are script lines rather than markers.
