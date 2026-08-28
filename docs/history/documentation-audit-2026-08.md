# Documentation audit, August 2026

> **History, not instruction. Every finding below was remediated on 2026-08-28**
> — see the outcome at the end. Kept because it records why the documentation is
> shaped the way it is, and what shape it must not drift back into.

2026-08-28. A full read of every Markdown file in the repo against the code as
it actually stands.

The headline: **the repo has 29 documents and no single answer to "what is this
project and what is true right now."** Four entry points give three different
answers about where the interface is specified, and the one they mostly agree on
is the one that caused the client to be built wrong the first time.

Findings are ordered by what they cost, not by where they live.

---

## 1. Four entry points, three answers

| File | Says the interface authority is | Reading order it gives |
| --- | --- | --- |
| `AGENTS.md` | `prototype/` | README → product-brief → design-brief |
| `CLAUDE.md` | `prototype/` | AGENTS → product-brief → item-model → rendering → service → decisions → fixture |
| `README.md` | `prototype/` | AGENTS → item-model → rendering → service → fixture |
| `design/README.md` | **`docs/interface-spec.md`** | interface-spec → prototype → screenshots |

Only `design/README.md` is right, and it is the one nothing links to. None of
the other three mention `docs/interface-spec.md` at all — the 937-line document
that is the actual specification for every screen.

This is not theoretical. The client was built once from the contracts without
the spec being opened, and had to be rebuilt.

`CLAUDE.md` and `AGENTS.md` are also two separate files here that have already
diverged. Jamie's home directory solves this by making `CLAUDE.md` a symlink to
`AGENTS.md`, with the note: *"Do not fork them; they drifted for weeks."* That
already happened here.

## 2. Statements that are wrong now, and will cause wrong work

Each of these reads as current instruction and is false.

| Where | Says | Actually |
| --- | --- | --- |
| `CLAUDE.md` | "Micro.blog `/posts/all` is the timeline… Read the blog's **JSON Feed**" | Micropub `q=source`, per 0023. The JSON Feed does not return post *source*, which write-back needs. Following this re-breaks the sweep. |
| `item-model.md` | "The window **closes Friday at 00:00**, so the span ends **Thursday**" | Superseded by 0022: the span ends Friday. This is the exact sentence the first implementation followed. |
| `item-model.md` | "Micro.blog synchronization is **read-only initially**" | Superseded by 0023: live write-back. |
| `item-model.md` | "Removing a section holds out its syndicated items" | Half of it. Local items are **deleted**; only syndicated are held out. |
| `service-contracts.md` | "**Build status:** Neither service is wired yet" | Both editorial review and drafting are wired and have run against Claude. |
| `service-contracts.md` | Proof pass at "Temperature 0" | Opus 5 rejects `temperature` with a 400. The code uses `effort: 'low'` and says so in a comment; the contract still asks for the impossible thing. |
| `README.md` | "**Website** and **Podcast** — sending is deliberately unavailable in the current slice" | Both are built. Neither has been *run*, which is a different statement and the one worth making. |
| `README.md` | "reads the blog's public JSON Feed" | Same defect as `CLAUDE.md`. |
| `README.md`, `CLAUDE.md` | "44 tests" | 174. |
| `AGENTS.md` | "decisions **0004–0021**… are the specification" | Those records are not in this repo. Present: 0001, 0002, 0003, 0015, 0019, 0020, 0022, 0023. |
| `AGENTS.md` | "send to a Buttondown draft, **and nothing else**" | All three legs are built, plus the archive feed. |
| `integrations.md`, `studio-salvage-map.md` | `studio-thing` "is being renamed to `archive-thing`" | It has not been. `~/Projects/studio-thing` exists; `archive-thing` does not. |

## 3. Conflicts that need a decision, not an edit

These are two documents disagreeing where neither is obviously stale.

**Membership and Haiku in audio.** `rendering-contracts.md` says both are
spoken — Membership "Thingy introduced as author", Haiku "one line at a time" —
and the code, the renderer, and `fixtures/expected/audio-script.md` all agree.
`interface-spec.md` line 552 says both are "held out of the script" behind a
`TO VALIDATE` flag. The editions currently follow the contract; the lens shows
the flag. **Jamie has to pick one.**

**Publishing lifecycle states.** `publishing-lifecycle.md` defines eight states
(`assembling → … → closed`). The code has two (`draft | published`) plus
per-destination send state (`none | sending | sent | failed`). The eight-state
model was written for a phase that no longer exists in that shape. Either it
describes something still wanted, or it should be rewritten to describe what
sending actually records.

**The source tray.** `workflow-target.md` §1 specifies "a source tray shows
unplaced or excluded Pinboard and Micro.blog items". `interface-spec.md` says
flatly: "There is no import queue and no candidate tray," and 0005 makes
automatic inclusion the whole point. The spec supersedes it and even names the
file — but `workflow-target.md` still reads as current.

**Window end time.** Open question 1 in the spec asks whether the window should
end Friday 11:59 PM CT. Jamie has since answered Friday 00:00 (0022), but the
open question is still listed as open.

## 4. The decision records are the biggest gap

**Nine to thirteen records referenced as "the specification" do not exist here.**

The spec's Files table lists design decisions `0002`–`0012`. The repo has
`0001`–`0003` (product decisions) — so **0002 and 0003 collide outright**:

| Number | In the repo | In the design bundle |
| --- | --- | --- |
| 0002 | Publishing and archive boundary | WYSIWYG issue canvas |
| 0003 | Archive feed mechanism | Channel lenses |

The spec anticipates this — *"Merge them into the repo when the design is
accepted, renumbering to avoid the collision"* — but the merge never happened.

Worse, **the design bundle itself has two numbering schemes.** The spec's Files
table says `0010` is two-margins and `0012` is quiet-by-default. The records
actually fetched from the design are numbered `0012` two-margins and `0014`
quiet-by-default. So the table is stale against its own bundle.

And the repo's own numbering has holes with no explanation: 0004–0014, 0016–0018,
and 0021 are absent, while 0015, 0019, and 0020 exist. A reader cannot tell
whether a missing number was never written, was rejected, or is sitting
unmerged in the design bundle.

Records cited inline that do not exist: **0007**, **0011**.

## 5. Contract drift against the code

`item-model.md`'s Item shape no longer matches `src/shared/types.ts`.

- **In code, undocumented (9):** `archive_references`, `attribution`,
  `channel_locks`, `label`, `reviewed`, `source_flags`, `status`, `sync_error`,
  `tags`. Two of these are load-bearing: `source_flags` is what stops Pinboard
  write-back from silently publishing a private bookmark, and `channel_locks`
  is what makes a forbidden channel state its reason instead of failing quietly.
- **Documented, not in code (2):** `id` (it is the map key) and `position`
  (order is the node's `items` array).
- **Wrong values:** `presentation` is documented `normal | promoted`; the code
  has `journal | promoted`.

Nothing in `docs/` describes four things that are built and running: **URL
routing**, **photo upload with EXIF**, **image rehosting to the CDN**, and the
**launchd + Tailscale operational setup** (the last is in `README.md` only).

## 6. Documents that have finished their job

Not wrong — done. They read as current instruction because nothing marks them
otherwise.

- `docs/design-brief.md` — a brief *to* Claude Design. "Deliverables: working
  clickable prototype in `prototype/`". Delivered.
- `prototype/README.md` — "Claude Design **should place** the interactive
  prototype here." It is there. Written in the imperative for work now done.
- `docs/workflow-current.md` — evidence about the Shortcuts workflow being
  replaced. Historical and worth keeping; not a current spec.
- `docs/product-brief.md` — core content is still right, but it is framed
  around "Success criteria for **the prototype**" and lists "Publishing from
  the first prototype" as a non-goal.
- `docs/workflow-target.md` — §5 "Publishing is a later phase."
- `reference/*` — salvage notes, still accurate as history.

Sixteen of the twenty-nine documents contain prototype or pre-production
framing.

---

## Recommended remediation

Ordered by what unblocks using the application.

### Now — stop the docs from causing wrong work

1. **Make `CLAUDE.md` a symlink to `AGENTS.md`**, matching the convention in
   `~`. One file, no drift.
2. **Rewrite `AGENTS.md`** for the current phase: building the application, not
   prototyping. It must name `docs/interface-spec.md` as the interface
   authority in its first ten lines, and `docs/status.md` as what is actually
   built.
3. **Delete the four wrong statements** in §2 above that would break working
   code if followed — the JSON Feed line, the Thursday window, read-only
   Micro.blog, and "neither service is wired".
4. **Demote `prototype/`** everywhere from "the reference for what the
   interface does" to "the design's clickable reference; the spec is the
   authority." Consider deleting the directory outright — it uses the old
   `included` model and has already misled one build.

### Next — close the decision-record gap

5. **Import the design decision records**, renumbering to `0024+` to avoid the
   0002/0003 collision entirely rather than trying to interleave. Add a
   `docs/decisions/README.md` mapping design-bundle numbers to repo numbers, so
   every `(0011)` citation in the spec still resolves.
6. **Record the holes.** A one-line index saying which numbers were never used
   keeps the next reader from hunting for 0016.

### Then — reconcile contracts with the code

7. **Resolve the three real conflicts** in §3. Membership/Haiku audio needs
   Jamie; the lifecycle states and the source tray need a rewrite or a deletion.
8. **Update `item-model.md`** to the actual Item shape, and fold 0022 and 0023
   into it rather than leaving the superseded sentences in place.
9. **Fix `service-contracts.md`**: temperature → effort, and replace the Build
   status section with what is wired.

### Finally — mark the finished work as finished

10. **Move completed briefs to `docs/history/`** with a one-line header saying
    what they were for and that they are not current: `design-brief.md`,
    `workflow-current.md`, `workflow-target.md`, `prototype/README.md`.
11. **Reframe `product-brief.md`** from prototype success criteria to product
    criteria. The content survives; the framing does not.
12. **Correct the small facts**: test count, the `archive-thing` rename that has
    not happened, and the write-back defaults now that `.env.example` ships them
    on.

### The shape to aim for

Four documents a newcomer reads in order, and nothing else claiming to be a
starting point:

1. `README.md` — what this is, how to run it, how to reach it
2. `AGENTS.md` (= `CLAUDE.md`) — phase, stack, guardrails, and where the
   authority lives
3. `docs/interface-spec.md` — the interface
4. `docs/status.md` — what is built, what is not, what has never run

Everything else is a contract, a decision, or history — and says which it is.


---

## Outcome

Everything above was acted on the same day.

**Deleted:** `prototype/` (three of four entry points cited it as the interface
authority), `docs/decisions/` as a directory, `docs/design-brief.md`,
`docs/workflow-target.md`, `reference/studio-salvage-map.md`. Ten documents gone.

**Unforked:** `CLAUDE.md` is now a symlink to `AGENTS.md`, matching `~`.

**Rewritten:** `AGENTS.md` for the real phase, naming the spec as the authority in
its first ten lines. `README.md`. `docs/publishing-lifecycle.md`, to the two
states the code actually has.

**Reconciled with the code:** `item-model.md` now matches `src/shared/types.ts`
field for field. `service-contracts.md` documents reasoning effort rather than a
temperature Opus 5 rejects, and no longer claims neither service is wired.
`integrations.md` gained the image pipeline and the correct Micro.blog read path.

**Edited in place:** `docs/interface-spec.md`, on Jamie's call — the superseded
second Issue index section, the one-margin paragraph, the handoff-meta sections,
and the eight-state publishing section are gone; three open questions are
recorded as answered.

**Settled:** Membership and Haiku are spoken, which is what the renderer and the
audio fixture already did. The `TO VALIDATE` strip is out of the Audio lens.

**Kept as history:** the Shortcuts workflow and inventory, because that workflow
remains the fallback until WT Builder has published a real issue.

Every internal link resolves. No decision-number citation survives anywhere in
the source or the docs.

### The rule that came out of it

A decision earns a written record only when it is **invisible in the code** — an
absence, or a boundary between repositories. Everything else belongs in a comment
next to the thing it constrains, which is where it will actually be read. That is
why `docs/decisions.md` is one short file and why the numbered directory should
not come back.
