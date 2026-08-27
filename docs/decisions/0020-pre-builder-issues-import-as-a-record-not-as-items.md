# 0020: Pre-Builder issues import as a record, not as items

Status: accepted

## Context

Issues 349 and back were built by the Shortcuts workflow and exist as published
Markdown in the archive. There is an obvious temptation to parse them into items so
the whole history lives in one model.

## Decision

**Do not parse them.** A pre-Builder issue imports as:

- the issue record — number, publish date, title,
- one Markdown block holding the published text,
- the archive URL,
- `imported: true`, and read-only in the builder.

## Why

The value of having old issues in WT Builder is continuity of numbering and the
ability to open one and see what was sent. Neither needs items. Parsing nine years
of generated Markdown back into structured items is a lossy heuristic that would
produce items nobody will edit, and every future renderer change would then have to
consider whether it applies to reconstructed history.

The archive feed reads issue text, not items, so retrieval is unaffected.

## Consequences

- An imported issue shows its send chips as sent (it went out) and its text as one
  block. It cannot be edited or re-sent.
- If a specific old issue ever needs to be genuinely re-rendered, it can be
  re-entered by hand as a one-off. That has never been needed in nine years.
- No Markdown parser exists in the codebase, and none should be added for this.
