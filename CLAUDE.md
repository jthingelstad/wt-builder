# CLAUDE.md

Read `AGENTS.md` first — it carries the current phase, the stack, and the
guardrails. Then:

1. `docs/product-brief.md`
2. `docs/item-model.md`
3. `docs/rendering-contracts.md`
4. `docs/service-contracts.md`
5. `docs/decisions/`
6. `fixtures/representative-issue.json`

## Where things are

| Path | What it is |
|---|---|
| `src/shared/` | Types, dates, and the renderers. Runs on both sides. |
| `src/shared/render/plan.ts` | Ordering, channel filtering, Journal grouping — planned once so the editions cannot drift. |
| `src/server/` | The service. Holds every credential; nothing here reaches the browser. |
| `src/client/` | Preact. Talks only to `/api`. |
| `prototype/` | The design reference. Local and non-sending — never wire it to a service. |
| `fixtures/expected/` | What the three editions must render to. The tests hold them. |

## Working here

```sh
npm install
npm test          # 44 tests: renderers against the expected editions, plus assembly
npm run typecheck
npm run dev       # service on :4317, client on :5317
```

The renderers are the part with a real specification. Change one and
`npm test` tells you immediately whether the editions still match
`fixtures/expected/`. If a change is *meant* to alter an edition, update the
expected file in the same commit and say why in the message.

## Things that will bite

- **`prototype/` uses the old model.** It still has an `included` boolean;
  the contract replaced that with per-channel flags (0015). The prototype is
  the visual reference, not the data reference.
- **Micro.blog `/posts/all` is the timeline**, not Jamie's posts. Sweeping it
  puts other people's writing in the newsletter. Read the blog's JSON Feed.
- **Pinboard selection is `toread=yes`**, the unread queue — not a tag. The
  `weekly-thing` tag is not in use on the account.
- **`.env` must never be committed.** This repo is public.

## Decision records

Material product decisions belong in `docs/decisions/`. Update the relevant
contract and fixture in the same change.
