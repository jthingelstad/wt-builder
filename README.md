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

- `studio-thing`: production evidence and possible source of reusable
  integrations. Its product model is not inherited.
- `weekly.thingelstad.com`: downstream public render surface.
- Thingy/Librarian: archive retrieval and attributed generation for Membership
  and Echoes.

No credentials, downloaded Shortcut payloads, or private production data belong
in this public repository.
