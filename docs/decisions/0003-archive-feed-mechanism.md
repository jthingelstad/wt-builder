# 0003: Archive feed mechanism

Status: accepted

## Context

[`0002`](0002-publishing-and-archive-boundary.md) establishes that WT Builder
sends issue text to the archive after publication so Thingy can retrieve it,
and that the send never blocks publishing. It does not say how the send works.

Two options were considered: committing directly into the archive repository,
or adding an ingest endpoint to the retrieval API.

## Decision

WT Builder commits issue text directly into the archive repository.

This is the same cross-repo commit mechanism Studio already uses to hand
generated inputs to `weekly.thingelstad.com`, pointed at a different target.

## Rationale

- The mechanism is already proven in this system rather than newly built.
- It adds no API surface, no new authentication path, and no service to operate.
- The archive is the corpus source of record. A commit is durable, diffable,
  revertible, and carries provenance for free. An ingest endpoint would have to
  reinvent all of that on top of a database.
- The archive's corpus build already triggers on changes to the issue data
  path, so the feed causes the rebuild, embed, and upload without any
  additional coordination.

## Consequences

- WT Builder holds write access to the archive repository. Scope it to the
  issue data path rather than the whole repository.
- The commit is the archive-feed leg's evidence. Record the commit identifier
  alongside the usual attempt, timestamp, and result.
- Retry is naturally idempotent. Re-sending an unchanged issue produces an
  identical tree, so a retried feed is a no-op rather than a duplicate.
- Transition hazard: the archive's production workflow currently performs both
  the corpus rebuild and the website handoff when issue data changes. Once
  WT Builder owns the handoff, the archive side must stop performing it, or
  both repositories will push to the website. Remove the handoff from the
  archive workflow in the same change that gives WT Builder the feed.
- Revisit only if WT Builder needs to send the archive something that is not a
  git-shaped artifact.
