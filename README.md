# WT Builder

WT Builder is a purpose-built application for assembling and publishing one
issue of [The Weekly Thing](https://weekly.thingelstad.com/) at a time.

It combines content written directly for the issue with syndicated items from
Pinboard and Micro.blog. The issue remains structured until publication and is
rendered separately for:

- the website archive,
- the Buttondown email, and
- the audio/podcast edition.

The product is intentionally narrow: one editor, one current issue, one
newsletter.

## Status

This repository begins with product and interaction design. The first
deliverable is a clickable prototype validated by Jamie before production
architecture is selected.

Start with:

1. [`docs/product-brief.md`](docs/product-brief.md)
2. [`docs/design-brief.md`](docs/design-brief.md)
3. [`docs/item-model.md`](docs/item-model.md)
4. [`docs/rendering-contracts.md`](docs/rendering-contracts.md)
5. [`fixtures/representative-issue.json`](fixtures/representative-issue.json)

## Product principles

- Markdown is an output, not the source of truth.
- Items, not sections, are the fundamental editorial unit.
- Source content and issue-specific edits are both preserved.
- Editing a Pinboard item uses last-writer-wins synchronization.
- Website, email, and audio are first-class render targets.
- Thingy may write only clearly attributed content.
- Echoes is written by Thingy, always appears last, and is not in audio.
- Production publishing remains out of scope until the interaction model is
  validated.

## Related systems

Publishing means delivering an issue to a reader, and WT Builder owns every
publishing leg. The archive is not a publishing destination; it is fed
afterward so Thingy can answer questions about the issue. See
[`docs/decisions/0002-publishing-and-archive-boundary.md`](docs/decisions/0002-publishing-and-archive-boundary.md).

- `weekly.thingelstad.com`: downstream public render surface. Receives the
  website edition and renders the podcast feed.
- Buttondown: receives the email edition as a draft.
- `files.thingelstad.com`: the only home for the rendered audio file.
- `studio-thing`, being renamed `archive-thing`: the corpus and retrieval API.
  Production evidence and a source of reusable integrations, but its product
  model is not inherited. Fed after publication, never during it.
- Thingy/Librarian: archive retrieval and attributed generation for Membership
  and Echoes.

No credentials, downloaded Shortcut payloads, or private production data belong
in this public repository.
