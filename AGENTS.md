# AGENTS.md

## Product

WT Builder is a single-purpose authoring application for The Weekly Thing. It
supports one editor and one current issue.

Read `README.md`, `docs/product-brief.md`, and `docs/design-brief.md` before
changing the prototype or product model.

## Current phase

**Implementation, one thin vertical slice first.** Interaction design is settled
enough to build against: decisions 0004–0021 and the contracts in `docs/` are the
specification, and `prototype/` is the reference for what the interface does.

The slice, in order:

1. sweep Pinboard and Micro.blog for the issue's window,
2. assemble — ordering, promotion, per-channel inclusion, ad hoc nodes,
3. the four lenses: Source, Website, Email, Audio,
4. **send to a Buttondown draft, and nothing else.**

Podcast and website sends come after the slice lands. A Buttondown draft is the
safest real integration in the set: if it is wrong, nothing has reached a reader.

### Stack

TypeScript throughout. Preact + Vite client, a thin Node service — every credential
is server-side — and SQLite via `better-sqlite3`. Store each issue as **one JSON
document per row** with a few derived columns (number, publish date, per-destination
send state), not a normalized item schema: the issue is a tree, and normalizing it
means reassembling it on every read. `schema_version` on the document carries
migrations.

Python earns a place only if Studio's TTS pipeline is reused as-is. Check before
committing to it.

### Still true

- Use the representative fixture.
- Demonstrate item-first assembly.
- Support ordering, journal promotion, and per-channel inclusion.
- Render Source, Website, Buttondown, and Audio from the same items.
- Preserve visible Jamie, syndicated, and Thingy authorship.
- Do not call a production service from the prototype in `prototype/`.

## Guardrails

- Do not copy Studio's UI or schema as the default design.
- Do not flatten the issue into Markdown while it is being edited.
- Do not imply that every item appears in every output.
- Echoes, when present, renders last and is excluded from audio. It is not
  required in every issue.
- Photo is excluded from audio.
- Briefly reverses its spoken order: title, then description.
- Thingy-authored content must always be visibly attributed.
- Never add secrets or raw Shortcut payloads.
- Keep the prototype in `prototype/` local and non-sending.
- Publishing is called **sending**, and it runs per destination. Nothing WT Builder
  sends becomes authoritative where it lands.
- Never build undo, locking, or a conflict model without revisiting 0019.
- Never parse pre-Builder issue Markdown into items (0020).

## Decision records

Material product decisions belong in `docs/decisions/`. Update the relevant
contract and fixture in the same change.
