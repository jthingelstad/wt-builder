# WT Builder: section dependencies and an MCP interface (plan)

Status: **proposed 2026-10-04, awaiting Jamie's approval.** Nothing here is built.

Two parts. **Part A** (section dependencies) is an editor change that stands
on its own and lands first, because the MCP status tool in **Part B** reports
it.

## Part A: sections that wait on other sections

### The problem

The strip treats every pill as something Jamie can do now, and the outline's
only notion of order is that Echoes is pinned last (`fixed_position: 'last'`).
Position is not the real constraint. Some sections are *made from* others and
cannot be done well until those are finished. Jamie, 2026-10-04: "Haiku cannot
be generated until Notable, Journal, Briefly are populated — those are inputs
for it. Echoes has a similar dependency path." And: "Outro should depend on
Intro." A pill for one of these should say it is **waiting**, and on what.

### The dependency map

One table, in `src/shared/dependencies.ts`, keyed by section type, read by
the readiness code, the strip, the wands and the MCP status tool. A unit test
proves it has no cycles.

| Section | Waits on | Why |
|---|---|---|
| Haiku | Notable, Journal (and promoted posts), Briefly | Jamie, 2026-10-04. The wand reads the assembled issue. |
| Echoes | Notable, Journal (and promoted posts), Intro, Currently, Photo | What the Echoes wand actually retrieves from (`echoesAnchors`): each Notable link and promoted post on its own, and Intro, Currently, Photo and Journal moments pooled as "the week itself". Briefly is not an input. **To confirm (D5).** |
| Outro | Intro | Jamie, 2026-10-04 |
| Title and dek | not proposed | The head wand also reads the assembled issue. **To decide (D6).** |

A dependency is **met** when every pill of that section is done (not merely
started): a stub of Notable commentary is not yet an input. Two exceptions,
because they are not words the dependent section reads: a Journal post that
only lacks alt text counts as met, and the separate sync pills (a failed or
conflicted write-back) do not count. A section that is not in the issue, or
has nothing in it, is met: it owes nothing.

### The fourth state: waiting

- `ReadinessState` gains `waiting`. A unit that is not done and has an unmet
  dependency is `waiting` instead of `todo` or `partial`, and carries
  `waiting_on`: the unmet sections, each with how far along it is ("Notable,
  3 of 5 done").
- **A finished section stays done.** If the haiku is already written, its
  pill is done even while Briefly is still being filled. (Flagging a haiku or
  echo written *before* its inputs settled, as possibly stale, is a later
  idea, not in this plan.)
- **The strip** draws a waiting tick hollow and muted with an hourglass in
  the tooltip: "Haiku — waiting on Notable (3 of 5), Briefly (6 of 9)". The
  summary line counts it apart: "14 of 22 done · 3 in progress · 2 waiting".
  Clicking still only scrolls (the navigation rule), to the section itself.
- **The checklist** shows WAITING beside the item, with the same line.
- **The wands warn, never block** (the warn-don't-block rule). The Haiku
  and Echoes wands on a waiting section open with "Briefly isn't finished.
  Draft anyway?" behind a confirm. (Outro has no wand: Intro and Outro never
  get one. Its pill just reads waiting until the Intro is done.) The server
  takes `?force=1`, and the event log records "Override — drafted Haiku before Briefly was done".
  Writing by hand is never interrupted.
- `fixed_position: 'last'` stays. It is where Echoes prints, which is a
  separate question from when it can be made.

## Part B: the MCP interface (step 1, local)

### Why

Jamie, 2026-10-03: "having an MCP interface in WT Builder that allows an agent
to interact with a draft issue would be pretty amazing." A Claude Code session
on the Mac can already reach a draft through the HTTP API with `curl`; an MCP
interface gives any MCP client typed tools for it, with descriptions that say
what each one does, instead of a shell and a reading of `index.ts`.

### The three levels, and which one this is

1. **Local (this plan).** An `/mcp` endpoint on the existing service. Claude
   Code and Codex on the Mac connect to `http://127.0.0.1:4317/mcp`. No new
   hosting, no new auth.
2. **Tailnet.** The same endpoint at `https://otto.tail09aaf9.ts.net:10001/mcp`
   for MCP clients on Jamie's other devices. Comes with level 1 unless
   decision D2 says otherwise.
3. **claude.ai web and phone.** Those connectors are called from Anthropic's
   cloud and cannot reach the tailnet: they need a public HTTPS path (Tailscale
   Funnel or a tunnel exposing only `/mcp`) and OAuth, most likely the
   Librarian's authorization server with an owner-only edit scope. **Not in
   this plan.** Revisit after using level 1 for an issue or two.

### Principles

- **Every tool goes through the existing routes.** The MCP layer calls the
  same route handlers the editor calls, in process. Pinboard and Micro.blog
  write-back, compare-and-set, the event log, the line-break flattening guard,
  the 423 on an issue put to bed and the validation all apply unchanged. No
  tool touches the database or `issue.ts` directly.
- **The agent proposes; Jamie decides.** Text an agent wants changed arrives
  as a proposal in the editor's margin, with Apply and Dismiss. The issue stays
  in Jamie's voice, and the agent can never overwrite something Jamie is in
  the middle of typing.
- **Direct writes only where they are cheap to undo.** Reordering a section
  and moving a link between Notable and Briefly. Both are one click to reverse
  in the editor.
- **Nothing that sends.** No send, verify, share, rehost or put-to-bed tools.
  Publishing stays in the editor.
- **Never silent** (the Librarian MCP rule, 2026-09-30). A list is complete or
  says what it left out and how to get the rest. A refusal says why.
- **Every agent action is attributed.** The event log records who did it, so
  the log, the live watcher and issue timing can tell Jamie's work from the
  agent's.

### Design

#### Transport and placement

- A Streamable HTTP MCP endpoint at `/mcp`, in the existing Node process, on
  the existing port. Stateless mode, JSON responses (no SSE streams needed:
  every tool answers in one response). Built on `@modelcontextprotocol/sdk`
  (1.32.0 on npm as of 2026-10-04) and its Node transport, which takes the
  raw `IncomingMessage`/`ServerResponse` the service already has.
- **The edge stays in front.** `edge.ts` already refuses a foreign Host (DNS
  rebinding) and any write carrying a browser Origin that is not the app's.
  MCP clients send neither header, so they pass; a web page trying to drive
  `/mcp` from Jamie's browser is refused, which is what the MCP spec asks of a
  local server. No edge change expected; a test pins it.
- **In-process dispatch.** A small `callRoute(method, path, body)` finds the
  route in the existing table and runs its handler with a synthetic context,
  so a tool is a few lines: name, schema, description, and which route it
  calls. Errors come back as `HttpError` with the route's own message, which
  becomes the tool's error text.
- **Attribution without threading.** The dispatch runs inside an
  `AsyncLocalStorage` scope carrying `actor: 'agent'` and the client's name
  (from MCP `initialize`, for example "claude-code"). `logEvent` reads it. A
  migration adds an `actor` column to `events` (null for the editor, so every
  past event reads as Jamie's).

#### Tools

Read (no writes, no model calls):

| Tool | What it returns | Backed by |
|---|---|---|
| `get_status` | **Where the issue stands, as the strip and Send view show it.** Lifecycle (draft, published, asleep); every pill in strip order with its state (`done`, `partial`, `todo`, `waiting`), kind, the line that says what finishing it means, and for a waiting pill what it waits on and how far along that is; the counts; open proposals; and each send leg (website, email, podcast, archive) with sent / failed / not yet, plus the script review and verify results. One call answers "what is left, and what can I work on now?" | `readiness()`, `doc.sends`, `doc.verify`, `doc.script_review` |
| `list_issues` | Issues with number, date, status, title, and the strip's counts; drafts by default, `include` widens | `GET /api/issues` |
| `get_issue` | The issue as an outline: sections in order, each item with id, type, title, full text fields, sync state, held-out flag, and its pill's state | `GET /api/issues/:id` |
| `get_item` | One item, every field | same |
| `render_issue` | One edition as it will print: `website`, `email`, `audio` (the script) or `source` | `GET /render/:lens` |
| `get_review` | The current editorial review notes, as the margin shows them | the doc's `review` |
| `list_events` | The event log, optionally `since` an event id, with actor | `GET /events` |
| `list_proposals` | Open proposals on the issue and what became of recent ones | new |

Propose (writes only the proposal, never the item):

| Tool | Effect |
|---|---|
| `propose_edit` | A change to one text field of one item: `title`, `commentary`, `body`, `label`, `ask`, or a photo's `caption`/`alt`. Either a full replacement or a `was`/`now` substring fix (the PROOF note shape). Carries a short `why`. |
| `propose_issue_edit` | The same for the issue's `title` and `dek` |
| `withdraw_proposal` | The agent takes back one of its own open proposals |

Direct (structural, reversible):

| Tool | Effect | Backed by |
|---|---|---|
| `reorder_section` | A new order for a section's items. The tool requires it to name exactly the items there now and refuses otherwise, saying which differ (the route itself is lenient: it drops unknown ids and appends unnamed ones, which suits a drag but would hide an agent working from a stale read) | `POST /nodes/:id/reorder` |
| `move_link` | A link between Notable and Briefly; updates the `_brief` tag on Pinboard, as the rail button does | `POST /items/:id/section` |

Every tool takes the issue as `wt353` (or the issue id) and refuses an issue
that is not a draft, with the reason. Outputs carry an `outputSchema`
(structured content) as the Librarian MCP does.

#### Proposals

- Stored on the issue document as `doc.proposals[]` (schema version bump), so
  they ride the existing save, revision history and 423 guard, and an
  editorial review run (which replaces `doc.review`) never touches them.
- Shape: `id`, `target` (item id or `issue`), `field`, either `text` (full
  replacement) or `was`/`now`/`nth`, `why`, `by` (client name), `at`, `base`
  (a hash of the field's value when proposed), `status` (`open`, `applied`,
  `dismissed`, `withdrawn`).
- **In the editor:** open proposals render in the right margin through the
  same measured overlay as the review notes, with their own badge
  ("PROPOSED"), the was → now or a before/after of the field, the `why`, and
  **Apply** / **Dismiss**. Apply sends the ordinary PATCH from Jamie's client,
  so the write-back and event log behave exactly as if Jamie had typed it, and
  the event reads "Applied a proposal".
- **When the field changed since the proposal** (base hash differs): a
  `was`/`now` fix still applies if its substring is found. A full replacement
  shows "This changed since it was proposed" with **Apply anyway…** behind a
  confirm, per the warn-don't-block rule.
- The progress strip counts open proposals the way it counts review notes.

#### The open page follows outside changes

Today the editor only learns of changes from the answers to its own requests.
A structural move by the agent would not show until Jamie's next action or a
reload, and a reorder sent from a stale page could undo it. So:

- A cheap `GET /api/issues/:id/stamp` (the issue's `updated_at` and the last
  event id). The page asks every 5 seconds while visible and on returning to
  the tab; when it moved, the page refetches the issue and absorbs it. A
  focused editable is already left alone by `Editable`/`RichEditable`, so
  nothing Jamie is typing is replaced.
- The reorder route never loses an item (unknown ids are dropped, unnamed
  ones appended), but a drag on a stale page would put back the order it last
  saw, undoing an agent's reorder of that section. Following outside changes
  is what closes that; an e2e pins that a reorder made after an outside move
  starts from the moved order.

#### Timing and the watcher

- Issue timing ("Made in") counts Jamie's editing time; agent events are
  excluded from it and shown as their own line ("agent: 14 actions"), so
  WT353+ still say whether a feature saved Jamie time.
- `npm run watch` prints the actor on agent lines.

#### Connecting a client

- Claude Code (user scope, so every session on the Mac has it):
  `claude mcp add --scope user --transport http wt-builder http://127.0.0.1:4317/mcp`
- Codex: an HTTP `[mcp_servers.wt-builder]` entry in `~/.codex/config.toml`,
  confirmed against Codex's current docs when built.
- Server `instructions` (sent at initialize) say: drafts only; start with
  `get_status`; work on pills that are not waiting; propose text, never claim
  to have changed it; Jamie applies.

### Out of scope for step 1

- Sending, verifying, sharing, image rehosting, putting to bed, deleting
  items or sections, adding sections.
- **Adding links.** A link is a Pinboard bookmark; adding one means creating a
  bookmark, which is a bigger write than this plan wants. Later, likely as a
  proposal ("add this URL to Briefly") that Jamie accepts.
- The wands and the editorial review run. Both call Claude and cost money,
  and the caller is already a model. The agent can read the existing review.
- Published and asleep issues.
- Levels 2-3 auth (see above).

## Build order

Each step is a commit (or a few), tested, deployed with `npm run deploy`.

Part A:

A1. **The map and the state.** `src/shared/dependencies.ts`, the `waiting`
   state and `waiting_on` in `readiness()`, the no-cycles test, unit tests on
   the representative issue (Haiku waits while a Briefly line is empty; a
   written Haiku stays done; a missing section counts as met).
A2. **The editor.** Hollow waiting ticks, tooltip, summary count, checklist
   line, the wands' "draft anyway?" confirm with `?force=1` and the Override
   event. E2e in WebKit first.

Part B:

1. **Plumbing.** SDK dependency, `/mcp` route, `callRoute`, actor scope,
   `events.actor` migration, `get_status`, `list_issues` and `get_issue`. Test: an SDK
   client round trip against a port-0 server; an Origin-bearing POST to `/mcp`
   is refused; the event log records the actor.
2. **Read tools.** The rest of the read table.
3. **Proposals, server side.** `doc.proposals`, the three propose tools, the
   apply/dismiss routes, the stale-base rule.
4. **Proposals in the editor.** Margin cards, Apply/Dismiss, Apply anyway,
   strip count. E2e in WebKit first.
5. **Direct tools.** `reorder_section`, `move_link`.
6. **Following outside changes.** The stamp route and the page's 5-second
   check. E2e: an agent move appears without a reload; a focused field is not
   replaced.
7. **Timing, watcher, docs.** Agent line in "Made in", actor in the watcher,
   `docs/service-contracts.md`, `docs/decisions.md`, `AGENTS.md`, and
   registering the server in Claude Code.
8. **Try it on a real draft** with Jamie: Claude Code reads WT354's draft and
   checks `get_status`, then proposes Briefly lines and an order.

## Decisions for Jamie

- **D1. Text edits are proposals only** (recommended), or the agent may edit
  some fields directly (for example link titles) with the event log as the
  record.
- **D2. `/mcp` answers on the tailnet too** (recommended: it costs nothing,
  and it is the same trust as the editor, which is already on the tailnet
  without auth; restricting `/mcp` alone protects nothing), or loopback only
  for now.
- **D3. Agent time stays out of "Made in"** and shows as its own line
  (recommended), or is counted.
- **D4. Drafts only** (recommended), or the agent may also propose fixes on a
  published issue for a re-send.
- **D5. Echoes waits on** Notable, Journal, Intro, Currently and Photo (what
  its wand reads; recommended), or only Notable and Journal (so a late Intro
  does not hold it up).
- **D6. Title and dek wait on nothing** (recommended: Jamie often names the
  theme early, and it is easy to revise), or on the same inputs as Haiku.
