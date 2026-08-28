# Design source

The interface is specified, not improvised. Read in this order:

1. **[`../docs/interface-spec.md`](../docs/interface-spec.md)** — the handoff.
   937 lines: every screen, every token, the reasoning behind each call, and
   the things that were tried and rejected. This is the authority.
2. **[`../prototype/WT Builder.dc.html`](../prototype/) ** — the clickable
   prototype. 2,613 lines; the template (lines 9–974) is the screens, the
   script below it is the model.
3. **`screenshots/`** — what it looks like.

A note on how this repo got here: the first build of the client was written
from `docs/item-model.md` and `docs/rendering-contracts.md` alone. Those
contracts say what the *editions* must contain; they say nothing about what a
screen looks like. The result was an interface that borrowed the palette and
invented everything else. If you are about to write client code, read the spec
first — it is the shortest path, not a detour.
