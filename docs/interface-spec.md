# Handoff: WT Builder

A focused editor for assembling and publishing *The Weekly Thing* — a nine-year-old
weekly newsletter — replacing a Shortcuts + Data Jar + Markdown-flattening workflow.

## Send view

Its own full-screen layer (`position: fixed; inset: 0; z-index: 110`), entered from
the header's `Send` (which reads `Sent 2/3` once some destinations are done). It
lies over the editor, which stays mounted and inert beneath it, so going there and
back keeps the lens, the inspector and the review's triage, and does not re-scan
(review 2026-09-27 §2.4). Sticky
52px header: back to the issue, mono `WT350`, the title, and `Send all four` in ink
on the right. Every bulk run (`Send all four` / `Send the rest`, `Re-send all sent`)
asks first, with a `confirm` naming its legs in run order: the editor's way in sits
where that button does, and a double-click on it once sent three legs in one
gesture (review 2026-09-27 §2.4). Body is an 820px column, `padding: 34px 24px 90px`: a 34px/700 `Send`
heading, a subhead that states the boundary — sending is not the same as being
authoritative — then four destination cards in run order — **Podcast, Website,
Buttondown, Archive**. The archive is a card like the others, not a footnote (Jamie,
WT351: "it is not less important"); it still publishes nothing and gates nothing,
and its blocker says it goes after the website and Buttondown.

**The checks line** (2026-10-04, plan before WT353 item 1). Above the cards, one
line for the link and email checks, and nothing more: green (`--green-1` on
`--green-3`, `check`, "Links and email: nothing to act on.") when no row has a link
or email finding open, amber (`.send-warn`, `circle-alert`) only when one does,
naming each such row in reading order as an underlined jump — `Flipcash (dead link)`
— that goes back to the editor and takes him to the row, as a strip tick does
(scroll and tint, nothing selected). What is the whole email's (its size near
Gmail's clip, a blocklisted domain no row prints) follows on the same line. There
is no **Check links** button and no link or deliverability box: a link is checked
as it arrives and said on its row while he writes (Jamie, after WT352: "at that
point I'm about sending, not editing"). The checklist's own amber line ("N of M
things on the checklist are still open") shows only while one is, and counts
neither the Links checked nor the Deliverability pill. The dead-link and
blocklist asks stay on the website and Buttondown cards (**Commit with dead
links…**, **Send with a blocklisted domain…**).

Each card is white on `#eeedea`, radius 12px, and changes border with state
(`#ece0bd` running, `#cfe3d6` done):

- **Head**, `padding: 16px 18px`, bottom-ruled: a 26px rounded glyph tile
  (`podcast`, `globe`, `mail` — `#eaf3ed`/green when done), the name at 17px/650, a
  state pill (`NOT SENT` grey / `NEEDS YOU` grey / `SENDING` amber / `SENT` green), the destination in 13px `#9a9a9a`, one 13.5px line saying what finishing
  means, and one action button.
- **Blocker strip** when a dependency is unmet: `#fdf9ee`, `circle-alert`, amber
  text. Website carries it — the handoff publishes an audio reference, so the
  podcast runs first. Enforced: the server refuses a website send until an
  audio reference is recorded (the podcast's last good send); while there is
  none the card's action is **Commit without audio…**, which asks first
  (`?force=1`).
- **Steps**, one row each, hairline-ruled: an 18px state glyph (`check` green /
  `loader-circle` amber spinning / `circle` `#d6d4d0`), the label, and **the
  evidence that step produced** in 11px mono underneath (`4f2a91c`,
  `24:18 · -16.1 LUFS`, the metadata field names) or as a link (`Draft`, `Live`,
  `File`).

The Podcast's first step is a **gate**, `Read the script`: Jamie does not read the
script himself (WT351), so `Have it read` has a model read it for the ear —
markup, symbols, cut-off sentences, a list run together — and the step shows its
summary and each finding as `[block] Item: "quote" — problem`, naming the item or
section the block speaks. A mechanical lint reads first (2026-10-04,
`src/shared/render/script-lint.ts`): a stray `)` or `]`, a `](`, a URL, Markdown or
HTML left behind, an emoticon or emoji. Only an unbalanced bracket counts, so
"(as a dot)" is fine. Its findings lead the list and the model's same finding is not
repeated (WT352's "The Replacements)" was missed by the model). `Approve` is enabled once
it has been read, findings or not; it is advice, never a veto. The review and the
approval are saved on the issue and tied to the script's hash: they survive a
reload, and an edit to the spoken text afterwards asks for another reading. A
podcast that has ever gone out shows the gate done, even when its latest re-send
failed (*Revisited 2026-09-29*: until then only a podcast whose latest status was
`sent` was exempt, so a failed re-send asked for approval again; Jamie wants as
few forced steps in their own tool as can be, and an earlier good send, by
`lastSent`, is enough). The server holds the leg to the same approval, so a
request that skips the view is refused too. Until then it sits in `NEEDS YOU`:
reading and approving stay in the step row, and the card's action is **Send
without approval…**, which asks first — saying whether the script is unread, read
but not approved, or changed since — and sends it anyway (*Revisited
2026-09-29*: the button used to disappear while waiting, and nothing could skip
the gate). A card button labelled with a state ("Waiting on you") is still a
dead primary: it duplicates the pill beside it and does nothing when clicked.

**Sending** is what the server recorded, not what this view started: a leg sent
from another tab, or before a reload, reads `SENDING` too. While any leg is out,
every send button is disabled and the view re-reads the issue until it lands —
at three seconds, backing off to thirty (review 2026-09-27 §2.4). A `sending`
older than the server's ten-minute in-flight window is stranded: the server lets
a retry through, so it blocks nothing, is not polled, and its card offers
**Try again**.

**Failure** — and the state must be real rather than drawn: the card goes `DID NOT SEND` in terracotta with a
`#faefe8` strip explaining that other destinations are unaffected, the failed step
takes a `circle-x` and shows the error text where evidence would go, and the action
becomes **Try again** — resuming from the failed step, not from the beginning. A leg
that has gone before adds `Last good: Sat 9:05 AM · Draft ↗` to the strip in 11px
mono: what the destination still holds (the draft, the mp3, the commit), which a
failed attempt does not take away.

Once the Buttondown check has read the email back as anything but a draft —
scheduled, going out, sent — or a Buttondown send has been refused because it
was, the Buttondown card's `circle-alert` line says Buttondown's status, that the
email is no longer a draft, and what an update would do for that status — sent:
only Buttondown's copy changes and nothing is sent again; scheduled: it stays
scheduled; going out: the update races the delivery — and its action is
**Update anyway…**, which asks first. `Re-send all sent` and `Send the rest`
leave Buttondown out from then on and say so in their confirm, and one that
meets that refusal carries on to the archive. A check that reads `draft` again
gives **Update draft** back. *Revisited 2026-09-29:* until then a sent email
offered **Update web copy…** behind a confirm, changing the copy in Buttondown's
archive; that morning Jamie decided only a draft is edited, since the archive is
not hosted on Buttondown, and the card offered no action at all. That afternoon:
nothing is beyond overriding, so a non-draft is updated only on purpose, from
its own card.

**Overrides.** Every gate on a send card can be gone past (Jamie, 2026-09-29:
"There should be nothing that I cannot override. I'm the only user."). While a
gate holds, the card's one action is its override: named for what it skips and
ending in `…`, styled `btn` rather than `btn primary` so it never reads as the
next step, and it asks with a `confirm` that says what going past means. The
bulk runs never override; each override is a decision on its own card.

A sent card ends in **VERIFY** on `#fbfbfa`: the destination read back — each check a
row with `check` / `circle-alert` amber / `x` terracotta, its finding in 11px mono,
and any specifics (a time to listen at, a file that differs) beneath. A verdict pill
(`CHECKING`, `VERIFIED`, `WAITING`, `LOOK AT THIS`, `NOT RIGHT`), the time it ran,
and `Check again`. `WAITING` is a leg still landing — an email scheduled for later,
an archive not yet indexed — and says when it will look again on its own. The
Archive card also carries **PREVIEW**: what a commit would change in the corpus,
changing nothing.

Before it, **Made in** — how long the issue took, read from the event log, laid
out as design D (Jamie, 2026-10-04: his favourite visual, "but not with the
sentence on top"), numbers in `src/client/made-in.ts`. One white card,
`padding: 30px 34px`, blocks 30px apart, and no headline:

- **Head**: a mono eyebrow, 11px/.08em `--secondary`, `WHAT IT TOOK · THE WEEKLY
  THING 352` (`WHAT IT HAS TAKEN SO FAR` before it goes), and on the right the pill
  against the Builder issue before it — 12px mono, `--green` on `--made-pill`,
  `30 m less than WT351`; `N m more than …` is grey on `--neutral-tint`, never
  amber (more time is not a fault); no pill when there is no issue before.
- **Four stats** between `--border-light` hairlines: a 30px/600 serif number over a
  12.5px `--secondary` label — the total (active time before sending plus fixing
  after) `writing, over 7 days` (days with a sitting); `sittings`; the readiness
  strip's pill count, `pills, all done` or `pills, 40 done`; and the send, first leg
  to published, `to send all four` (`to send three of four`; before it goes, `1 of 4`
  `sent so far`). Two by two under 640px.
- **WHERE IT WENT**: one 18px stacked bar, radius 5px, 2px gaps, of the five largest
  parts and `Everything else` (the rest, with `Other`, which no item claims), dark to
  light along the Made in greens (`--made-1`, `--green`, `--made-3..5`, `--green-4`
  for the rest); a wrapping legend of swatch, name and mono time (`<1 m` under a
  minute).
- **WHEN · DARKER IS LONGER**: a square tile per day in `byDay`, one column each, at
  most 72px wide; shaded by the day's minutes (an hour or more `--made-1`, five
  `--made-3`, both with white ink; two `--made-4`; any `--made-6`; no sitting
  `--app`), the day's total inside (`1h45`, `9 m`), the weekday under it, and the
  items that arrived that day under that in amber (`+12`, blank for none). Then one
  balanced grey line: "Gold numbers are the links and posts that arrived that day;
  Sunday turned them into an issue, with one re-send after it went." — the send's
  weekday, and the after-send fact (`N m fixing after it went`, a re-send, or
  `nothing to fix`) said once, there, rather than as a fifth stat.

Below the body, a hairline and the toggle listing what shipped in WT Builder since
the previous issue. The index row adds `made in 2 h 35 m`. It exists to answer "did
that feature save me time?" (Jamie, WT351). The card is meant to be shared, so it
never shows when a sitting happened, not even in a tooltip — each day's total and
its weekday, nothing finer: the clock times were too much to share (Jamie,
2026-10-04). Its stat numbers are the one upright serif in the app (D's choice);
no note ever sits beside them, so they cannot be read as the editorial voice.

The last card is **Put to bed** (`moon`, dusk `#4b4a7a` on `#eceaf6`): `AWAKE` /
`ASLEEP`, one line on what it means, and `Put to bed` — enabled once the issue is
published, with an amber strip naming any leg not sent or not verified (it can
still go to bed). Asleep, the card offers `Wake it` (confirmed), every send button
is disabled, the issue opens under a dusk banner with the same `Wake it`, and the
index row carries a `PUT TO BED` chip. The index offers the same act on every published row: `Put to bed` (`moon`) beside `Website ↗`, and `Wake` (confirmed) once asleep.

## Issue index

A working dashboard, not a landing page: an `Issues` heading and the rows. No kicker,
no explanatory paragraph, no footnote.

**Filters** sit under the heading on one fixed line — search (titles, or a number:
`351`, `WT35`), a year select, and `Hide put to bed` (on by default) — with the
count on its own line beneath (`3 of 352 · 349 asleep hidden`). The bar never
moves while the list changes: a fixed grid, a count that cannot rewrap it, and the
scrollbar's gutter always kept (WT351: controls shifted under the pointer). The
filters apply to the draft like any other issue. A kind filter (Builder / Pre-Builder) was tried and dropped as not
meaningful. Remembered per browser.

**A row is two lines**, so the title always has the width: number, title, date,
counts, and the archive state on the right; then the state chips left and the
actions right. One flex line squeezed the title to a word a line once a
`PUT TO BED` chip and a third button arrived.

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
      | "pinboard_link" | "journal_post" | "membership" | "echo" | "markdown"
      | "echoes"        // single-body Echoes, WT350 and earlier; rendered, never seeded
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
  ask: string                       // echo — the question under the thread
  refs: [{ kind, issue, url, title, note }]  // echo — carried from the draft
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
- **Waiting** (2026-10-04, `src/shared/dependencies.ts`): a unit that is not done
  and is made from a section that is not done either — Title and dek from
  Notable, Echoes from Notable and Journal, Haiku from Notable, Journal and
  Briefly, Outro from Intro. Its tick is hollow (`inset 0 0 0 1px` border, no
  fill), its tooltip says `Waiting on Notable (3 of 5)` with the state
  `waiting`, the readout adds `· 2 waiting`, and the checklist row carries
  `WAITING` and the same line. A finished unit stays done. The Haiku, Echoes and
  title wands on a waiting unit ask "…Draft the Haiku anyway?" before drafting,
  and the draft routes refuse it (409 `waiting`) without `?force=1`.

Units are concrete: required direct items written (Intro, Outro, Currently, Photo — or
absent from the issue, which counts as satisfied), one per link needing commentary, one
per failed Pinboard write, Thingy items drafted *and* marked reviewed, and a haiku
chosen. The editorial review never counts here (see *Editorial review*).
*Revisited 2026-09-20* (`docs/decisions.md`, *Picking is the review*): a Thingy
item counts as done when it has words; marking it reviewed is not a unit.
- **Issue** toggle (left panel).
- **Publish** button.

#### Left panel — issue metadata + outline (300px, `#fbfbfa`, right border)

Header row: mono `WT350`, spacer, **Edit** / **Done** toggle (`padding: 3px 9px`,
radius 6px; active = black fill).

**At rest (closed)** — one white card, `1px solid #eeedea`, radius 9px,
`padding: 10px 12px`, three lines 12.5px with `#9a9a9a` labels:
`Publishes SAT, SEP 5` · `Sources AUG 29–SEP 4` · `14 items swept in from that span.`
— then a **Re-scan** button and a **Log** button. Re-scanning is the
most-used act in the panel (sources fill in all week), so it lives on the
resting card, not only behind Edit. Opening a draft issue also re-scans
automatically; the page renders immediately and the sweep lands when it
lands. Not when it opens under the Send view or is uncovered from it, and
not once any leg has been sent or is out: a bulk run's legs must render the
same issue (Batch 6 review, B1). Re-scan stays available. **Log** opens the issue's event log as a sheet — every action on the
issue, newest first: sweep arrivals, source refreshes, edits, outline
changes, write-backs, sends. Rows are `time · kind chip · summary`. The log
narrates; it never decides.

**Edit open** — white card, radius 9px, `padding: 11px 12px`, mono 9.5px/.08em
`#9a9a9a` field labels separated by `1px #f0efec` rules:

- TITLE · IN THE EMAIL SUBJECT and DEK — full-width text inputs. The canvas
  head edits the same two; these are the edit path once the issue is
  published (review 2026-09-27, §2.5).
- ISSUE NUMBER — number input, 88px.
- PUBLISHES — date input. Non-Saturdays snap forward with an amber note:
  "Moved to Saturday — the Weekly Thing always publishes Saturday."
- SOURCE MATERIAL — 7 / 14 / 21 chips (active = black fill) + free number input
  ("days back from Friday"), the derived window line 12px/500, an explanatory note,
  and a **Re-scan** button with the sweep count.
- Below the card: **Start the next issue…**, dashed-border ghost button.

On a published issue, the number, date and window are shown as facts, with a
note that a re-send would publish a different edition. The server refuses all
three, and Re-scan is offered on a draft only.

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
in the app is serif or italic (save Made in's upright stat numbers, on the Send view, where
no note is), so a note never reads as part of the issue — and 11.5px
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
  singletons (Photo, Intro, Outro, Haiku, Membership) show no item
  `x`; their section's `x` owns removal. An echo is not a singleton: each has
  its own `x` and arrows, like a Currently line (2026-09-20). **The cluster sits at `opacity: .3` and goes to 1 on row hover**
  (`.rail`, `transition: opacity .12s`). Every row carries `data-anchor` — the item id,
  node id, or `issue`.
  **Row hints** (`src/shared/hints.ts`, 2026-10-04; warn, don't block — a hint never
  moves a pill). Under the rail, at full strength because it is a finding, not a
  control: one 23×23 `circle-alert` mark, `--amber` when the item has an open link
  finding (dead, moved to a different page, or a gift link, not kept) or an email
  finding, `--faint` when only its title is the
  page's own still ending with the site's name (`| The Verge`, `- MacStories`) or running
  past 90 characters. Its tooltip says each finding; a click opens the inspector, which
  lists the title and unfinished hints under **Hints** beside its **Links**. The title
  mark goes once Jamie edits the title (`title_edited`): what is left is his choice, and
  most published titles keep their suffix. Under the words, in the `.row-owed` style:
  "Looks unfinished: it ends "…dots feels more" with no full stop" when Jamie's own
  commentary, intro, outro, or Currently line stops on a word, a comma, or a dash, and
  "A short Currently line, 3 words" under six words, and "Counted 5-6-5 syllables, not
  5-7-5. The count is a guess from spelling, so trust your ear." under a haiku that is
  not 5-7-5 or not three lines (`src/shared/syllables.ts`), which also takes the amber
  mark. It is hidden while the row has the caret (`.row:focus-within`), so it never
  fires mid-sentence. Nothing is hinted on a frozen issue.
  **Link and email notes** (2026-10-04, plan before WT353 item 1). Links are checked
  as they arrive (a sweep, a sync, a link typed and saved), in the background, and
  what is found is said under the words in an amber `.row-link-note` (`--amber-1`,
  12.5px): "A dead link (404): https://…", "A link that has moved to https://…", the
  gift link's expiry, "Its https:// address fails; the http:// one works". A click
  opens the inspector, where it is used or kept. Only what Jamie can act on is said: a
  site that would not answer (403, 429, 5xx, a timeout) is no mark, and neither is
  http→https on the same page, a trailing slash or tracking. What in the email a
  filter holds against the row (a plain-http link, link text naming another site, a
  link to a download or a bare address, a domain on a spam blocklist) is the same
  note, `.row-mail-note`, with **Keep as it is** inline where it can be kept (a
  blocklisted domain cannot: the email asks before it goes). The subject's warnings
  are the title row's. The app looks again every 2.5 s while the server says a check
  is running, so a dead link typed a moment ago is said without a reload.
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
| Photo | **Empty:** a 300px dashed `#dedcd8` / `#fafaf9` drop zone — a `<label>` around a hidden `input[type=file]` with a 24px `image-plus` glyph, "Drop a photo here, or click to choose", and "Time and place are read from the file. Both stay editable." A file held over the zone turns the edge solid terracotta, tints it, and reads "Drop to upload" — the drop is visibly received before it is let go. **Set:** the image at full column width, radius 6px, with hover-revealed **Replace** (label + hidden input) and `trash-2` **Remove** over the bottom-right; a file held over the image darkens it with "Drop to replace". A file dropped anywhere else on the page is refused, never opened in the tab. Then caption 16px/1.6 — rendered Markdown at rest and source while editing, like commentary, so a link reads as a link — and a meta line 14px `#6e6e6e` (`Aug 29, 2026 · 8:35 PM · Cannon Lake, Warsaw, MN`). Dropping a file stamps the timestamp from its modified date and seeds empty alt text from the filename. The wand drafts **alt text only** — three candidates, a pick sets the alt — and never offers or touches the caption, which is Jamie's |
| Quote | `border-left: 3px solid #e6e5e2`, `padding-left: 20px`; text 19px/1.6 italic. No name field: *Revisited 2026-09-29*, a Quote carries no attribution in any edition (Jamie), so the "Who said it" line is gone from the canvas |
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
`background: #fff8e3` + `box-shadow: 0 0 0 4px #fff8e3`. A published issue stays
editable until it is put to bed, because fixes and re-sends follow publishing (Jamie,
2026-09-28). Its text, rails, and item wands work as on a draft, and the kicker reads
`WEBSITE — PUBLISHED · EDITS NEED A RE-SEND`. What adds structure stays a draft's:
insert points, add chips (the outline's `+ Section`, `+ Markdown` and NOT IN THIS
ISSUE among them), and the ordering and Echoes wands. Once it is put to bed,
nothing is editable, and the client offers nothing that would be refused. No run is
contenteditable, and no rail action moves, removes or promotes (Inspect, which only
reads, stays). Wands, held-strip buttons, outline and Collapse actions, Edit, Share
and Re-scan are all withdrawn. The Inspector's fields are read-only and its write
buttons are gone. A new review read is not offered. The kicker reads
`WEBSITE — PUBLISHED`, and its note says the issue is put to bed. A pre-Builder
record is frozen the same way. The server's 423 (`guardBed`) is the backstop.

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
- Omission strips (dashed, mono `NOT SPOKEN`) for a section held out of audio. Photo
  and Echoes speak since 2026-09-21 and 2026-09-20; a Photo with no caption is the
  one that still shows the strip.
- The builder's own spoken lines — the opening, "Now, the Notable section. Seven links
  this week.", "That's the end of Notable.", Thingy's hello, the close — are numbered
  cues like every other line, set in amber (the lens's audio-device colour, shared with
  the Briefly title highlight), with a one-time note saying so. Drawn as rules they
  read as headings that would not be spoken (Jamie, 2026-09-22). A cue that follows a
  section pause sits after a larger gap. Thingy's cues carry a small THINGY tag.
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
   **Apply** (2026-10-04): a proof note with a fix leads its footer with an amber
   `Apply` button (`#fdf9ee` / `1px #ece0bd` / `#a07a1f`, as `← Review`) naming the
   change in mono ink — only the words that differ: `Apply TLA. → TLA+.`,
   `Apply cut "were"`, `Apply add "to"`, each side cut at 24 characters. Words that
   occur twice or run across fields get no Apply, only Show me (the client runs the
   server's matcher, `src/shared/proof.ts`). A refused Apply becomes
   `Words changed — Show me` (or `Fix by hand — Show me`), the server's sentence as
   its title. With two or more applicable, the PROOF group header carries
   **Apply all** at its right.
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
`WT346` + `external-link` link. A proof note with a fix adds an amber `Apply`
text button (500 weight, the change in mono ink) before **Show me**.

**Applied** — the note drops at once (its words are gone; a fix that contains its own
words, "Pinboard" → "Pinboard's", drops too). A dark toast bottom centre
(`#1a1a1a`, white 12.5px, radius 9px, the update bar's shadow) says
`Applied TLA. → TLA+.` with **Undo** and ✕ for 8 seconds, held while hovered or
focused. Undo puts the old words back and the note returns. Apply all's toast says
`Applied 3 fixes.` and, when something was left, which and why, and stays until
dismissed.

**Cleared notes** drop to `opacity: .55`, grey out their edge, strike through if done, and
swap the two actions for a `DONE` / `IGNORED` tag plus an `undo-2` reopen. The read bar
tallies `3 done · 2 ignored` with a **Show cleared** toggle. Open and cleared notes are
tallied in the review's read bar only; an ignored note is resolved, not outstanding.

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
   bookmark."). In `conflict` — edited both here and at the source since the last
   scan — Retry would be refused again, so the card offers **Keep mine** (write this
   copy over the source as it is now) and **Take theirs** (adopt the source's words)
   instead (2026-09-28). *Revisited 2026-09-28:* "Last writer wins" no longer
   describes the write. Since 2026-08-30 write-back is compare-and-set and refuses
   with `conflict`; see `docs/decisions.md`, *Revisited 2026-09-28 — the source is
   the second editor*.
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
   *Revisited 2026-09-20* (`docs/decisions.md`, *Picking is the review*): picking
   or writing the words is the review and satisfies the unit. The inspector still
   shows the Reviewed / Mark draft toggle, and it gates nothing.
7. **APPEARS IN** — the hold-out control. Explanatory line, then **All / Email only /
   Hide** presets (active = black fill), then three full-width channel rows: 15px
   checkbox (radius 4px, `1.5px` border, black when on), channel name 12.5px/600 at
   66px, and a per-channel note ("Description, then linked title" / "Reversed: title
   first" / "Caption, place, and date; the picture is chapter art"). Audio is **locked with `–`**
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
  state in `#2f7d4f`. *Revisited 2026-09-20:* the Thingy rows are Thingy items with
  no words yet; there is no review to wait for (`docs/decisions.md`, *Picking is the
  review*).
- **Start a new issue sheet** — modal on `rgba(26,26,26,.28)`, 460px, radius 12px,
  `box-shadow: 0 24px 60px rgba(26,26,26,.22)`, `padding-top: 88px` from viewport top.
  Title 18px/600, a line naming the issue being replaced, then PUBLICATION DATE (seeded
  with the Saturday after the latest issue, never one already past; green
  confirmation `SAT, SEP 12 · 12:00 AM CT`, or an error when another issue holds
  that Saturday, which disables Create), ISSUE NUMBER (seeded
  last-published + 1, note "Follows WT350"), SOURCE MATERIAL (7/14/21 + free number,
  derived window line). Footer `#fbfbfa`: **Cancel** / **Create WT351**.
- **Updated bar** — ink pill, bottom centre, over everything including the Send
  layer: `WT Builder was updated since this page loaded.` and **Reload**. Shown once
  the server names a build other than the tab's (every API answer carries
  `X-WT-Builder-Build`, read from the `build-id.txt` a build writes beside the
  client; the tab also asks when it comes back into view). Never reloads on its
  own: something may be half-typed (review 2026-09-27 §2.4).

---

## Interactions & behavior

**Automatic inclusion.** Everything bookmarked or posted inside the window is on the
page from the moment the issue exists. Changing `publish` or `days` re-derives
`out_of_window` for every syndicated item; items that fall out disappear from the page,
and a section whose items all fell out renders its heading at `opacity: .45` with a mono
note `ALL 4 FELL OUTSIDE THE WINDOW` rather than vanishing silently. That state lasts
until the next re-scan, which **drops** fallen-out items from the issue (2026-09-20: the
window is the membership; a kept-but-hidden item showed up as `OUTSIDE WINDOW` in every
count and lens). The one exception is an item holding an edit the source has not
received — it stays, and the log says why. Widening the window again sweeps the rest
straight back in.

**The strip knows started from finished.** Each readiness unit is `done`, `partial`, or
`todo`; a half-filled tick is in progress. A one-sentence intro is started, not written
(`DONE_WORDS`: intro 50, outro 20, Notable commentary 20; Briefly wants a line; a photo
wants alt and caption; a haiku three lines). Every Currently line is its own tick, the
issue's title and dek are the first, and ticks run in the order the page reads, so the
strip answers "how close am I" and a click on any tick jumps there (2026-09-20) —
scroll only, with a brief tint: nothing is selected and the inspector does not open
(WT351).

**The strip is a map, and it is fun** (Jamie, WT351: "surprise me"). A finished
tick takes the hue of what it is — links green, Journal blue, Thingy terracotta,
the photo amber, Jamie's own framing words (title, intro, Currently, outro, haiku)
ink — so a done strip reads as the issue's shape. A finished tick's tooltip adds
the first words it holds, in italics. Momentum: ticks finished back to back (each
within four minutes of the last) throw a bigger burst each time, and three in a row
flashes `3 in a row` in the readout; crossing halfway sends a shimmer down the
finished ticks and flashes `Halfway`. The readout ends with how long the issue runs
aloud as it stands (`~14 min aloud`, script characters at 15 a second). Reduced
motion turns the shimmer and flashes off, as it does the confetti.

**Markdown on the keyboard.** Every editable holds Markdown source while editing and
renders it at rest — Source included, which shows pictures and rendered text like the
page (2026-09-20: raw Markdown there was "too markdown"). The sugar is the keyboard, not
a toolbar: ⌘B / ⌘I / ⌘⇧K wrap or unwrap the selection in `**` / `_` / backticks; ⌘K
makes `[selection]()` with the caret in the parentheses (a selected URL becomes
`[](url)` with the caret in the brackets); pasting a URL over selected words links them.
No editor library: the page is the editor.

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

**Placement.** The `_brief` tag on the bookmark files a link in Briefly, as does having
no description; a described, unmarked link is Notable. The move action edits the tag; a
tag or description change at Pinboard moves the link on re-scan (placement only — the
inference is never written back). After a move the canvas scrolls to the link in its
new section and tints the row briefly — it is not left to be found by hand. It does not
select the link or open the inspector.

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
Haiku candidates: **1200 ms**. Re-scan: **1100 ms**. *Revisited 2026-09-28:* the
real write-back is compare-and-set, not last writer wins: a source record changed
since the last scan is refused as `conflict`, and Keep mine or Take theirs resolves
it (`docs/decisions.md`, *Revisited 2026-09-28 — the source is the second editor*).

**Saturday rule.** A non-Saturday publish date snaps forward to the next Saturday with a
visible amber note rather than being rejected.

**Publish.** The button opens the Send view. An issue is `published` once its
website and Buttondown legs are sent, and it stays editable until it is put to bed
(see *Editing* above). The real contract is in `docs/publishing-lifecycle.md` and
is summarized below.

**Editorial review.** Asked for explicitly — never on open, on save, or on reaching
Ready. A read replaces the previous one; there is no note backlog. Notes are re-derived
from the current draft on every render, so **fixing a typo removes its note without
re-running the review**, and a note whose anchor is deleted or held out disappears with
it. Notes are observation-only: no replacement prose for the issue's own text, no
accept-to-apply. The only action on a note is ✓ (done with it). Two classes — mechanical
`PROOF` and judgment `RHYTHM` / `ARCHIVE` / `LENGTH` — with at most two judgment notes
marked *worth your time*. Advisory only: never in the Ready checklist, never a gate.
Reads the website edition.

**Generation.** One pattern for Haiku, Membership, and link descriptions (Echoes
differs: its wand is on the section heading, offers up to five echoes, and the ticked
ones append as items; each echo's own wand redrafts that one, and an echo whose
citation does not trace to a retrieved passage carries that flag beneath it in
`--amber`, still pickable): an
explicit `✦` ask; a 1500 ms busy state; two or three **candidates** rendered as
selectable cards in the inspector; **nothing written to the issue until Jamie picks one**,
and editable immediately after. Picking a link description writes `commentary` and
triggers the Pinboard write-back as Jamie's text. When the link was in an earlier issue,
the link wand's picker says so above the candidates — "Linked before in WT274
(2024-01-27)", 11px `--amber`, newest first, each `WTn` linking to its archive page, and
", and N earlier" past five (2026-09-30). Thingy items keep their visible byline
regardless of how heavily they are edited. Never auto-generated on assembly, and there is
no "generate everything". A draft that fails says so in one plain sentence in the error
bar — what happened and whether to try again, never a status code's raw body — and
while Echoes waits out a busy archive, a line under its wand (11px `--amber`, or the
empty section's chip) reads "The archive is busy; trying again…" (2026-10-04, after a
Librarian 429 reached Jamie as JSON on WT352).

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
**enforced**: the Website card carries a blocker strip, and the server refuses a
website send until an audio reference is recorded — the podcast's last good
send, not its status (2026-09-28, review 2026-09-27 §2.1). `?force=1` is the
deliberate escape for an issue with no audio, behind the card's **Commit without
audio…**.

**The archive is not a publishing destination.** Issue text is committed to the
archive repo *after* publication so Thingy can cite it. It is its own leg with its
own evidence and retry, it never gates readiness, and its failure must not degrade
the published state. Send text only — the archive receives no audio.

**Sync semantics** — Pinboard and Micro.blog both write back, last-writer-wins,
and a failed write never discards the local edit. *Revisited 2026-09-28:* the
write-back is compare-and-set and refuses with `conflict` when the source changed
since the last scan; see `docs/decisions.md`, *Revisited 2026-09-28 — the source is
the second editor*. Micro.blog reads and writes
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

**Made in greens** (design D, darkest first) `#1f5a38` `--made-1` · `#2f7d4f` green ·
`#5c9a72` `#8ab99a` `#b5d4bf` `#cfe2d5` `--made-3..6` · `#dfe9e2` green-4 · pill `#e8f1ea`

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

## Editing invariants (2026-09-21)

Learned from WT351, where an accidental click on a Journal post committed its
rendered view as source and the write-back carried the flattened post to
Micro.blog:

- **A rendered view is never committed.** `RichEditable` shows rendered HTML at
  rest and swaps to Markdown source on mousedown/focus; a blur that arrives while
  the node still holds HTML commits nothing, whatever path skipped the swap.
- **Structure edits as a block.** A Journal entry or Briefly line whose text has
  more than one block (a list, several paragraphs) edits in the block editor
  (`post-body`, `pre-wrap`, Enter makes a line), not the inline span where line
  breaks are invisible and Enter blurs. One-line moments stay inline.
- **A flatten is refused.** The server drops any `body`/`commentary`/
  `member_thanks` change whose only difference is that every line break is
  gone (`isFlattened`), logs "Refused an edit … that only removed its line
  breaks", and nothing reaches the source.
- **Pasted lists and quotes keep their markers** (`domToMarkdown`).

Added 2026-09-28, from the review of 2026-09-27 (§1.4, §1.5):

- **Committed text stays on screen until its save answers.** `RichEditable`
  renders the pending text, not the old value, while its PATCH is out, and a
  click back in edits it. A save that fails leaves the text on screen marked
  `data-unsaved` (the terracotta tint) and the next blur tries it again.
- **A field is never reset while it has focus.** The Inspector's and the
  issue panel's inputs are uncontrolled while focused (`Field.tsx`); a save
  or a re-scan landing updates only fields Jamie is not in. Escape in one
  commits it before the panel closes.
- **A click in and out is not an edit.** An editable commits only when what
  it reads back differs from the read-back of the stored value. The
  read-back keeps the spaces before a line end, so a Markdown hard break
  survives an edit, and adding or removing one is an edit.
- **A field shows the saved value once it lets go**, unless its save is out
  (it waits) or failed (it keeps the typing). The Inspector is keyed by the
  item it inspects, so typing never carries to the next item.
- **A heading typed on the canvas is saved.** Ad hoc: the section label.
  Promoted: the post's title. Emptied, it goes back to the saved text; the
  rename route refuses a blank label. The Inspector's Title field on a
  promoted post goes back the same way, and the item route refuses a blank
  title there.
