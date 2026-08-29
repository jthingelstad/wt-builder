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
publish_date           always the Saturday — the date is the issue's identity, not the send timestamp
window_days            how far back the sweep reaches
status                 draft | published
title
dek
```

The content window runs **Friday 00:00 CT to Friday 00:00 CT** — a half-open
interval `[from, to)`. An item captured Thursday at 11:58 PM Central is in; one
captured Friday at 12:02 AM belongs to the next issue. `window_days` counts back
from the Friday the window closes on.

This is an **instant** comparison, not a date comparison. A bookmark saved
Thursday 11 PM Central is stored as Friday 04:00 UTC, and comparing date strings
alone pushes every Thursday-evening capture into the following issue. The
arithmetic, including the daylight-saving handling, is in `src/shared/dates.ts`.

The number is derived, not enforced. It defaults to one past the last published
issue and stays editable, because issues published before WT Builder are
imported by number.

## Item

Every item has:

```text
type
authorship             Jamie | syndicated | Thingy
source                 direct | Pinboard | Micro.blog | Thingy | generated
source_id
source_url
source_snapshot        what was imported, for the "as imported" diff
title
body
commentary
label                  Currently entries carry one ("Building", "Listening")
attribution            Quote
section                the section a link was captured for; placement wins
tags                   Pinboard tags
channels               { website: bool, email: bool, audio: bool }
channel_locks          { [channel]: reason } — why a channel cannot be set true
presentation           journal | promoted
published_at
media                  { url, alt, caption, timestamp, location }
source_flags           source-owned fields write-back must hand back untouched
sync_state             synced | syncing | failed | needs_commentary | local
sync_error             kept beside the local edit until a retry succeeds
status                 draft | reviewed        (Thingy-authored)
reviewed               bool                    (Thingy-authored)
archive_references     [{ issue, url, note }]  (Echoes)
rendering_overrides
```

The item's **id is the key** in the document's `items` map, not a field on the
item. **Order is the position in its node's `items` array**, not a field either —
there is no `position`.

Two of these are load-bearing in a way the name does not convey:

- **`source_flags`** holds the fields Pinboard owns. Its `posts/add` endpoint
  replaces the whole record, so anything not sent is reset to its default —
  which silently publishes a private bookmark and clears the unread flag. The
  flags are captured at sweep and handed back unchanged. This has happened once.
- **`channel_locks`** carries the *reason* a channel is unavailable, so a
  forbidden channel states why rather than failing quietly.

`source_snapshot` preserves what was imported. Editable issue fields contain
the latest working value. This makes provenance visible without preventing
editorial changes.

## Channels replace inclusion

There is no `included` boolean. An item is in the issue when at least one
channel is true **and it falls inside the window**. Hiding an item means setting
all three channels false. One model instead of two.

Inclusion is **derived on read**, never stored. That is what makes changing the
publication date or the window length re-derive every item for free; a stored
flag would need a sweep, and the sweep is the thing that goes stale. Only
syndicated items are subject to the window — Jamie's own writing is composed for
the issue and carries no capture timestamp.

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

Removing a section **deletes its locally-authored items and holds out its
syndicated ones.** The asymmetry is the point: a syndicated item is still inside
the window and the next sweep would bring it straight back, so removing it needs
a durable "no" — that is what holding out is, and it renders under **Held out**
with a `Put back`. A locally-authored item has no sweep to return from.

Deleted local items are retained beside their held node so restoring the section
restores them too. Missing standard sections are offered back, so removal is
never one-way.

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

Micro.blog synchronizes both ways. Editing a post's title or body writes back
through the Micropub `update` action, last-writer-wins, with the same
saving / synced / failed states. Reads use Micropub `q=source`, which returns the
exact Markdown the post is stored as — the only form that can safely be handed
back in an update. The blog's JSON Feed returns *rendered* content and cannot.

The original post stays canonical for the blog. WT-specific inclusion,
presentation, and placement do not modify it; edits to its words do.

## Resolved questions

Settled during the interaction design; kept here because the answers are contract.

- **Draggable versus menu-driven.** Both, in different places. The outline
  supports drag and arrows; the canvas gutter offers arrows and promote/demote.
- **What removal means.** There is no source tray to remove from. Unchecking
  every channel hides an item; removing a section holds its items out.
- **Pinboard tags versus issue placement.** Placement wins in the issue; the
  write-back covers title, commentary, and supported tags only.
- **Promoted Journal date context.** The weekday and time print beneath the
  promoted heading. The date is established by the issue; the weekday is the
  useful part.
