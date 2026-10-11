# The event log

Every issue has one record of what happened to it: the `events` table. The
Log sheet shows it to Jamie; the issue timing ("Made in") counts his time from
it; the MCP's `changes`, `list_events` and `get_item` history read it; the
Inspector's **History** shows one item's slice of it; `npm run watch` prints
it as it grows. The service log beside it (launchd's
`~/Library/Logs/wt-builder/wt-builder.{log,err}`) holds what an event is not
for: raw errors, model replies, MCP calls, the edge's refusals.

Rebuilt 2026-10-11 (migration v6) after the WT353 session found three gaps:
a fork was invisible until a watcher was already armed, a wand that worked
left no trace, and the service log had no timestamps to line up with
anything.

## An event

| Field | What it holds |
|---|---|
| `id` | Ascending. The MCP cursor is an event id. |
| `at` | The instant, UTC. For an event that narrates a save, the save's own `updated_at`. |
| `kind` | What happened (below). |
| `actor` | Who made it happen: `jamie`, `wt-builder`, or `source`. |
| `summary` | One sentence for a person. |
| `anchor` | The item, or the section for a section-wide act, or `issue` for the issue's own fields. |
| `data` | The facts behind the sentence, as JSON. |

**Code reads `kind`, `actor`, `anchor` and `data`; never the sentence.** The
summary may be reworded at any time. Timing, the MCP and the History read the
fields. Events from before v6 have `data` only where the migration could
give it (a failed wand), so the timing keeps a fallback that reads their
summaries; nothing new should need it.

### Actors

- **`jamie`**: an act in the editor. Only these count as his time.
- **`wt-builder`**: the service on its own, such as a write-back's outcome, a
  verification, a scan's bookkeeping, a leg that finished, or "Published".
- **`source`**: a change made at Pinboard or Micro.blog that a scan brought
  in, such as a refreshed bookmark, a deleted post, or a link that moved
  sections because its tags changed.

Each kind has a usual actor (`ACTOR_OF` in `src/shared/events.ts`). A call
site names another when that one is wrong. For example, a send that finished
is the service's, a drop because the bookmark was deleted is the source's,
and a Retry on a failed write-back is Jamie's.

### Kinds

| Kind | Usual actor | What |
|---|---|---|
| `issue` | jamie | Started, put to bed, woken, restored. "Published" is the service's. |
| `sweep` | wt-builder | A re-scan that changed something: its counts. Its entries follow it. |
| `swept-in`, `refreshed`, `conflict`, `gone`, `held-out`, `put-back`, `moved` | source | What the re-scan found, one per item, anchored to it. |
| `dropped`, `kept` | wt-builder | An item the window no longer admits, removed or kept because its edit has not reached the source. |
| `edit` | jamie | Words. `data.via` is `wand` for a pick from a wand's drafts, `review` for an applied proof fix. |
| `structure` | jamie | The outline: sections, items, order, promotion, moves. |
| `channels` | jamie | An item's website, email or audio channel, or its visibility. |
| `settings` | jamie | The issue's title, dek, number, date, window. Anchor `issue`. |
| `source` | jamie | A decision about an item's source: fork, rejoin, keep mine, take theirs, move the bookmark. |
| `write` | wt-builder | A write-back to Pinboard or Micro.blog and how it came out (`data.ms`). |
| `links` | jamie | The link and blocklist checks (the service's) and Jamie's answers to them. |
| `review` | jamie | The editorial review and the script read. |
| `wand` | jamie | A wand's draft: `data.outcome` is `offered` (with `offered`, the count) or `failed`, and `data.ms`. An override is a `wand` event too. |
| `send` | jamie | A leg's start (`data.action: 'start'`), its finish or failure (the service's, with `data.ms`), refusals and overrides. |
| `verify` | wt-builder | A leg's check, logged only when its status moves (`data.from`, `data.to`), when it errs, or when Jamie asked. |
| `share` | jamie | LinkedIn, the blog post. Before 2026-10-11, the draft share too. |

## Rules for writing one

1. **An event that narrates a save is written in the save's transaction.**
   Pass it to `saved(doc, events)`, `savedFresh(id, change, events)` or
   `store.saveIssue(doc, events)`. It gets the save's instant, so
   `versionBefore(event.at)` is the issue just before that change. It is
   never logged for a save that did not happen, and a save never lands
   without it. When the event depends on what the save produced, pass
   `savedFresh` a function of the new document.
2. **An event that narrates no save** (a wand's draft, a send starting, a
   refusal) goes through `store.record(issueId, event)`, which returns its id.
3. **Anchor it.** If an act touched an item, the event names the item. A
   section-wide act names the section's node id, and the issue's own fields
   name `issue`. An item's History and `get_item` read by anchor.
4. **Put the facts in `data`.** Use whatever a reader would otherwise parse
   out of the sentence: the source, the fields, from and to, the duration.
5. **Log the press, not just the failure.** A wand that comes back is an
   event, and so is a pick from it (`?via=wand` on the PATCH or settings
   route). Without that, the log cannot say what the wands did for an issue.
6. **Don't log what says nothing new.** A quiet re-scan logs nothing. A
   recheck that agrees with the last check logs nothing.
7. A new kind goes in `EventKind` and `ACTOR_OF`, and in `KIND` in
   `src/client/components/EventLog.tsx` for its chip. The types make all
   three a compile error until it is decided.

## The service log

Every line starts with its UTC instant and level (`src/server/log.ts`):

```
2026-10-11T10:48:32.995Z WARN  [draft] wt353 Haiku: 429 Too Many Requests (event 1601)
```

A line about an issue names it after its tag. A line that goes with an event
ends with `(event N)`, so the detail behind a "Draft failed" row is one grep
away. Boot is one line: `[boot] WT Builder on http://… — key: value, …`.

## Reading it

- **Log sheet**: every event, newest first. "Only what you did" hides the
  service's and the sources' rows, which are dimmed otherwise.
- **Inspector → History**: the item's last 20 events with who did each,
  from `GET /api/issues/:id/events?item=<id>`.
- **MCP**: `list_events` with `item` and `kind` filters, `get_item.history`,
  and `get_status` `changes`, which carry the actor.
- **Timing**: Jamie's acts by `actor`, "Published" and send starts by `data`,
  time by anchor, and `wands` (presses, failures, picks used, time waiting).
- **`npm run watch -- wt353`**: replays the last ten events and then each new
  one as `EVENT #id hh:mm:ssZ kind/actor [anchor]: summary`, beside the
  service log lines.
