# Design source

The interface is specified, not improvised.

**[`../docs/interface-spec.md`](../docs/interface-spec.md) is the authority** —
every screen, every token, and the alternatives that were tried and rejected.
`screenshots/` is what it looks like.

A note on how this repo got here. The first build of the client was written from
`docs/item-model.md` and `docs/rendering-contracts.md` alone. Those contracts say
what the *editions* must contain; they say nothing about what a screen looks
like. The result borrowed the palette and invented everything else, and had to be
rebuilt. If you are about to write client code, read the spec first — it is the
shortest path, not a detour.

The clickable prototype that accompanied the spec was deleted once the design was
implemented. It used a superseded data model — an `included` boolean rather than
per-channel flags — and three of the repo's four entry points had come to cite it
as the specification.
