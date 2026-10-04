# Plan: MCP 1.4, riding along

From the WT352 ride-along (`docs/mcp-ride-along-wt352.md`). The MCP answers
"where is the issue?" well; this plan gives it **time**: what changed since
the agent last looked, whether Jamie is done with an item, and what that
change unblocked. Proposed 2026-10-04; Part A built and deployed the same day as MCP 1.4.0, Part B as 1.5.0 (Jamie: "Do the B items too").

## The idea that makes it cheap

Every save already keeps the document it replaced in `revisions` (whole doc,
`saved_at`), and every event has an id, a time, and an anchor. So the issue
**as it stood at any event** is recoverable read-only: the first revision
saved after that event's time, or the live doc if there is none. Pills then,
pills now, diff. Nothing on the save path changes, no schema migration, every
tool stays behind `readRoute`, and it works retroactively (WT352's existing
review included).

## Part A: MCP 1.4.0 (read-only, server-side, no editor change)

**A1. A cursor on every read.** `get_status`, `get_issue` and `get_item`
return `cursor`: the issue's latest event id. An agent holds it and asks what
moved since.

**A2. `get_status since=<cursor>`** adds a `changes` block:
- `items`: each item edited, moved, held out or synced since, with
  `last_edited_at`, from the events' anchors.
- `pills`: every pill whose state differs between the issue at the cursor and
  now, as `from → to` ("Title: waiting → todo", "Plan mode is dead:
  todo → done"). Unblocking becomes a fact the server states, never a count
  the agent keeps.
- `focus`: the anchor of Jamie's latest edit and when it started, and
  `settled` for every other changed item (his edits have moved elsewhere, or
  60 s of quiet). This is the "read it once he moves on" rule, made explicit.

**A3. Item-scoped reads.** `render_issue` takes `item_id` or `section` and
renders only that slice of the edition (filtered at the plan, so ordering and
Journal grouping stay right). `get_item` carries the review notes for that
item.

**A4. Review notes that know they were answered.** Using the issue at the
review's time:
- non-PROOF notes with an item gain `changed_since_review` (the item's text
  differs from when the review read it), so a relayed REPETITION or BALANCE
  note says "you've touched this, check it" instead of nagging.
- PROOF notes gain `fixed_as_suggested`: `true` when the `was` text is gone
  and the `now` text is present, `false` when the words changed some other
  way. That catches "ask it it do" → "ask it do".
- `still_applies` keeps its meaning and type; both are new fields.

**A5. Small clarity.** `overdue_by_days` beside `overdue`. Event summaries
for single-item sections (Intro, Outro, Haiku, Membership) name the section,
not the first words. This is the one write-path touch, and it affects new
events only.

**A6. Prompt.** A `ride_along` prompt sets out the loop: overview, hold the
cursor, `get_status since=`, read settled items with `get_item`, re-read
before claiming anything unblocked.

Tests: unit tests on the representative issue with a seeded revision history
(pill diff across a Notable edit unblocks Title; focus and settled; a
regressed PROOF fix); the MCP round-trip test; `MCP_VERSION` 1.4.0;
`docs/service-contracts.md`. Estimated at one sitting, one commit per step.

With A2 in place the watcher goes back to being only the bug catcher: an
agent riding along polls `get_status since=` instead.

## Part B: the editor (product calls, after WT352 is sent)

All warn, don't block. Each shows in the editor and through the MCP.

- **B1. Link findings on the row.** A small amber mark beside a Notable or
  Briefly title with an open finding (expired or expiring gift, dead,
  moved). Click opens the inspector at the finding. Jamie expected this on
  the expired Verge link.
- **B2. "Looks unfinished."** A soft hint on an item whose text ends without
  terminal punctuation, or a Currently line under a handful of words, but only
  once it has settled (A2's rule), so it never fires mid-typing. The pill
  stays done.
- **B3. "Page title, not trimmed."** A hint on a syndicated title that still
  carries a site suffix ("| The Verge", "- Derek Thompson"), lost a
  separator, or runs long. Never rewrites: the title is Jamie's to trim.

## Not in this plan

- **Push.** MCP resource subscriptions would remove polling entirely, but the
  transport is stateless today. Revisit if polling `since=` proves clumsy.
- **Per-item reviews on demand.** WT352 showed that the agent's running proof
  covers what the review's PROOF pass does, so a "review this item" tool is
  not needed. The review's value is its archive memory.
- **Writes** stay in `docs/mcp-plan.md`, *Later*.

## Order and timing

1. Part A now, while Jamie is on break: it is read-only and MCP-side, and
   `npm run deploy` restarts the service before he is back to edit.
   Ride-along on the rest of WT352 then uses it, and becomes its test.
2. Part B after WT352 is sent, one item at a time. Jamie picks which.

## Decisions for Jamie

- **D1.** Ship Part A during the break (recommended) or after WT352 is sent.
  *Shipped during the break.*
- **D2.** Which of B1–B3 to build, and does B2's hint show in the editor or
  only through the MCP? *All three, in both (`src/shared/hints.ts`). As
  built: B1 is a mark under the row's rail rather than beside the title,
  because the title is an editable; B3 stops once Jamie edits the title,
  because most published titles (WT350, WT351) keep their suffix; B3's
  "lost a separator" case is not detected.*
