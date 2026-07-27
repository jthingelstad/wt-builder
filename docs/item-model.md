# Item model

## Canonical issue

The issue is an ordered outline rather than a Markdown document.

```text
Issue
  ordered top-level nodes
    section
      ordered items
    promoted item
  Echoes (fixed final node)
```

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
included
presentation           normal | promoted
published_at
media
sync_state
rendering_overrides
```

`source_snapshot` preserves what was imported. Editable issue fields contain
the latest working value. This makes provenance visible without preventing
editorial changes.

## Top-level nodes

Most sections can be reordered. A promoted Journal post behaves as a
top-level node while retaining Micro.blog provenance.

Echoes is a special fixed node:

- generated only after the issue is substantially assembled,
- written and attributed to Thingy,
- always the final website/email section,
- excluded from audio.

## Initial item types

### Direct content

- Intro: Markdown
- Outro: Markdown
- Quote: Markdown or structured quotation with attribution
- Currently entry: structured label, value, and optional context/image
- Photo: image, alt text, caption, timestamp, and optional location

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

## Open questions for prototype validation

- Which section transitions should be draggable versus menu-driven?
- Should source-tray removal mean excluded, deferred, or ignored?
- When Pinboard tags and issue placement disagree, which fields should sync?
- How should a promoted Journal post preserve date context visually?
