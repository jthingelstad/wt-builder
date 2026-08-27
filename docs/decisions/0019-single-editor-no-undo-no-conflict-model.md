# 0019: Single editor: no undo, no conflict model

Status: accepted

## Context

WT Builder has one editor and one current issue. Two things that a multi-user tool
would need are therefore not needed here, and building either would cost real
complexity for no benefit. Both are worth writing down, because both are the kind
of omission a later reader assumes is an oversight.

## Decision

**No conflict model.** No locking, no revision vectors, no merge. Nobody else is
editing.

The durable path is the write-back. Editing a Pinboard link's title or commentary
writes to Pinboard promptly, last-writer-wins, and the interface shows saving /
synced / failed per item; the same now applies to Micro.blog (0015). A failed write
never discards the local edit. That is the whole durability story, and it is visible
per item rather than hidden behind a save button.

**No undo.** Accepted deliberately.

What makes it tolerable is that the destructive acts have another route back:

- Removing a section holds its syndicated items out; they land under **Held out**
  with a `Put back`.
- Missing standard sections are offered back as chips under the outline.
- Clearing an item's channels hides it; rechecking one returns it.
- A removed section can be re-added, including Echoes.

**Text edits are the exception, and this is a known hole.** Typing over a paragraph
and blurring loses what was there. `source_snapshot` covers imported material — the
"as imported" line in the Source lens is a partial answer for syndicated items — but
there is nothing for direct content. Recorded as accepted rather than left to be
discovered during a build.

## Consequences

- Do not add locking, autosave indicators, or a revision history without revisiting
  this record.
- Any future undo should start with direct-content text edits, which is the only
  gap; the structural acts are already reversible.
