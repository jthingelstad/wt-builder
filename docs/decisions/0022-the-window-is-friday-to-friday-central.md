# 0022 — The window is Friday to Friday, Central

**Status:** accepted · 2026-08-27
**Supersedes:** the "ends Thursday" reading in `docs/item-model.md`
**Closes:** open question 1 in `docs/interface-spec.md`

## Decision

The content cutoff runs **Friday 00:00 CT to Friday 00:00 CT** — a half-open
interval `[from, to)`. For an issue published Saturday 2026-09-05, sources run
`Fri, Aug 28 → Fri, Sep 4`.

An item captured Thursday at 11:58 PM Central is in. One captured Friday at
12:02 AM belongs to the next issue.

## Why this needed a record

Three places disagreed.

- `docs/item-model.md` said the window "closes Friday at 00:00, so the span
  ends Thursday" and the first implementation followed it: `end = publish - 2`.
- The spec's data model says `end = publish - 1 day (the Friday)`.
- The canvas screenshot renders `Sources Fri, Aug 28 → Fri, Sep 4`.

The spec and the screenshot agree, and Jamie confirmed Friday-to-Friday
directly. The item-model sentence was reasoning from the same cutoff instant
and naming the last *whole day* rather than the boundary — both describe the
same moment, but only one of them is a window bound, and the code took the
wrong one.

## The part that is easy to get wrong

**This is an instant comparison, not a date comparison.**

A bookmark saved Thursday at 11 PM Central is stored as `2026-09-04T04:00:00Z`.
Comparing the date part alone reads that as Friday and pushes a Thursday-night
item into the following week's issue. Every Thursday evening capture — a
meaningful share of the week, since the issue goes out Saturday — landed in the
wrong issue.

`inWindow` therefore resolves both the timestamp and the boundaries to epoch
milliseconds. Timestamps carrying an offset are authoritative; bare dates and
offsetless local timestamps are read as Central wall clock, which is what
Pinboard and Micro.blog mean by a local date.

## Daylight saving

The boundary is midnight *Central*, not a fixed UTC offset, so it moves an hour
twice a year. `zonedMs` resolves the offset in two passes — the first pass picks
an offset from an approximate instant, the second re-reads it at the corrected
one — because the offset depends on the instant being solved for. Without the
second pass a window spanning a changeover weekend lands an hour off.

Verified across the November 2026 fall-back: the window for the 2026-11-07 issue
opens `2026-10-30T05:00:00Z` (CDT) and closes `2026-11-06T06:00:00Z` (CST).

## Consequences

- `Window` carries `fromMs`/`toMs` alongside the display dates.
- `windowLabel(w)` renders `Fri, Aug 28 → Fri, Sep 4` for the canvas kicker.
- Changing the publication date or the window length re-derives `out_of_window`
  for every item (see 0023).

## Still open

Whether the cutoff should move to Friday 11:59 PM CT — closing the window on the
Friday *evening* rather than at its first instant — so a Friday-daytime capture
makes the next morning's issue. That is a different decision and is not taken
here.
