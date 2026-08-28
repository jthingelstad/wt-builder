# Where WT Builder stands

Written 2026-08-27, at the end of the rebuild-from-the-design session.

The first build was made from the written contracts without opening the design
files. This session imported the handoff, read the whole spec and its decision
records, and rebuilt the client against them. What follows is what is actually
finished, what is half-finished, and what has never run.

## Working, and verified in a browser against live data

- **Issue index** with the setup sheet (Saturday validation, issue number,
  source-material span, derived window line).
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
- **Send view** — Podcast, Website, Buttondown in run order, the audio gate,
  the stated-not-enforced blocker, real per-step evidence.
- **Sweep** — Pinboard `toread=yes` and Micro.blog Micropub `q=source`, with
  the corrected Friday-to-Friday Central window.

## Not built

- **Collapse mode.** The header control is not there either; it was dropped to
  keep the header inside its width budget and needs to be added back with the
  budget re-checked.
- **The checklist popover.** The strip's ticks jump to their anchors, but the
  strip itself does not open the popover the spec describes.
- **The 352px editorial review panel.** Only the summary bar and the margin
  notes exist. The spec has both, sharing the right rail with the inspector.
- **Audio lens as a numbered script.** It currently renders the website blocks
  filtered to `audio`. It should be 26px mono cue numbers, section cues, long
  spoken dates, reversed Briefly, and the omission and flag strips.
- **Email lens Buttondown block.** The Liquid `subscriber_type` card after
  Membership is missing.
- **Insert points and add affordances.** No `+ Markdown here` at section
  boundaries, no `+ Currently entry` / `+ Write a link here` chips.
- **Photo upload.** The drop zone reads the file and seeds alt text and
  timestamp, but nothing uploads it yet.

## Never run for real

- **The website send.** Previewed only. It commits to
  `jthingelstad/weekly.thingelstad.com` via the Git Data API, and no commit has
  been made.
- **The podcast send.** No audio has been synthesized. It costs an OpenAI TTS
  call and writes an mp3 to the CDN.
- `WT_BUILDER_BUMPERS_DIR` is unset, so audio would render with no intro or
  outro bumper.

## Decisions taken this session

- `0022` — the window is Friday 00:00 CT to Friday 00:00 CT, half-open, compared
  as instants rather than date strings.
- `0023` — Micro.blog and Pinboard write-back are live, not read-only.

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
| `item-model.md` says the window ends Thursday | Superseded by 0022. |

## One thing the design does not say

The wand and a block's review notes both live in the editorial margin and both
anchor to the top of the same row, so at the specified 16px they overlap
exactly. Note bodies are currently inset past the 24px wand. **This needs
Jamie's call** — the design does not say which of the two owns that space.

## Still open, and deliberately not answered here

Whether the content cutoff should move to Friday 11:59 PM CT rather than Friday
00:00, so a Friday-daytime capture makes the next morning's issue. That is a
different decision from 0022 and was not taken.
