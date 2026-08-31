# Where WT Builder stands

Written 2026-08-27, at the end of the rebuild-from-the-design session.
Amended 2026-08-28 after a full review: the send dispatch is restored (it had
been silently severed since 2dd684b), the archive corpus send exists as the
fourth leg, and the Pinboard sweep uses the window's true instants.

The first build was made from the written contracts without opening the design
files. This session imported the handoff, read the whole spec and its decision
records, and rebuilt the client against them. What follows is what is actually
finished, what is half-finished, and what has never run.

## Working, and verified in a browser against live data

- **Dashboard** — rows with the completion strip full-width beneath a draft
  line, the deadline countdown chip, SITE/MAIL/POD send chips, and the
  archive-feed cell. Plus the setup sheet.
- **URLs** — `/`, `/wt350`, `/wt350/send`. Back, deep links, reload-in-place,
  and two issues in two tabs all work.
- **The canvas**: the three-column grid at `76px | 680px | {0 | 250px}`, the
  card painted per row, the structural margin with its 2×n control rail, the
  editorial margin.
- **Website lens** — head block, section rules, headings, Currently, Journal
  with date grouping, Briefly, Haiku, Echoes, held-out strips.
- **Source lens** — every item as stored, its own section headings with
  `SECTION · type · n ITEMS`, prose plus one quiet meta line, state chips.
- **Left panel** — issue metadata at rest and open, the outline with drag
  reorder, provenance chips, add-back chips for absent sections.
- **Progress strip** — one tick per readiness unit, edge-aware tooltips,
  click-to-jump.
- **Inspector** — fields per type, the Thingy review gate, editions with locked
  channels and their reasons, provenance, archive references.
- **Editorial review** — the summary bar and margin notes, measured and
  stacked. Run for real against Claude; the notes were good.
- **Audio lens** — a numbered script rather than a page, rendered from the
  same `audioScript()` that feeds the synthesizer, so it cannot drift from
  the mp3. Section cues, omission strips, and the TO VALIDATE flag.
- **Email lens** — the Buttondown Liquid branch after Membership.
- **Checklist popover** — opens from the strip, coloured by kind, each row
  saying what finishing it means and jumping to the offending item.
- **Collapse mode** — one row per section with preview, counts, drag reorder,
  and Echoes pinned last.
- **Photo upload** — drop a file, it is resized to 1200px, stored on the CDN,
  and the camera's own time and coordinates are read from EXIF. Verified end
  to end: a 2400x1600 photo stored at 1200x800, 23 KB down to 3 KB, served
  from files.thingelstad.com, and the "Photo placed" checklist item flipped.
- **Send view** — Podcast, Website, Buttondown in run order, the audio gate,
  real per-step evidence. As of 2026-08-30 the ordering blocker is enforced,
  not stated: the server refuses a website send until the podcast has run
  (`?force=1` is the deliberate escape for an issue with no audio), and every
  leg refuses a second POST while one is in flight — a `sending` older than
  ten minutes is treated as a crash strand and passes so the leg can retry.
- **Published, derived** (2026-08-30) — an issue becomes `published` the
  moment its website and buttondown legs are both `sent`; nothing un-derives
  it. This is what keeps `lastPublishedNumber()`, the next-issue default,
  and the website's prior-issues index true after the first real send.
- **Write-back compare-and-set** (2026-08-30) — before replacing a bookmark
  or post, write-back fetches the record and refuses with `conflict` when it
  no longer matches the sweep's snapshot (or `gone` when deleted), so an
  edit made at the source between scans can never be silently overwritten.
  A successful write moves the snapshot to what was written.
- **Docs freshness gate** (2026-08-30) — tests/docs.test.ts fails the build
  when any doc cites a file path that no longer exists, or claims a test
  count (a number in prose only ever decays).
- **Sweep** — Pinboard `toread=yes` and Micro.blog Micropub `q=source`, with
  the corrected Friday-to-Friday Central window. As of 2026-08-30 the sweep
  also reconciles the read side of the mirror: Pinboard and Micro.blog are
  the CMS, so edits made there are adopted when the local copy is untouched
  (`source_snapshot` is the merge base), two-sided edits surface as
  `conflict`, and a deleted source record marks the item `gone` — the local
  copy is always kept, and removal stays an editorial act. A `gone` item
  refuses write-back so the deleted record is never silently recreated.
  Opening a draft issue re-scans automatically, and Re-scan sits on the
  at-rest meta card as well as in the edit panel.
- **Event log** (2026-08-30) — every action on an issue is narrated to an
  append-only `events` table (its own table; the document rewrites wholesale
  on every save): sweep arrivals, source-side refreshes/gone/conflicts,
  edits, outline changes, channel flips, settings, write-backs, review runs,
  and sends. `GET /api/issues/:id/events`, newest first; the **Log** button
  on the meta card opens it as a sheet. Quiet re-scans (nothing changed) log
  nothing, so the auto-scan on open cannot bury the signal.

## Not built

- ~~The 352px editorial review panel~~ — built 2026-08-28: shares the rail
  with the inspector (← Review swaps back), staleness hint, WHAT'S WORKING,
  grouped notes with kind badges and was→now, done/ignore with reopen and
  Show cleared, and PROOF notes that drop live when their substring is fixed.
- ~~Insert points and add affordances~~ — built 2026-08-28: hover insert
  points at section boundaries, `+ Currently entry` / `+ Write a link here`
  chips, and the tail row of absent sections. The outline's drag-reorder is
  also actually persisted now — it had silently done nothing.
- ~~Audio lens details~~ — built 2026-08-28 ("Dates spoken long, and the
  Briefly reversal is visible in the lens"): Briefly reverses visibly and
  dates are spoken long ("Saturday, August twenty-ninth"). This entry sat
  stale for two days after the commit landed — the same decay the send
  dispatch taught, and what finally earned the docs freshness gate above.
- ~~Pre-Builder issue records~~ — built 2026-08-28: all 349 imported as
  read-only records (scripts/import-prebuilder.ts, idempotent); the
  dashboard shows them with a PRE-BUILDER chip and their archive state.
- ~~Echoes archive retrieval~~ — built 2026-08-28: the wand retrieves from
  the Librarian, fails loud without it, and stores the citations it used.

## The dry run — 2026-08-28, all four legs

- **Podcast: RAN FOR REAL.** WT350's draft script synthesized (tts-1-hd,
  echo), wrapped in the bumpers, loudnorm-mastered, tagged with show art,
  uploaded: 68 seconds, 1.78 MB, verified 200 on the CDN. The first audio
  WT Builder has ever produced.
- **Buttondown: RAN FOR REAL.** Draft created (never scheduled, never sent),
  with 3 images rehosted to the CDN first. Re-sending updates the same draft.
- **Website: previewed.** The diff against the live repo shows exactly the
  archive page + emails.json. No commit — a real one publishes.
- **Archive: previewed.** The diff against the corpus repository shows
  exactly the canonical trio. No commit — a real one reaches Thingy.

What remains unrun is exactly the two commits that reach readers, and both
run on send day.

## Test artifact left behind

A 3 KB test image is on the CDN at
`weekly-thing/999/images/f778b1d5eccf.jpg`. It is a blue rectangle under a
fake issue number, uploaded to verify the pipeline. I could not remove it —
the AWS CLI session on this machine is expired and the service's credentials
live in `.env` rather than the CLI's profile. Safe to leave; safe to delete.

## Decisions taken this session

- The window is Friday 00:00 CT to Friday 00:00 CT, half-open, compared as
  instants rather than date strings.
- Micro.blog and Pinboard write-back are live, not read-only.

## Conflicts found in the design, and how they were resolved

The design was revised in layers and some earlier text survived. Each of these
was resolved by recency, using the sync history in `github.md`:

| Conflict | Resolution |
| --- | --- |
| Overview says one 264px right margin; Screens says two margins | **Two margins.** The 2026-08-27T20:33:39Z sync says structure moved back to a 76px left gutter. Record 0014 agrees. |
| Record 0012 is titled "One margin on the right" but its body specifies `76px │ 680px │ 250px` | Body wins; the title is stale. |
| 0012 puts notes at `left: 838px` | Spec's `left: 756px` wins — 838 is arithmetic from the old 158px gutter. |
| 0012's Consequences say "a 360px floor"; token list says "page 360–720" | **Fixed 680px.** A range is the exact failure the margin work exists to prevent. |
| Lens kicker `padding-left: 160px` | Uses gutter + 40px. The 160 was measured when the gutter was 158px. |
| `item-model.md` says the window ends Thursday | Superseded: the span ends Friday. |
| Two `Issue index` sections: the later one (line 47) forbids the kicker, lede, and footnote the earlier one (line 280) specifies | **The later one.** Sections at the top of the file are the newer additions — the same is true of `Send view`. |

## One thing the design did not say — settled 2026-08-28

The wand and a block's review notes both anchor to the top of the same row
in the editorial margin. Settled: during a read the margin belongs to the
notes, and the wand yields — hover-revealed in its reserved 24px inset, the
spec's own idiom for secondary chrome. Read closed, the wand returns.

## Still open, and deliberately not answered here

~~The content cutoff question~~ — settled 2026-08-28: the cutoff is always
midnight, Friday to Friday CT; a Friday-daytime capture belongs to the next
issue by intent. And the issue is dated its Saturday no matter when it
sends — a Sunday send dates back, never forward. See docs/decisions.md.
