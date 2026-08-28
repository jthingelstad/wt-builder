# AGENTS.md

`CLAUDE.md` is a symlink to this file — Claude Code and Codex read the same
instructions. Do not fork them.

## What this is

WT Builder is the authoring application for *The Weekly Thing*. One editor, one
live issue, nine years of a Shortcuts workflow being retired into it.

**We are building the application and about to start publishing real issues with
it.** Not prototyping. There is no prototype: it was deleted once the design was
implemented, because it used a superseded data model and kept being mistaken for
the specification.

## Read these, in this order

1. **`docs/interface-spec.md`** — **the interface authority.** Every screen,
   every token, and the alternatives that were tried and rejected. If you are
   about to write client code, read this first. It is the shortest path, not a
   detour.
2. **`docs/status.md`** — what is actually built, what is half-built, and what
   has never been run against a real service.
3. `docs/item-model.md` — the canonical issue and item shape.
4. `docs/rendering-contracts.md` — what each edition must contain.
5. `docs/decisions.md` — the decisions that are invisible in the code.
6. `fixtures/representative-issue.json` — the fixture everything renders from.

## Stack

TypeScript throughout. Preact + Vite client, a thin Node service — every
credential is server-side — and SQLite via `better-sqlite3`. Each issue is
**one JSON document per row** with a few derived columns, not a normalized item
schema: the issue is a tree, and normalizing it means reassembling it on every
read. `schema_version` on the document carries migrations.

| Path | What it is |
|---|---|
| `src/shared/` | Types, dates, renderers. Runs on both sides. |
| `src/shared/render/plan.ts` | Ordering, window filtering, channel filtering, Journal grouping — planned once so the editions cannot drift. |
| `src/server/` | The service. Holds every credential; nothing here reaches the browser. |
| `src/client/` | Preact. Talks only to `/api`. |
| `fixtures/expected/` | What the three editions must render to. The tests hold them. |

```sh
npm install
npm test          # 174 tests
npm run typecheck
npm run dev       # service on :4317, client on :5317
npm run build     # typecheck + vite build into dist/
```

The renderers are the part with a real specification. Change one and `npm test`
says immediately whether the editions still match `fixtures/expected/`. If a
change is *meant* to alter an edition, update the expected file in the same
commit and say why in the message.

## Running it for real

The service binds loopback and is reached over the tailnet at
**https://otto.tail09aaf9.ts.net:10001/**.

```sh
launchctl kickstart -k gui/$(id -u)/com.thingelstad.wt-builder   # restart
tail -f ~/Library/Logs/wt-builder/wt-builder.log                  # logs
```

Server code does not hot-reload under launchd. After changing anything in
`src/server/`, restart — otherwise the client has the new interface and the old
data, which looks exactly like a rendering bug.

> **Never serve this through Funnel or on a Funnel-enabled port.** Tailscale
> terminates identity in front of the process. There is no authentication layer
> inside the app and it holds write credentials for Pinboard, Micro.blog,
> Buttondown, GitHub, and S3.

## Things that will bite

- **Micro.blog reads through Micropub `q=source`**, which returns the exact
  Markdown the post is stored as. That is what write-back needs. The blog's JSON
  Feed returns *rendered* content and cannot be handed back. `/posts/all` is the
  **timeline** — everyone Jamie follows — and must never be swept into an issue.
- **Pinboard selection is `toread=yes`**, the unread queue, not a tag. The
  `weekly-thing` tag is not in use on the account.
- **Pinboard's `posts/add` replaces the whole record.** Anything not sent is
  reset to its default, which silently publishes a private bookmark. Write-back
  captures `source_flags` at sweep time and hands them back untouched. This has
  already happened once.
- **The window is Friday 00:00 CT to Friday 00:00 CT**, half-open, compared as
  instants and not as date strings. A Thursday-11pm-Central bookmark is stored
  as Friday 04:00 UTC, and comparing dates alone pushes it into the next issue.
- **The issue window filters the editions.** `included` is derived from channels
  *and* the window, on read. Never store it.
- **`.env` must never be committed.** This repo is public.

## Guardrails

- Markdown is an output, never the source of truth while an issue is being
  edited.
- Items, not sections, are the editorial unit. Not every item appears in every
  edition, and the interface must never imply otherwise.
- Thingy-authored content is always visibly attributed. Thingy's words must
  never appear to be Jamie's.
- Echoes renders last and is never spoken. Photo is never spoken. Briefly
  reverses in audio: title, then description.
- Publishing is called **sending**, and it runs per destination. Nothing WT
  Builder sends becomes authoritative where it lands; the archive does that,
  afterwards.
- Generation offers candidates and never writes. Every word in the issue is
  Jamie's because he chose it.
- No undo, no locking, no conflict model — see `docs/decisions.md` before
  adding any of the three.
- Never parse pre-Builder issue Markdown into items.
- Never add secrets, raw Shortcut payloads, or production reader data.
- **Do not retire the Shortcuts workflow.** It stays the fallback until WT
  Builder has published a real issue end to end. Nothing here has sent to a
  reader yet — see `docs/status.md`.

## Decisions

`docs/decisions.md` holds only the decisions that are **invisible in the code** —
absences, and boundaries that span repositories. Everything else belongs in a
comment next to the thing it constrains, which is where it will actually be read.

When you change a contract, update its document and its fixture in the same
commit.
