# 0023 — Micro.blog write-back is live, not read-only

**Status:** accepted · 2026-08-27
**Supersedes:** the read-only guidance in `docs/interface-spec.md` § Open questions

## Decision

Editing a Micro.blog post's title or body in WT Builder **writes back to
Micro.blog** through the Micropub `update` action. The same is true of Pinboard
titles, commentary, and tags.

Both write-backs are enabled in the running service
(`pinboardWriteBack: enabled`, `microblogWriteBack: enabled`).

## Why this is recorded

The interface spec notes that showing Micro.blog body edits syncing back
"exceeds the current contract" and says to either scope it read-only for v1 or
record the change. Jamie's instruction is explicit: *"I want the micro.blog and
pinboard connections connected live... not read only. that is old info."*

So this is the record. The spec's line is stale, not wrong-at-the-time.

## What it means

The item is not a copy of the post. It is a view of the post, and editing it
edits the post — there is one canonical text and it lives at the source. That is
the whole reason the sweep uses Micropub `q=source` rather than the JSON feed:
`q=source` returns the exact Markdown Micro.blog holds, which is the only thing
that can be safely handed back in an `update`.

## The failure this creates, and the guard

A write-back can fail while Jamie's edit is good. The edit is never discarded:
the item keeps the local text, `sync_state` goes to `failed`, `sync_error` holds
the reason, and the structural margin shows `circle-alert` in terracotta. Retry
is explicit. A failed write is a sync problem, not an editing problem, and the
interface says so rather than reverting his words.

## The Pinboard trap this record must keep naming

Pinboard's `posts/add` **replaces the whole record**. Anything not sent is reset
to its default — which silently publishes a private bookmark and clears the
unread flag. Write-back therefore captures `source_flags` at sweep time and
sends them back unchanged. See `src/server/integrations/pinboard.ts`.

This is not theoretical: it happened during the first QA pass and made private
bookmarks public.

## Consequences

- Write-back is on by default. The kill switches are the env flags, not code.
- `source_snapshot` is kept so the Source lens can show `as imported: "…"` when
  the working text has diverged.
- Nothing writes back on a *published* issue; the editor is read-only there.
