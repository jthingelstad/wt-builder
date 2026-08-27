# Item model

## Canonical issue

The issue is an ordered outline rather than a Markdown document.

```text
Issue
  ordered top-level nodes
    section
      ordered items
    promoted item
    ad hoc section
    Markdown block
```

## Issue record

```text
number                 monotonically incrementing; defaults to last published + 1
publish_date           a Saturday
window_days            how far back the sweep reaches
status                 draft | published
title
dek
```

The window **closes Friday at 00:00**, so the span ends Thursday and anything
captured on Friday belongs to the next issue. `window_days` counts back from that
Thursday.

The number is derived, not enforced. It defaults to one past the last published
issue and stays editable, because issues published before WT Builder are
imported by number.

## Item

Every item has:

```text
id
type
authorship             Jamie | syndicated | Thingy
source                 direct | Pinboard | Micro.blog | Thingy
source_id
source_url
source_snapshot
title
body
commentary
section
position
channels               { website: bool, email: bool, audio: bool }
presentation           normal | promoted
published_at
media
sync_state
rendering_overrides
```

`source_snapshot` preserves what was imported. Editable issue fields contain
the latest working value. This makes provenance visible without preventing
editorial changes.

## Channels replace inclusion

There is no `included` boolean. An item is in the issue when at least one
channel is true, and hiding an item means setting all three false. One model
instead of two.

This makes **edition-only items** a first-class state rather than an accident:
an item — or a whole section — can be email-only or website-only. Where a
rendering contract forbids a channel (Photo and Echoes in audio), that channel
is locked false and the reason is stated in the UI, not silently ignored.

Migration from the earlier model: `included: true` becomes all three true,
minus any channel the rendering contract forbids.

## Top-level nodes

Nodes are reorderable and **every node is removable**, including Echoes. Most
issues carry the familiar skeleton, but special issues legitimately have no
Notable, no Briefly, no Journal, and no Photo — some are nothing but Markdown
and photo blocks.

Removing a section holds out its syndicated items rather than deleting them.
Missing standard sections are offered back, so removal is never one-way.

Two node types exist for issues that do not fit the skeleton:

- **ad hoc section** — a titled section with an editable heading.
- **Markdown block** — a headless block belonging to no section.

Both may be inserted at a specific position, and both may repeat any number of
times in one issue. Photo may also repeat: an issue of ten Markdown-and-photo
pairs is a valid issue.

Echoes retains two properties that are not about placement: it is generated only
after the issue is substantially assembled, and it is written and attributed to
Thingy. When present it renders last and is excluded from audio.

A promoted Journal post behaves as a top-level node while retaining Micro.blog
provenance.

## Published headings

Some sections publish their name as a heading and some do not. Photo, Haiku, and
Membership publish without one — the content carries itself, and printing the
label would be an editorial artifact rather than part of the issue.

```text
publishes_heading      bool, per node
```

The builder still shows these names, in the structural gutter, so the editor
knows what a block is without the reader being told.

## Initial item types

### Direct content

- Intro: Markdown
- Outro: Markdown
- Quote: Markdown or structured quotation with attribution
- Currently entry: structured label, value, and optional context/image
- Photo: image, alt text, caption, timestamp, and optional location
- Markdown block: Markdown, no heading

### Syndicated content

- Pinboard link: title, URL, commentary, tags, and target section
- Micro.blog post: title, URL, body, publication date, and media
- Promoted Micro.blog post: the same item in standalone presentation

### Thingy content

- Membership: generated from campaign facts and explicitly attributed
- Echoes: archive-grounded callback and explicitly attributed

### Generated content

- Haiku: generated candidates with Jamie's selected/edited final text

## Synchronization

Pinboard uses last-writer-wins. Editing title, commentary, or supported tags in
WT Builder automatically writes the current value back to Pinboard. The UI
shows saving, synced, and failed states and never discards the local edit on a
failed write.

Micro.blog synchronization is read-only initially. WT-specific inclusion,
presentation, edits, and placement do not modify the original post.

## Resolved questions

Answered by prototype validation; kept here because the answers are contract.

- **Draggable versus menu-driven.** Both, in different places. The outline
  supports drag and arrows; the canvas gutter offers arrows and promote/demote.
- **What removal means.** There is no source tray to remove from. Unchecking
  every channel hides an item; removing a section holds its items out.
- **Pinboard tags versus issue placement.** Placement wins in the issue; the
  write-back covers title, commentary, and supported tags only.
- **Promoted Journal date context.** The weekday and time print beneath the
  promoted heading. The date is established by the issue; the weekday is the
  useful part.
