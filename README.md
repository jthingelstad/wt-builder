# WT Builder

WT Builder is the authoring application for
[The Weekly Thing](https://weekly.thingelstad.com/). One editor, one live issue,
nine years of a Shortcuts workflow being retired into it.

It combines content written directly for the issue with items swept from
Pinboard and Micro.blog, keeps the issue **structured** until the moment it is
sent, and renders three intentionally different editions:

- the website,
- the Buttondown email, and
- the audio/podcast edition.

The product is narrow on purpose: one editor, one current issue, one newsletter.

## Status

**Building, and close to publishing real issues.** The editor, all four lenses,
the editorial review, and all three send legs are built and running.

**Nothing has been sent to a reader yet.** The website commit and the podcast
synthesis have never been run for real. Until one issue has gone out end to end,
the Shortcuts workflow stays the fallback.

`docs/status.md` is the honest inventory: what works, what is half-built, and
what has never run.

## Start here

1. [`AGENTS.md`](AGENTS.md) — phase, stack, guardrails, and the things that bite.
   `CLAUDE.md` is a symlink to it.
2. [`docs/interface-spec.md`](docs/interface-spec.md) — **the interface
   authority.** Every screen, and the alternatives that were tried and rejected.
3. [`docs/status.md`](docs/status.md) — what is actually built.
4. [`docs/item-model.md`](docs/item-model.md) and
   [`docs/rendering-contracts.md`](docs/rendering-contracts.md) — the data and
   the editions.
5. [`docs/decisions.md`](docs/decisions.md) — the decisions that are invisible in
   the code.

## Running it

```sh
cp .env.example .env      # see the file; three credentials are required
npm install
npm test                  # 174 tests
npm run dev               # service on :4317, client on :5317
```

The service holds every credential and the browser talks only to `/api`. It binds
loopback. To reach it from the tailnet:

```sh
npm run build
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.thingelstad.wt-builder.plist
tailscale serve --bg --https=10001 http://127.0.0.1:4317
```

Reachable at **https://otto.tail09aaf9.ts.net:10001/** — tailnet only.

> ⚠️ **Never serve this through Funnel or on a Funnel-enabled port.** Tailscale
> terminates identity in front of the process; there is no authentication layer
> inside the app, and it holds write credentials for Pinboard, Micro.blog,
> Buttondown, GitHub, and S3. `tailscale funnel status` must never list it.

Managing the service:

```sh
launchctl kickstart -k gui/$(id -u)/com.thingelstad.wt-builder   # restart
launchctl list | grep wt-builder                                  # status
tail -f ~/Library/Logs/wt-builder/wt-builder.log                  # logs
```

Server code does not hot-reload under launchd. After changing `src/server/`,
restart — otherwise the client has the new interface and the old data, which
looks exactly like a rendering bug.

### What talks to a real service

- **Pinboard** — reads the unread queue (`toread=yes`) for the issue's window.
  Write-back mutates real bookmarks and is **on** in `.env.example`.
- **Micro.blog** — reads and writes post source through Micropub `q=source`.
  Write-back edits the published post.
- **Buttondown** — creates and updates a **draft**. Never schedules, never sends.
- **Website** — commits generated inputs to `weekly.thingelstad.com`. Built,
  never run.
- **Archive** — commits issue text into the corpus repository the Librarian
  API answers from, after publication. Built, never run.
- **Podcast** — OpenAI TTS, mastered and uploaded to `files.thingelstad.com`.
  Built, never run.
- **Images** — remote images and dropped photos are resized and rehosted to the
  CDN before sending.
- **Editorial review** — two passes, proofing then judgement. Button-only, and it
  never writes a word into the issue.

## Product principles

- Markdown is an output, not the source of truth.
- Items, not sections, are the fundamental editorial unit.
- Source content and issue-specific edits are both preserved.
- Website, email, and audio are first-class render targets, and no item is
  assumed to belong in all three.
- Thingy may write only clearly attributed content.
- Generation offers candidates; Jamie accepts them. Every word in the issue is
  his because he chose it.
- Sending is per destination, and nothing WT Builder sends becomes authoritative
  where it lands.

## Related systems

The archive is not a publishing destination; it is fed afterward so Thingy can
answer questions about the issue. See [`docs/decisions.md`](docs/decisions.md).

- `weekly.thingelstad.com` — downstream render surface. Receives the website
  edition and renders the podcast feed. Holds no publishing logic.
- Buttondown — receives the email edition as a draft.
- `files.thingelstad.com` — the only home for the rendered audio, and where
  rehosted images live.
- `studio-thing` — the corpus and retrieval API. Fed after publication, never
  during it. Its product model is not inherited and none of its code was reused.
- Thingy/Librarian — archive retrieval and attributed generation for Membership
  and Echoes.

No credentials, Shortcut payloads, or reader data belong in this public
repository.
