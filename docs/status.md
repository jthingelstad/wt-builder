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
  the stated-not-enforced blocker, real per-step evidence.
- **Sweep** — Pinboard `toread=yes` and Micro.blog Micropub `q=source`, with
  the corrected Friday-to-Friday Central window.

## Not built

- **The 352px editorial review panel.** Only the summary bar and the margin
  notes exist. The spec has both, sharing the right rail with the inspector.
- **Insert points and add affordances.** No `+ Markdown here` at section
  boundaries, no `+ Currently entry` / `+ Write a link here` chips.
- **Audio lens details.** The script and its cues are right, but Briefly does
  not visibly reverse in the lens and dates are not yet spoken long
  ("Saturday, August twenty-ninth").
- **Pre-Builder issue records.** Issues 349 and back should appear on the
  dashboard as read-only records — number, title, archive link, one Markdown
  block — for continuity (docs/decisions.md forbids parsing them into items).
  Jamie confirmed 2026-08-28 this belongs here, like /ops/ did.
- ~~Echoes archive retrieval~~ — built 2026-08-28: the wand retrieves from
  the Librarian, fails loud without it, and stores the citations it used.

## Never run for real

- **The website send.** Previewed only. It commits to
  `jthingelstad/weekly.thingelstad.com` via the Git Data API, and no commit has
  been made.
- **The podcast send.** No audio has been synthesized. It costs an OpenAI TTS
  call and writes an mp3 to the CDN.
- ~~`WT_BUILDER_BUMPERS_DIR` is unset~~ — resolved 2026-08-28: the bumpers
  live in `assets/bumpers/` and are the default.
- **The archive send.** Built 2026-08-28 — it commits `data/issues/{N}/` into
  the corpus repository — and no commit has been made. Until this session it
  did not exist at all, while the dashboard offered its button anyway.

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

## One thing the design does not say

The wand and a block's review notes both live in the editorial margin and both
anchor to the top of the same row, so at the specified 16px they overlap
exactly. Note bodies are currently inset past the 24px wand. **This needs
Jamie's call** — the design does not say which of the two owns that space.

## Still open, and deliberately not answered here

Whether the content cutoff should move to Friday 11:59 PM CT rather than Friday
00:00, so a Friday-daytime capture makes the next morning's issue. That is a
different decision from 0022 and was not taken.
