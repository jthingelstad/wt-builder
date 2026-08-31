# Handoff: WT Builder

A focused editor for assembling and publishing *The Weekly Thing* — a nine-year-old
weekly newsletter — replacing a Shortcuts + Data Jar + Markdown-flattening workflow.

## Send view

Its own full-screen layer (`position: fixed; inset: 0; z-index: 110`), entered from
the header's `Send` (which reads `Sent 2/3` once some destinations are done). Sticky
52px header: back to the issue, mono `WT350`, the title, and `Send all three` in ink
on the right. Body is an 820px column, `padding: 34px 24px 90px`: a 34px/700 `Send`
heading, a subhead that states the boundary — sending is not the same as being
authoritative — then three destination cards in run order — **Podcast, Website,
Buttondown**.

Each card is white on `#eeedea`, radius 12px, and changes border with state
(`#ece0bd` running, `#cfe3d6` done):

- **Head**, `padding: 16px 18px`, bottom-ruled: a 26px rounded glyph tile
  (`podcast`, `globe`, `mail` — `#eaf3ed`/green when done), the name at 17px/650, a
  state pill (`NOT SENT` grey / `NEEDS YOU` grey / `SENDING` amber / `SENT` green), the destination in 13px `#9a9a9a`, one 13.5px line saying what finishing
  means, and one action button.
- **Blocker strip** when a dependency is unmet: `#fdf9ee`, `circle-alert`, amber
  text. Website carries it — the handoff publishes an audio reference, so the
  podcast should run first. Stated, not enforced.
- **Steps**, one row each, hairline-ruled: an 18px state glyph (`check` green /
  `loader-circle` amber spinning / `circle` `#d6d4d0`), the label, and **the
  evidence that step produced** in 11px mono underneath (`4f2a91c`,
  `24:18 · -16.1 LUFS`, the metadata field names) or as a link (`Draft`, `Live`,
  `File`).

The Podcast's first step is a **gate**: `Read it` opens the Audio lens, `Approve`
signs off and the destination continues. Until then it sits in `NEEDS YOU` — and the
**card's own action button disappears** while waiting, so the step row owns the
interaction. A card button labelled with a state ("Waiting on you") is a dead
primary: it duplicates the pill beside it and does nothing when clicked.

**Failure** — and the state must be real rather than drawn: the card goes `DID NOT SEND` in terracotta with a
`#faefe8` strip explaining that other destinations are unaffected, the failed step
takes a `circle-x` and shows the error text where evidence would go, and the action
becomes **Try again** — resuming from the failed step, not from the beginning.

Beneath the cards, an `AFTER THE ISSUE IS OUT` block on `#fbfbfa`: the archive feed,
named as neither a channel nor a gate, with its state in mono.

## Issue index

A working dashboard, not a landing page: an `Issues` heading and the rows. No kicker,
no explanatory paragraph, no footnote.

Each row is a flex line, `padding: 15px 18px`, white on `#eeedea` (`#dedcd8` for the
live issue), radius 10px: mono `WT350` bold in ink, top-aligned to the title's line box (`line-height: 19.2px`) in a 44px cell, then title + meta, then the
send chips, then actions, then a **fixed 190px right cell**.

The meta is **two lines**. First the publication date, and for anything unpublished a
countdown chip beside it — 9.5px mono in a 4px-radius pill: `IN 9 DAYS` (grey, or
amber inside three days), `TOMORROW` amber, `TODAY` terracotta, `N DAYS LATE`
terracotta. The Weekly Thing has a standing Saturday deadline, so how long you have
is a fact about the issue, not a detail. Second line, quieter (`#b0aeaa`), the count
alone: `21 items` for a draft, `18 links · 9 journal posts` for a published issue.

Where a status pill used to be, three 9px mono **send chips** — `SITE`, `MAIL`,
`POD` — green on `#eaf3ed` when sent, amber while sending, `#6e6e6e` on `#f2f1ef` when not —
quiet, but never below legible contrast; these chips are the dashboard's only
answer to "where has this been sent" —
each naming its destination in a tooltip. One flag cannot describe an issue that is
live on the website with no audio and a draft still in Buttondown (see 0015).

That cell holds the **archive-feed state** on a published row: a mono chip with a
glyph — `check` green `IN ARCHIVE`, `loader-circle` amber `SENDING`, `circle-alert`
terracotta `NOT IN ARCHIVE` — plus a `Send to archive` / `Retry` button with an
`archive` glyph when action is possible.

A **draft row gets a second line instead**: the row is a `flex-direction: column`
with `gap: 12px`, and the progress strip spans the row's full width beneath the line
— ticks 6px tall at `gap: 2px` (`#2f7d4f` done, `#e6e5e2` not) with `6 LEFT` or
`READY` in 9.5px mono at the end. Full width, because a strip squeezed into the
190px cell reads as a fragment; across the row it reads as the issue's state. The
whole strip is a button that opens the issue.

The published page's link is labelled **Website**, never "Archive" — in this product
the archive is the retrieval feed, and the two must not share a word. See decision
0013.

## Overview

WT Builder holds **one live issue** at a time, plus a library of past issues. Items
arrive automatically from Pinboard (bookmarks) and Micro.blog (journal posts) based on
a date window derived from the publish date. The editor is a WYSIWYG rendering of the
issue as readers will see it; every text run is editable in place.

The issue is viewed through four **lenses**. **Source** is the canonical one — every
item as stored, unfiltered and untransformed. **Website**, **Email** (Buttondown), and
**Audio** are renderings of it. The control reads `Source → [Website · Email · Audio]`.

An **Editorial review** can be asked for at any point: notes print in the page's right
margin, beside the block each one is about — proofing, issue rhythm, repetition against
the archive, length. It never writes the issue's prose and never blocks publishing.

The canvas is **the page, left-aligned, between two margins**: structure in a 76px
left gutter, editorial in a 250px right one. The card's left edge and width are
fixed, so nothing either margin does can reflow a sentence. See § Canvas.

All glyphs are [Lucide](https://lucide.dev), inlined as SVG.

The editorial acts the tool supports are: **hold out**, **place**, **order**,
**promote**, and **write**. There is no import queue and no candidate tray.

## What this document is, and what it is not

**This is the authority on interface and behaviour.** `docs/item-model.md` and
`docs/rendering-contracts.md` are the authority on the item shape and what each
edition must contain. Where they disagree, the contracts win on data and this
document wins on the screen.

## Fidelity

**High-fidelity.** Colours, typography, spacing, radii, and interaction states are
final and should be matched closely. The reading column in particular is a
deliberate reproduction of the published archive at `weekly.thingelstad.com` — it
must look like the newsletter, not like an admin UI.

Every value in § Design tokens is transcribed rather than chosen. Where a number
here disagrees with a number elsewhere in this document, the section carrying the
reasoning wins over the bare list — and a handful of measurements were taken when
the structural gutter was 158px rather than 76px, so any arithmetic that assumes
the old gutter is stale. Those are noted where they occur.

---

## Data model

### Issue

```
Issue {
  number: int              // independent of date; last published + 1
  title: string
  dek: string              // one-line summary
  publish: date            // always a Saturday, 12:00 AM CT
  days: int                // source window length, default 7
  status: "draft" | "published"
  nodes: Node[]            // ordered
  items: { [id]: Item }
  orphans: id[]            // held out by section removal
}
```

The **source window** is derived, never stored as two dates:
`end = publish - 1 day` (the Friday at 00:00 CT, exclusive), `start = end - days`
(inclusive). It is a half-open interval compared as instants, not as date strings —
see `src/shared/dates.ts`.

### Node (a section, or a promoted item acting as one)

```
Node {
  id: string
  kind: "section" | "promoted_item"
  type: "intro" | "currently" | "photo" | "notable" | "journal" | "briefly"
      | "membership" | "outro" | "haiku" | "echoes" | "quote"
      | "custom"        // ad hoc titled section, editable heading
      | "mdblock"       // headless markdown block
  label: string
  items: id[]           // ordered
  movable: bool         // echoes is false — always last
}
```

Nodes are an ordered list. `echoes` is pinned last and cannot be moved or removed.
Section labels are fixed vocabulary **except** `custom`, whose heading is editable
inline.

### Item

```
Item {
  type: "intro" | "outro" | "currently" | "photo" | "quote" | "haiku"
      | "pinboard_link" | "journal_post" | "membership" | "echoes" | "markdown"
  authorship: "Jamie" | "syndicated" | "Thingy"
  source: "direct" | "generated" | "Pinboard" | "Micro.blog" | "Thingy"
  source_url, imported_at, published_at
  included: bool          // derived: any channel on AND in window
  chan: { website, email, audio }   // absent means all true
  out_of_window: bool     // derived from the issue window
  heldOut: bool           // derived: no channel on
  snapshot: {...}         // values as imported, for the diff view
  sync_state: "synced" | "syncing" | "failed" | "needs_commentary" | "local"

  // per type
  body, title, commentary, label, attribution, section, tags[]
  media: { alt, caption, timestamp, location }
  refs: [{ issue, url, note }]     // echoes
  status: "draft"                   // Thingy-authored, needs review
  generated_at
}
```

**`included` is derived, not set.** An item is in the issue when at least one of
website / email / audio is checked *and* it falls inside the window. There is no
separate "hidden" flag — see Interactions.

### Mapping to the repo's canonical item model

Use the canonical field names (`docs/item-model.md`), not the shorthand this document uses:

| Shorthand here | Canonical | Note |
| --- | --- | --- |
| `snapshot` | `source_snapshot` | what was imported, for the diff view |
| item order in `node.items[]` | `position` | order is the array, not a field |
| `presentation: "journal"` | `presentation: "normal"` | same meaning |
| `chan: {website,email,audio}` | `rendering_overrides` | see below |
| `section` | `section` | Featured / Notable / Briefly |
| — | `source_id` | not shown on any screen; keep it |

**Contract changes this design implies — record each as a decision record before
building:**

1. **Per-channel inclusion.** `docs/item-model.md` has a single boolean `included`. The
   design replaces it with three booleans, with `included` derived. This is what makes
   hold-out and edition-only items one mechanism instead of two. It is the most
   significant contract change here.
2. **Automatic inclusion by window.** The repo's `workflow-target.md` describes a source
   tray of "unplaced or excluded" items. The design removes the tray: everything inside
   the window is on the page from the start, and the editorial act is exclusion. It also
   answers the item-model open question "should source-tray removal mean excluded,
   deferred, or ignored?" — there is no tray, and removal means held out and visible.
3. **Node types `custom` and `mdblock`.** Ad hoc titled sections and headless Markdown
   blocks are new top-level node types.
4. **Removable standard sections.** Currently, Photo, and Quote are not in every issue.
5. **Issue numbering.** Last published + 1, replacing the Shortcut's baseline-week-count
   minus stored-offset calculation.

---

## Screens

### 1. Editor (`view: "editor"`)

Three columns inside a 52px header: optional left panel (300px), canvas (flex,
`min-width: 720px`), optional inspector (352px). App background `#f2f1ef`.

#### Header (52px, white)

Left → right: **← Issues**; the 22×22 W mark (the wordmark is spelled out only on the
index — the editor header has no room for it); a 1px×22px divider; the issue identity
line — `WT350` at 13.5px/500 (never truncates, `min-width: 64px`) plus mono 10.5px
`#9a9a9a` window meta (`SAT, SEP 5 · SOURCES AUG 29–SEP 4`, truncating first). Then,
right-aligned and all `flex: none`:

- **Lens control** — **Source** as its own button (dark when active), then the three
  channels as a segmented group: `#f2f1ef` track, radius 8px, `padding: 3px`; buttons
  `padding: 5px 13px`, radius 6px, 12.5px/500. Active channel: white bg +
  `0 1px 2px rgba(0,0,0,.08)`. Source sitting outside the group is the whole argument:
  the channels are permutations of it.
- **Collapse** toggle.
- **Review** — asks for an editorial read. Amber count badge when notes exist; label
  becomes "Reading…" while it runs; `#fdf9ee` / `#a07a1f` while the margin is open.
- **Issue** — toggles the left panel.
- **Publish** — flips status (placeholder; see Publishing).

The header is a single non-wrapping flex row, `gap: 8px`, `padding: 0 14px`, no overflow
scrolling. Every control is `flex: none` except the identity line, so at narrow widths the
window meta truncates first and nothing is ever clipped or unreachable. Labels are
deliberately short ("Collapse", not "Collapse all") and the row is budgeted to fit at
**924px with the Review count badge present** — the tightest width worth supporting. Any
control added here has to buy its width from another.

#### Progress strip (36px, under the header)

The whole strip is a button that opens the checklist popover. `padding: 0 16px`,
`border-bottom: 1px solid #e6e5e2`, background `#fff` — `#f7fbf8` when complete.

- Mono 9.5px/.09em label at the left: `WT350`, or `READY` in green when complete.
- **Ticks**: one `flex: 1` **button** per unit, 7px tall, radius 2px, `gap: 2px`.
  `#2f7d4f` when done, `#e6e5e2` when not; hover draws a 2px ink outline. **Clicking jumps
  the canvas to that unit's anchor and selects the item** (item id, node id, or `issue`).
  The strip is a `div`, not a button, so the ticks can be real buttons.
- **Hovering a tick shows a tooltip** anchored to that tick: each tick is wrapped in a
  `position: relative` span, and the card (246px, white, `0 8px 22px rgba(26,26,26,.13)`,
  `pointer-events: none`) sits `top: 15px; left: 50%; translateX(-50%)` — a 7px state dot,
  the unit's own words, and `done` / `not yet` in the state colour. **Edge-aware**: the
  first four ticks anchor `left: 0`, the last four `right: 0`, the rest centre — a centred
  tooltip on the leftmost tick renders off screen. It must be a tooltip, not a swap of the
  strip's readout: swapping changed the readout's width, which resized the flex ticks
  under the cursor.
- Readout at the right: `12 of 20 done`, or **Ready to send** in green, then a
  `circle-check` glyph.

Units are concrete: required direct items written (Intro, Outro, Currently, Photo — or
absent from the issue, which counts as satisfied), one per link needing commentary, one
per failed Pinboard write, Thingy items drafted *and* marked reviewed, a haiku chosen,
and one per open `PROOF` note. The denominator grows when a review finds new proof notes.
- **Issue** toggle (left panel).
- **Publish** button.

#### Left panel — issue metadata + outline (300px, `#fbfbfa`, right border)

Header row: mono `WT350`, spacer, **Edit** / **Done** toggle (`padding: 3px 9px`,
radius 6px; active = black fill).

**At rest (closed)** — one white card, `1px solid #eeedea`, radius 9px,
`padding: 10px 12px`, three lines 12.5px with `#9a9a9a` labels:
`Publishes SAT, SEP 5` · `Sources AUG 29–SEP 4` · `14 items swept in from that span.`
— then a **Re-scan** button. Re-scanning is the most-used act in the panel
(sources fill in all week), so it lives on the resting card, not only behind
Edit. Opening a draft issue also re-scans automatically; the page renders
immediately and the sweep lands when it lands.

**Edit open** — white card, radius 9px, `padding: 11px 12px`, mono 9.5px/.08em
`#9a9a9a` field labels separated by `1px #f0efec` rules:

- ISSUE NUMBER — number input, 88px.
- PUBLISHES — date input. Non-Saturdays snap forward with an amber note:
  "Moved to Saturday — the Weekly Thing always publishes Saturday."
- SOURCE MATERIAL — 7 / 14 / 21 chips (active = black fill) + free number input
  ("days back from Friday"), the derived window line 12px/500, an explanatory note,
  and a **Re-scan** button with the sweep count.
- Below the card: **Start the next issue…**, dashed-border ghost button.

**OUTLINE** — mono label, hint "Drag a row, or use the arrows. Echoes stays last.",
then rows (`padding: 7px 8px`, radius 7px, `gap: 3px`): `grip-vertical` handle, 4×16px
provenance chip, label 12.5px/500, an `eye-off` glyph when the section publishes without a
heading, optional mono badge (`AD HOC` / `MARKDOWN` / `PROMOTED`) on `#f2f1ef`, count,
`x` remove (hover → `#b35c2e`), `arrow-up` / `arrow-down`. Echoes shows `pinned` in
terracotta instead of controls. HTML5 drag-and-drop reorders.

Footer: **+ Section** and **+ Markdown** (dashed ghost, half width each), then
**NOT IN THIS ISSUE** — pill chips for every standard section absent from the outline
(Currently, Photo, Quote, Intro, Outro, Membership, Haiku), each adding it back.

#### Canvas — the issue as a page

`padding: 26px 0 140px`; inner `max-width: 990px`, `padding: 0 20px`.

Above the page card: mono lens kicker + note, indented `padding-left: 160px` to align
with the reading column (e.g. `WEBSITE — EDITABLE` / "Click any text to edit it in
place. The page is the editor.").

The page card: `background: #fff` (Audio lens `#fbfbfa`), `1px solid #e6e5e2`, radius
12px, `padding: 40px 0 52px`.

Every block is a **CSS grid row** of three columns: `76px | 680px | {0 | 250px}` — the
structural controls, the page, and the notes track, which is 0 until a read is open.
Structure is left of the page, editorial right of it: skeleton beside the document,
marginalia in the margin. The gutter is 76px because its contents are **right-aligned**
against the card (`padding-right: 16px`) and the buttons form a **2×n grid** 49px wide,
not a horizontal run.
`align-items: stretch` with the margin cells `align-self: start`, so the card always fills
its row. The page is **left-aligned** and its track is **fixed at 680px, never a range**:
a flexible track absorbs any shortfall between what the grid asks for and what the canvas
has, which rewraps every line of prose the moment a read opens. When the window is too
narrow the canvas scrolls horizontally (`overflow-x: auto`, safe here precisely because
the row's width no longer depends on the canvas's).

**The editorial voice is serif italic.** Note bodies are
`Iowan Old Style, Charter, Georgia, "Times New Roman", serif`, italic, 13.5px/1.5,
`#3a3a3a`; the whole-issue read at the top is the same face at 15.5px/1.55. Nothing else
in the app is serif or italic, so a note never reads as part of the issue — and 11.5px
sans was simply too small to read comfortably in a margin.

**Notes are a measured overlay, never part of the row, and never in the controls' track.**
They render into one `position: relative` host wrapping the rows — which carries an
explicit `min-width` equal to the track sum (756px, 1006px with a read open), or it stays
narrower than its own tracks and the canvas offers no overflow to scroll. Each note is
`position: absolute; left: 756px; width: 250px` — measured from the tracks, **not**
`right: 0`, which resolves against the host box and lands notes on the controls, with `top` computed after render: measure the anchor row's offset and the
note's own height, then walk in document order assigning
`top = max(anchorTop, previousBottom + 10)` so notes slide down instead of overlapping.
A 150ms `top` transition makes a re-stack read as movement. The measure pass writes state
only when a position changes (converges in two frames, cannot loop).

Do not put notes in the grid: in flow a tall note grows the row and — since the card is
painted per row — tears the card into bands; out of flow with `height: 0` they collide
with the next rows' controls. Both were tried. The row grid is `align-items: stretch` with
the margin cell `align-self: start` so the card always fills its row.

**The card is painted per row, not around the grid.** The middle cell carries
`background: {pageBg}`, `border-left`/`border-right: 1px solid #e6e5e2` on every row, plus
`border-top` + `border-radius: 12px 12px 0 0` on the first row and `border-bottom` +
`0 0 12px 12px` on the last. Padding is `40px 40px 0` first, `0 40px` middle,
`0 40px 52px` last. The result reads as one continuous white card containing only the
issue, with both margins outside it.

- **Left cell = the structural margin.** Outside the card. A right-aligned column: the
  section's name in mono 9.5px `#b0aeaa` **when that name does not publish** (Photo,
  Haiku, Membership — see below), then the control row — sync state as a
  23×23 glyph box (`cloud-check` green synced, `loader-circle` amber spinning saving,
  `circle-alert` terracotta failed, `pencil-line` amber awaiting commentary; nothing when
  there is nothing to sync) and a cluster of 23×23 buttons, radius 6px, `1px solid #e6e5e2`, white, each
  holding a 12px Lucide glyph: `corner-up-right` promote, `corner-down-right` demote,
  `arrow-up`, `arrow-down`, `x` remove, `info` inspect (**items only** — sections
  have no inspector). The `x` appears on sections and on items alike: a
  locally-authored item (a drafted Currently entry, a written link) deletes
  outright — no sweep returns it, and there is no undo — while a syndicated
  item is held out, the same durable "no" as section removal. Seeded
  singletons (Photo, Intro, Outro, Haiku, Membership, Echoes) show no item
  `x`; their section's `x` owns removal. **The cluster sits at `opacity: .3` and goes to 1 on row hover**
  (`.rail`, `transition: opacity .12s`). Every row carries `data-anchor` — the item id,
  node id, or `issue`.
- **Middle cell = the page.** The material, and nothing else.
- **Right cell = the editorial margin.** Outside the card. Holds the `wand-sparkles`
  draft button (24×24, `#fdf6f1` on `1px #e0cdbf`, terracotta glyph — full strength when
  the item's text is missing, `.35` and hover-revealed when it would be a redraft) and
  that block's review notes. Each is preceded by a 12px hairline leader and a 4px dot on
  the card's edge.
  - Provenance bar colors: syndicated `#c3d6ee`, Thingy `#eccdb9`, Jamie's own
    `transparent`. Toggleable (prop `provenanceBars`).

Block types, in the Website lens:

| Block | Rendering |
| --- | --- |
| Head | mono kicker (`WT350 · SAT, SEP 5, 2026` — no "draft"; everything here is a draft until it is published); title 40px/700/1.1/-0.028em; dek 17px/1.55 `#4a4a4a`; byline row — 30px `#e6e5e2` avatar circle "JT", name 13px/500, mono stats `1,240 words · 7 links · ~6 min read` (website only — see Source lens) |
| Section rule | `1px #e6e5e2`, `margin: 30px 0` |
| H2 | 25px/700/-0.02em + `#` in `#d6d4d0`; optional mono note pill (`AD HOC SECTION`, `FIXED LAST · NOT IN AUDIO`). **Only for sections whose name publishes** — Currently, Notable, Journal, Briefly, Echoes, ad hoc. Photo, Haiku, Membership, Intro, Outro print no heading; their name goes to the structural margin |
| Paragraph | 16.5px/1.7, `margin-bottom: 15px` |
| Currently | `**Building:** value` — bold label, colon, editable value, both inline |
| Photo | **Empty:** a 300px dashed `#dedcd8` / `#fafaf9` drop zone — a `<label>` around a hidden `input[type=file]` with a 24px `image-plus` glyph, "Drop a photo here, or click to choose", and "Time and place are read from the file. Both stay editable." **Set:** the image at full column width, radius 6px, with hover-revealed **Replace** (label + hidden input) and `trash-2` **Remove** over the bottom-right. Then caption 16px/1.6 and a meta line 14px `#6e6e6e` (`Aug 29, 2026 · 8:35 PM · Cannon Lake, Warsaw, MN`). Dropping a file stamps the timestamp from its modified date and seeds empty alt text from the filename |
| Quote | `border-left: 3px solid #e6e5e2`, `padding-left: 20px`; text 19px/1.6 italic; attribution 14px `#6e6e6e` |
| Link title | 19px/700/1.35 in `#1a5fb4` + mono domain `#b0aeaa` |
| Journal date | 17px/700, `margin: 22px 0 10px`. **Weekday only** — "Saturday" |
| Journal entry | linked time (`10:54 AM`) — em dash `#9a9a9a` — editable body, all inline at 16.5px/1.7 |
| Briefly | description → **linked title** (bold `#1a5fb4`), arrow in `#9a9a9a`, inline |
| Haiku | 18px/700/1.85, `white-space: pre-line` |
| Byline chip | `#faefe8` pill, 5px terracotta dot, "By Thingy" 11.5px/600 `#b35c2e` |
| Echoes refs | 13.5px/1.7 `#6e6e6e`, "Grounded in issue 341, issue 349 — Owning the Rails." |
| Markdown block | mono `MARKDOWN BLOCK` label (hidden until row hover), then `white-space: pre-wrap` body at 16.5px/1.7 |
| Held-out strip | dashed `#dedcd8`, `#fafaf9`, radius 7px: mono channel note (`EMAIL ONLY` blue / `NOT IN THIS ISSUE` grey), truncated text `#a5a3a0`, **Put back** / **Add here too** button |
| Add affordances | dashed ghost chips: `+ Currently entry`, `+ Write a link here`, `+ Markdown block`, and a tail row (`+ Intro`, `+ Quote`, `+ Currently`, `+ Photo`, `+ Outro`, `+ Section`) |
| Insert point | at every section boundary, hidden until hover: a hairline + `+ Markdown here` / `+ Section here` pills |

**Editing.** `contenteditable` on each run, committed on blur. Empty runs show
placeholder text via `[data-ph]:empty:before` in `#b9b7b2`. Focus state:
`background: #fff8e3` + `box-shadow: 0 0 0 4px #fff8e3`. In a published issue,
everything is read-only and the kicker reads `WEBSITE — PUBLISHED`.

#### Collapse mode

Replaces the blocks with one row per section: `#fbfbfa`, `1px solid #eeedea`, radius
9px, `padding: 11px 14px`, `gap: 12px` — handle `⠿`, label 16px/600, optional badge,
first-line preview (120 chars, truncated, `#9a9a9a`), count (`4 items` / `3 of 4`),
↑ / ↓, ✕, `fixed last` for Echoes. Draggable; drag target tints
`#f3f6fb` / border `#c3d6ee`. Clicking a row expands back with that section selected.
Nothing is editable in this mode.

#### Source lens — the canonical items

Same grid, same margins, but the reading column shows what is *stored* rather than what a
channel renders. Nothing is filtered: held-out items appear marked `HELD OUT`,
out-of-window items appear marked `OUTSIDE WINDOW`.

- Kicker: `SOURCE — CANONICAL ITEMS` / "Every item as stored, nothing filtered or
  transformed. The three channels are renderings of this."
- Byline stats switch to an editor's measure: `10 nodes · 22 items · 267 words`, set as a
  mono line. **The avatar-and-name byline does not appear** — it is a website rendering
  artifact, not part of the item model.
- **Section heading** — 22px/700/-0.018em + mono 10px/.06em `#b0aeaa` meta:
  `SECTION · notable · 3 ITEMS` or `PROMOTED · journal_post · 1 ITEM`.
- **Item header row** — mono type name (`PINBOARD LINK`), a 5px authorship dot + name
  (Jamie ink / Pinboard·Micro.blog blue / Thingy terracotta), then right-aligned: a state
  chip (`HELD OUT`, `OUTSIDE WINDOW`, `PROMOTED`, `NEEDS REVIEW`) and — **only when the
  item is not in all three editions, or an automatic rule applies** — three 17×17 channel
  chips `W` `E` `A` (mono 9px/700, black fill when on, white with `#e6e5e2` border when
  off, `#d6d4d0` and inert when locked). An ordinary item shows no chips.
- **The item's own text**, editable: a 17px/600 primary line where the type has one
  (link title, journal title, photo alt) and a 16.5px/1.7 body (commentary, post text,
  caption).
- **One mono meta line**, 11px `#a5a3a0`, joining the structural facts with `·` —
  placement, tags, bookmark/publication date, presentation, location, Thingy status,
  Echoes citations — ending in the source domain as a link. A second meta line appears
  only when the text has diverged from `source_snapshot`: `as imported: “…”`.

The design rule: Source is **prose plus one quiet line**, never a labelled field grid.
The grid version was truthful and unreadable.

#### Email lens

Same document, minus items with `email: false`. Adds one Buttondown-only block after
Membership: mono Liquid in a `#f3f6fb` / `1px #dde6f3` card, `#1a5fb4` text —
`{% if subscriber.subscriber_type == 'premium' %}…` — with a caption explaining the
website prints the invitation variant as prose.

#### Audio lens

A numbered script, not a page. Rows are `26px` mono cue numbers (`01`, `02` …) +
16.5px/1.7 text.

- Fixed open: "You're listening to an AI-generated audio version of The Weekly Thing,
  issue 350." Fixed close: "That brings us to the end of The Weekly Thing."
- Section cues: mono `NOW, THE NOTABLE SECTION` + hairline.
- Dates are spoken long: "Saturday, August twenty-ninth."
- **Briefly reverses**: title first (highlighted `#fff2d6`), then description, with a
  note explaining the page order is the opposite.
- **Currently** speaks "label, then value".
- Omission strips (dashed, mono `NOT SPOKEN`): Photo ("omitted rather than narrated"),
  Echoes ("never spoken").
- **Membership and Haiku are spoken.** Membership is introduced as Thingy's words
  before the words themselves; Haiku is read one line at a time so the pauses fall
  on the line breaks. See `rendering-contracts.md`.

#### Editorial review panel (352px, white, left border)

Shares the right rail with the inspector — never both at once. Opening an item from a
note swaps to the inspector and leaves a `← Review` button (`#fdf9ee` / `1px #ece0bd` /
`#a07a1f`) in its header.

1. Mono `EDITORIAL REVIEW` + ✕ close.
2. **While running** — "Reading the issue…" and four check rows with 6px dots that fill
   in: Balance and rhythm, Against the archive, Length, Proofing. ~1600 ms.
3. **Staleness row** — 11.5px `#9a9a9a` ("Read from this draft." / "You have edited 3
   things since this read.") + **Read again**, above a `1px #f0efec` rule.
4. **`WHAT'S WORKING`** — mono label in `#2f7d4f`, then one or two lines at 13px/1.6.
5. **Note groups**, in order: `PROOF`, `WORTH YOUR TIME` (max 2), `ALSO NOTICED`. Group
   header is mono 9.5px/.08em + a faint count.
6. **A note** — `padding: 10px 12px`, `margin: 0 -12px`, radius 8px. Header row: a mono
   9px kind badge (`PROOF` amber on `#fdf9ee`, `ARCHIVE` blue on `#f3f6fb`, `RHYTHM` /
   `LENGTH` `#6e6e6e` on `#f5f4f2`), the anchor name in 11px `#9a9a9a` (truncating), and
   a 19×19 ✓ dismiss (hover green). Body 13px/1.55. Proof notes add a mono
   `was → now` line — strikethrough terracotta, arrow, green. Footer: **Show me** and,
   for archive notes, a `WT346 ↗` link. Selected note: `#fdf9ee` +
   `inset 3px 0 0 #a07a1f`.
7. **Empty state** — "Nothing worth raising." in `#2f7d4f`, then "Read it again after you
   change something."
8. **Footer** — "Eddy reads the website edition and writes no prose. Notes are advisory
   — they never gate publishing, and every word in the issue stays yours."

#### Editorial review — the margin and the bar

**Summary bar**, above the page card, in a two-column grid (`{gutter} 1fr`) so it starts at
the reading column and spans the editorial margin too. Mono `EDITORIAL / READ` in
`#a07a1f` in the gutter; the bar itself is `1px solid #ece0bd` on `#fdf9ee`, radius 10px,
`padding: 13px 16px`.

- **While running** — "Reading the issue…" and four inline check items with 6px dots:
  Balance and rhythm, Against the archive, Length, Proofing. ~1600 ms.
- **Done** — `WHAT'S WORKING` prose at 13.5px/1.6, then the count line at 11.5px
  `#a07a1f` (`9 notes in the margin · 3 proof · 2 worth your time · read from this
  draft`), then **Read again** and **Done** buttons.
- **Empty** — "Nothing worth raising." / "That is everything cleared." after dismissals,
  with "Read it again after you change something."

**A margin note** — a 4px dot on the card's edge, a 12px hairline leader, then
`border-left: 2px solid <kind>`, `padding-left: 9px`, radius `0 5px 5px 0`; *worth your
time* notes get a `#fdfcf8` ground. Header row: mono 8.5px kind label in the kind colour,
then two 18×18 actions — **`check` done** (hover green) and **`ban` ignore** (hover grey).
Body 11.5px/1.5 `#4a4a4a` with `text-wrap: pretty`. Proof notes add a mono 10.5px
`was → now` line — strikethrough terracotta, arrow, green. Archive notes add a
`WT346` + `external-link` link.

**Cleared notes** drop to `opacity: .55`, grey out their edge, strike through if done, and
swap the two actions for a `DONE` / `IGNORED` tag plus an `undo-2` reopen. The read bar
tallies `3 done · 2 ignored` with a **Show cleared** toggle. Only open notes count against
the progress strip — an ignored note is resolved, not outstanding.

Kind colors — `PROOF` `#a07a1f` on edge `#e8d7a8`; `ARCHIVE` `#1a5fb4` on `#c3d6ee`;
`RHYTHM` and `LENGTH` `#6e6e6e` on `#dedcd8`.

Notes are re-derived from the draft on every render: fixing a typo removes its note with
no re-read, and a note whose anchor is deleted or held out disappears with it.

#### Inspector (352px, white, left border)

Opened by the rail `i` button. `padding: 14px 18px 40px`.

1. Mono kicker (item type) + ✕ close; title 17px/600.
2. **Authorship banner** — tinted row, radius 8px, 6px dot: "Syndicated from Pinboard"
   `#1a5fb4` on `#f3f6fb` / "Written by Thingy" `#b35c2e` on `#fdf6f1` / "Written by
   Jamie" `#1a1a1a` on `#f5f4f2`, with a right-aligned note ("Edits sync back").
3. **PLACEMENT** (Pinboard links) — Featured / Notable / Briefly segmented buttons;
   note: "Pinboard tags suggested notable. Placement here wins for the issue."
4. **Sync card** — tinted by state, title + 6px dot + **Retry** when failed, and an
   explanation ("Last writer wins. What you typed here is the current value on the
   bookmark.").
5. **Promotion card** (journal posts) — current state, why, and
   **Promote to its own section** / **Return to Journal**.
6. **Thingy / generation card** — one card serves Membership, Echoes, Haiku, and link
   descriptions. Tinted by kind: Thingy terracotta (`#fdf6f1` / `#f0dfd4`), link amber
   (`#fdf9ee` / `#ece0bd`), haiku neutral (`#fbfbfa` / `#e6e5e2`). Title + a `✦ Draft` /
   `✦ Redraft` / `✦ Generate 3` / `✦ Again` button, a one-line explanation, a busy row
   ("Reading WT350 and the archive…", "Reading the linked page…"), then
   `CANDIDATES` / `OPTIONS — PICK ONE OR IGNORE THEM` as selectable cards (13px/1.55,
   `white-space: pre-line`; the current pick gets a colored border and 600 weight).
   Footer states the rule — Thingy keeps its byline; a picked link description becomes
   Jamie's text and syncs to Pinboard as his. Thingy items also carry **Mark reviewed**
   (`circle-check`), which is what satisfies the "reviewed by you" progress unit.
7. **APPEARS IN** — the hold-out control. Explanatory line, then **All / Email only /
   Hide** presets (active = black fill), then three full-width channel rows: 15px
   checkbox (radius 4px, `1.5px` border, black when on), channel name 12.5px/600 at
   66px, and a per-channel note ("Description, then linked title" / "Reversed: title
   first" / "Photo is omitted from audio, not narrated"). Audio is **locked with `–`**
   when the type has an automatic rule. When nothing is checked, a dashed note: "Held
   out of WT350. It stays on Pinboard — only its place here is gone."
8. **PROVENANCE** — source, source URL, imported/published time, and (when edited) an
   "As imported" diff card with the original snapshot in italics.
9. **Remove from this issue** — outlined, hover terracotta, with reassurance that the
   source post stays published.

### 2. Overlays

- **Checklist popover** — anchored `top: 56px; right: 16px`, 352px, white, radius 10px,
  `box-shadow: 0 14px 40px rgba(26,26,26,.14)`. Header mono `BEFORE WT350 IS READY TO
  SEND`. Rows are buttons (7px dot + label 13px + context 11.5px `#9a9a9a`, hover
  `#fafaf9`) that select the offending item. Generated from: links with no commentary
  (amber), failed syncs (terracotta), Thingy drafts not yet reviewed (blue). All-clear
  state in `#2f7d4f`.
- **Start a new issue sheet** — modal on `rgba(26,26,26,.28)`, 460px, radius 12px,
  `box-shadow: 0 24px 60px rgba(26,26,26,.22)`, `padding-top: 88px` from viewport top.
  Title 18px/600, a line naming the issue being replaced, then PUBLICATION DATE (with
  green confirmation `SAT, SEP 12 · 12:00 AM CT` or an error), ISSUE NUMBER (seeded
  last-published + 1, note "Follows WT350"), SOURCE MATERIAL (7/14/21 + free number,
  derived window line). Footer `#fbfbfa`: **Cancel** / **Create WT351**.

---

## Interactions & behavior

**Automatic inclusion.** Everything bookmarked or posted inside the window is on the
page from the moment the issue exists. Changing `publish` or `days` re-derives
`out_of_window` for every syndicated item; items that fall out disappear from the page,
and a section whose items all fell out renders its heading at `opacity: .45` with a mono
note `ALL 4 FELL OUTSIDE THE WINDOW` rather than vanishing silently.

**Hold-out = no channels.** `setChan(item, channel, bool)` recomputes
`included = website || email || audio`. `heldOut` is its inverse. Held-out items render
as the compact strip described above, so exclusion stays visible and reversible. An item
with exactly one channel on is an **edition-only item** and says so
(`EMAIL ONLY`, blue). The Source lens surfaces the same state as `W E A` chips, shown
only when the set is not the default.

**Published section names.** `NOHEAD = [photo, haiku, membership, intro, outro, mdblock]`
— these publish with no heading, so the canvas prints none. Their name appears in the
structural margin instead, and single-item ones fold the section's move/remove controls
into the item's own row.

**Placement.** Pinboard tags suggest a section (`notable`, `briefly`); the inspector's
Placement buttons override for this issue and win.

**Promotion.** A journal post *with a title* can be promoted: it leaves the Journal
group and becomes a top-level node (`kind: "promoted_item"`) that still carries its
`PROMOTED · MICRO.BLOG` badge and its date line. Demoting puts it back in Journal,
re-sorted by `published_at`. Untitled posts cannot be promoted — the inspector says why.

**Section removal.** Removing a section deletes locally-authored items but **holds out**
syndicated ones: they move to `orphans` and render in a `Held out` group at the end of
the page with `Put back`, which restores them to their natural section (creating it if
needed).

**Ordering.** Sections: drag in the outline or collapse view, or ↑ / ↓ in either.
Items: ↑ / ↓ in the gutter rail. Echoes is immovable and always last.

**Write-back, simulated.** Editing a Pinboard title/commentary or a Micro.blog
body/title sets `sync_state: "syncing"`, then resolves to `synced` after **1200 ms**
(or `failed` if flagged). Semantics: **last writer wins**; a failure keeps the local
edit and ships it in the issue, with Retry available. Thingy generation: **1400 ms**.
Haiku candidates: **1200 ms**. Re-scan: **1100 ms**.

**Saturday rule.** A non-Saturday publish date snaps forward to the next Saturday with a
visible amber note rather than being rejected.

**Publish.** The button flips `status` and returns to the index; a
published issue opens read-only. That is a placeholder — the real contract is in
`docs/publishing-lifecycle.md` and is summarized below.

**Editorial review.** Asked for explicitly — never on open, on save, or on reaching
Ready. A read replaces the previous one; there is no note backlog. Notes are re-derived
from the current draft on every render, so **fixing a typo removes its note without
re-running the review**, and a note whose anchor is deleted or held out disappears with
it. Notes are observation-only: no replacement prose for the issue's own text, no
accept-to-apply. The only action on a note is ✓ (done with it). Two classes — mechanical
`PROOF` and judgment `RHYTHM` / `ARCHIVE` / `LENGTH` — with at most two judgment notes
marked *worth your time*. Advisory only: never in the Ready checklist, never a gate.
Reads the website edition.

**Generation.** One pattern for Haiku, Membership, Echoes, and link descriptions: an
explicit `✦` ask; a 1500 ms busy state; two or three **candidates** rendered as
selectable cards in the inspector; **nothing written to the issue until Jamie picks one**,
and editable immediately after. Picking a link description writes `commentary` and
triggers the Pinboard write-back as Jamie's text. Thingy items keep their visible byline
regardless of how heavily they are edited. Never auto-generated on assembly, and there is
no "generate everything".

**Hover-revealed chrome.** Gutter rail `.3 → 1`; markdown-block labels and section
insert points `0 → 1`; all `transition: opacity .12s`.

## State

The state this design assumes, as a guide to the real store:

```
nodes[], items{}, issue{}, library[], orphans[], lastPublished
view: "index" | "editor"
lens: "source" | "website" | "buttondown" | "audio"
selected: itemId | null          // inspector
panelOpen, metaOpen, collapsed, showChecklist: bool
setup: {publish, days, number} | null
review: bool                     // a read has completed
reviewBusy, reviewOpen: bool
noteState: { [noteId]: "done" | "ignored" }
showCleared: bool
editsSince: int                  // patches since the last read — drives staleness
drafts: { [itemId]: string[] }   // generation candidates, awaiting a pick
draftBusy: itemId | null
dragId, seq, rescanning, pubSnapped
```

Real data needs: issue CRUD; a sweep endpoint (Pinboard bookmarks + Micro.blog posts in
a date range); write-back to both; renderers for website, Buttondown Markdown, and audio
script; Thingy generation for Membership/Echoes and haiku candidates; and an editorial
review endpoint.

**The review endpoint.** Send the assembled issue plus enough archive context to judge
repetition; get back a list of `{kind, anchor, text, was?, now?, archive_ref?}`. Anchors
are item ids, node ids, or `issue`. The model must be instructed to write no replacement
prose for the issue's own text — that constraint is the product, not a preference. Eddy's
prompt (in `librarian-thing`'s git history — the workshop retired at the
studio-thing → librarian-thing rename) is the right starting point for the
editorial voice: lead with what's working, concrete notes tied to
the issue over general writing advice, archive continuity as the high-value catch, and
`PASS` when there is genuinely nothing to say. Drop its tool-calling and conversational
scaffolding. Proofing should be a separate, deterministic pass — not the same model call
as judgment, so a typo is never missed because the model was busy having opinions.

**The draft endpoint.** Per item, returns 2–3 candidate strings and nothing else — it
never writes. Four callers: haiku (from the assembled issue), Membership (Thingy, from
campaign facts), Echoes (Thingy, from the assembled issue plus archive retrieval), and
link description (Eddy, after fetching and reading the linked page — his prompt is
explicit that the page gets read before the take is critiqued).

## Sending

**Designed. See § Send view at the top of this document**, which is the surface,
and `docs/publishing-lifecycle.md`, which is the contract. What the build must
respect:

**Two issue states**, `draft` and `published`, plus **per-destination send state**
(`none | sending | sent | failed`) carrying its own timestamp, external
identifier, and error. An eight-state lifecycle was specified once and never
built; the evidence per leg is what the Send view actually shows, and it is
enough. Do not reintroduce a single mutable status that tries to describe three
independent destinations at once.

**Destinations** — WT Builder owns every publishing leg and sends directly:
`weekly.thingelstad.com` (website edition, committed handoff, carrying an audio
*reference* only), Buttondown (email edition as a draft; drafting is distinct
from scheduling or sending), `files.thingelstad.com` (the audio file's only home).

**Run order is Podcast → Website → Buttondown**, because the website handoff
publishes an audio reference that needs a file to resolve to. The dependency is
**stated, not enforced**: the Website card carries a blocker strip and nothing
prevents sending out of order.

**The archive is not a publishing destination.** Issue text is committed to the
archive repo *after* publication so Thingy can cite it. It is its own leg with its
own evidence and retry, it never gates readiness, and its failure must not degrade
the published state. Send text only — the archive receives no audio.

**Sync semantics** — Pinboard and Micro.blog both write back, last-writer-wins,
and a failed write never discards the local edit. Micro.blog reads and writes
through Micropub `q=source`, which returns the exact Markdown the post is stored
as; the JSON Feed returns rendered content and cannot be handed back. Inclusion,
ordering, promotion, and presentation belong to WT Builder; the original post
stays canonical.

**Thingy** calls the archive's retrieval endpoint **server-side with a service
credential — never from browser code.** All credentials are server-side secrets.

## Design tokens

**Surfaces** `#f2f1ef` app · `#fff` page/cards · `#fbfbfa` panels/inset ·
`#fafaf9` subtle · `#f5f4f2` neutral tint

**Borders** `#e6e5e2` default · `#eeedea` light · `#f0efec` divider · `#dedcd8` button ·
`#f5f4f2` faintest

**Text** `#1a1a1a` ink · `#4a4a4a` dek · `#6e6e6e` secondary · `#9a9a9a` muted ·
`#a5a3a0` held out · `#b0aeaa` faint · `#c9c7c2` / `#cdcbc7` / `#d6d4d0` marks ·
`#b9b7b2` placeholder

**Accents** blue `#1a5fb4` (syndicated, links) · terracotta `#b35c2e` (Thingy, destructive,
pinned) · green `#2f7d4f` (synced, valid) · amber `#a07a1f` (attention)

**Tints** blue `#f3f6fb` `#eef3fa` `#dde6f3` · terracotta `#fdf6f1` `#faefe8` `#f0dfd4` ·
green `#f2f8f4` `#f7f9f7` `#d6e8dc` `#dfe9e2` · amber `#fdf9ee` `#ece0bd` `#fff2d6` ·
edit focus `#fff8e3`

**Provenance bars** syndicated `#c3d6ee` · Thingy `#eccdb9` · own `transparent`

**Type** UI: system sans (`-apple-system, BlinkMacSystemFont, "Helvetica Neue",
Helvetica, Arial, sans-serif`). Labels/eyebrows/data: `ui-monospace, SFMono-Regular,
Menlo, monospace`.

| Role | Value |
| --- | --- |
| Issue title | 40 / 700 / 1.1 / -0.028em |
| Index H1 | 38 / 700 / 1.1 / -0.028em |
| Section H2 | 25 / 700 / -0.02em |
| Link title | 19 / 700 / 1.35 |
| Quote | 19 / italic / 1.6 |
| Haiku | 18 / 700 / 1.85 |
| Dek | 17 / 1.55 |
| Journal date | 17 / 700 |
| Body | 16.5 / 1.7 |
| Collapsed row label | 16 / 600 / -0.012em |
| Photo caption | 16 / 1.6 |
| Inspector title | 17 / 600 / -0.012em |
| Controls / buttons | 12.5 / 500 |
| Notes | 11.5–12 / 1.45–1.5 |
| Mono eyebrow | 10 / .09em |
| Mono field label | 9.5 / .08em |
| Mono badge | 9–9.5 / .06–.07em |

**Spacing** 3 · 5 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 22 · 26 · 30 · 40 · 52
**Radii** 4 · 5 · 6 · 7 · 8 · 9 · 10 · 12 · 99 (pill)
**Shadows** popover `0 14px 40px rgba(26,26,26,.14)` · modal
`0 24px 60px rgba(26,26,26,.22)` · active segment `0 1px 2px rgba(0,0,0,.08)`

**Fixed dimensions** header 52 · progress strip 36 · left panel 300 · inspector 352 ·
canvas min-width 720 · page container max 1192 (`padding: 0 20px`) · structural margin 168
· page 360–720 · editorial margin 140–264 · card padding 40/40/52 · rail buttons 23×23
(24×24 in collapse) · note actions 18×18 · wand 24×24 · outline buttons 20×20 · source
channel chips 17×17 · photo placeholder height 300

## Assets

**Icons: [Lucide](https://lucide.dev), inlined as SVG** with Lucide's own attributes
(`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, round
caps and joins) so every glyph takes its colour from its control. Sizes: 12px in 23px
controls, 13px in 24px, 10px in 18px. In use: `arrow-up`, `arrow-down`,
`corner-up-right`, `corner-down-right`, `x`, `info`, `wand-sparkles`, `check`, `ban`,
`undo-2`, `rotate-cw`, `circle-check`, `external-link`, `grip-vertical`, `plus`, `cloud-check`, `loader-circle`,
`circle-alert`, `pencil-line`, `eye-off`. A
production build should install the `lucide` package and import components rather than
inlining. Every icon-only control carries a `title`.

No other assets. The photo is a CSS hatch placeholder and the avatar is initials in a
circle. Real photo upload/display is undesigned — if v1 needs it, ask.

## Open questions for v1

1. **Window end time.** Still open. The cutoff is Friday 00:00 to Friday 00:00
   Central, so a Friday-daytime bookmark lands in the *next* issue. Should it end
   Friday 11:59 PM CT instead?
2. **Gutter rail discoverability.** At rest the rail is `opacity: .3`. Acceptable, or
   does it need a persistent affordance?
3. **Review scope.** It reads the website edition. Should it ever flag an audio script
   that reads badly aloud — and if so, as a fourth note class or a separate read?
4. **Archive grounding for review.** Repetition notes need the same corpus Thingy uses.
   That is a server-side retrieval call with a service credential, so review cannot be
   a browser-side feature.

## Where the rest of this lives

| File | What it is |
| --- | --- |
| `docs/decisions.md` | The decisions that are invisible in the code — absences and cross-repo boundaries |
| `docs/status.md` | What is built, what is not, and what has never been run |
| `docs/rendering-contracts.md` | What each edition must contain |
| `docs/item-model.md` | The canonical issue and item shape |
| `design/screenshots/` | What it looks like |

The design bundle that produced this document also carried numbered decision
records. They were **not** merged into the repo: their numbers collided with the
repo's own, the bundle itself used two different schemes, and the reasoning they
held is what makes this document as long as it is. The alternatives that were
tried and rejected are stated inline here, in the section they apply to, and
quoted in code comments where they constrain something.

The clickable prototype was deleted once the design was implemented. It used a
superseded data model — an `included` boolean rather than per-channel flags — and
kept being mistaken for the specification. **This document is the specification.**
