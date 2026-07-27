# CLAUDE.md

Read `AGENTS.md` first, then:

1. `docs/product-brief.md`
2. `docs/design-brief.md`
3. `docs/item-model.md`
4. `docs/rendering-contracts.md`
5. `fixtures/representative-issue.json`

## Your immediate role

Explore and implement the interaction design in `prototype/`. The goal is a
clickable prototype Jamie can use to validate issue assembly before any
production architecture is chosen.

Use the representative fixture as real product content. Simulate imports,
synchronization, Thingy generation, preview generation, and publishing state.
Do not connect to production services.

The most important interaction to get right is the ordered issue outline:

- edit items where they appear,
- include/exclude candidates,
- manually reorder links,
- group Journal posts by date,
- promote a titled Journal post into a movable standalone section,
- demote it back without losing provenance,
- keep Echoes fixed last, and
- make channel-specific omissions and transformations obvious.

Do not redesign the product boundary without recording the proposal in
`docs/decisions/`.
