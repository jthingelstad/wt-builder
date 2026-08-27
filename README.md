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

**Implementation.** The interaction design is settled and the prototype in
[`prototype/`](prototype/) is the reference for what the interface does. The
first slice runs end to end: sweep, assemble, four lenses, and a Buttondown
draft. Website and podcast sending are not built yet.

Start with:

1. [`AGENTS.md`](AGENTS.md) — the current phase, the stack, the guardrails
2. [`docs/item-model.md`](docs/item-model.md)
3. [`docs/rendering-contracts.md`](docs/rendering-contracts.md)
4. [`docs/service-contracts.md`](docs/service-contracts.md)
5. [`fixtures/representative-issue.json`](fixtures/representative-issue.json)

## Running it

```sh
cp .env.example .env      # three credentials; see the file
npm install
npm test                  # 44 tests
npm run dev               # service on :4317, client on :5317
```

The service holds every credential and the browser talks only to `/api`. It
binds loopback by default. To reach it from the tailnet:

```sh
npm run build
npm start
tailscale serve --bg 4317
```

Tailscale terminates identity in front of the process. There is no
authentication layer inside the app, so do not bind it to a public interface.

### What runs against a real service

- **Pinboard** — reads the unread queue for the issue's window. Write-back
  mutates real bookmarks and stays off unless
  `WT_BUILDER_PINBOARD_WRITEBACK=true`.
- **Micro.blog** — reads the blog's public JSON Feed. Read-only, always.
- **Buttondown** — creates and updates a draft. Never schedules, never sends.

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
