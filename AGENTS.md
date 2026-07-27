# AGENTS.md

## Product

WT Builder is a single-purpose authoring application for The Weekly Thing. It
supports one editor and one current issue.

Read `README.md`, `docs/product-brief.md`, and `docs/design-brief.md` before
changing the prototype or product model.

## Current phase

The repository is in interaction-design discovery. Do not choose a production
framework, database, hosting platform, or deployment architecture unless Jamie
explicitly advances the project to implementation.

The prototype must:

- use the representative fixture,
- demonstrate item-first assembly,
- support inclusion, exclusion, ordering, and journal promotion,
- preview website, Buttondown, and audio outputs, and
- preserve visible Jamie, syndicated, and Thingy authorship.

## Guardrails

- Do not copy Studio's UI or schema as the default design.
- Do not flatten the issue into Markdown while it is being edited.
- Do not imply that every item appears in every output.
- Echoes is fixed last and excluded from audio.
- Photo is excluded from audio.
- Briefly reverses its spoken order: title, then description.
- Thingy-authored content must always be visibly attributed.
- Never add secrets or raw Shortcut payloads.
- Keep the prototype local and non-publishing.

## Decision records

Material product decisions belong in `docs/decisions/`. Update the relevant
contract and fixture in the same change.
