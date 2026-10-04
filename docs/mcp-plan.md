# WT Builder: section dependencies and an MCP interface (plan)

Status: **approved 2026-10-04** (Part A with the dependency map as written,
Part B as a read-only v1, D2 as recommended). **Part A built 2026-10-04.**

Open follow-up (Jamie, 2026-10-04): "I think Membership SHOULD pull context
from the current issue but we can come back to that." Today its wand is
grounded in the members page, with the issue only as background; if it comes
to draw on the issue, revisit whether Membership waits on anything.

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
proves it has no cycles. Every section and pill is listed, including the ones
that wait on nothing, so the map is the whole answer in one place (final
review, 2026-10-04).

**The rule for a dependency:** a section waits on another only when it is
*made from* it, so that finishing it early means redoing it. Reading
something for flavour is not a dependency.

**Inputs: wait on nothing.** These are what everything else is made from.

| Section / pill | Waits on | Why |
|---|---|---|
| Notable (Featured) | nothing | Jamie's commentary on the week's lead links. The root input. |
| Journal (and promoted posts) | nothing | The week's posts, published on Micro.blog before the issue. |
| Briefly | nothing | A line per link. |
| Intro | nothing | Jamie's own opening; no wand. |
| Currently | nothing | Jamie's week, line by line. |
| Photo | nothing | A picture, its alt text and caption. |
| Ad hoc sections, Quote, Markdown blocks | nothing | Jamie's own, and nothing waits on them. |

**Made from other sections: wait.**

| Section / pill | Waits on | Why |
|---|---|---|
| Title and dek | Notable | Jamie, 2026-10-04: "Title and dek depend on Featured links for sure." The theme comes from the lead links. The dek's topic list also draws on Briefly and the Journal, but their topics are known from the link titles and posts as soon as they are in the issue, so they do not hold it up. |
| Echoes | Notable, Journal | Jamie, 2026-10-04: "Just Notable and Journal is what I would have expected." The wand also reads Intro, Currently and Photo when they are there, but they do not hold it up. Only the empty-section pill can wait; an echo already drafted is its own pill. |
| Haiku | Notable, Journal, Briefly | Jamie, 2026-10-04. The haiku distils the week's material. |
| Outro | Intro | Jamie, 2026-10-04. The outro answers the intro. |

**No dependency, considered and rejected.**

| Section / pill | Waits on | Why |
|---|---|---|
| Membership | nothing | Its wand is grounded in the live members page (this year's nonprofit, the $48 offer), not in the issue: the assembled issue rides along as background, as it does for every wand. A Membership written first is as good as one written last. |
| Links checked | nothing | It corrects itself: a link added after a check shows as not checked, and the pill drops back. A dependency would only delay a check that can run any time and runs again at send. |
| Deliverability | nothing | The same: a new domain shows as not looked up, and the pill drops back. |
| Sync pills (a failed or conflicted write-back) | nothing | Urgent whenever they appear; never waiting. |

No chains: nothing that waits is itself waited on, so `waiting_on` is always
the direct list. If a chain is ever added, it works without a change: a
dependency that is itself waiting is not done, so the section after it waits
too.

"Notable" here means the heading-link section, whichever name it has: older
issues call it Featured, and the code already treats `notable` and `featured`
as one group (`HEADING_LINK_SECTIONS`). The map uses that group, not a label.

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
- **The strip** draws a waiting tick hollow and muted, with the tooltip: "Haiku — waiting on Notable (3 of 5), Briefly (6 of 9)". The
  summary line counts it apart: "14 of 22 done · 3 in progress · 2 waiting".
  Clicking still only scrolls (the navigation rule), to the section itself.
- **The checklist** shows WAITING beside the item, with the same line.
- **The wands warn, never block** (the warn-don't-block rule). The Haiku,
  Echoes and title/dek wands on a waiting section open with "Briefly isn't
  finished. Draft anyway?" behind a confirm. (Outro has no wand: Intro and
  Outro never get one. Its pill just reads waiting until the Intro is done.)
  The server takes `?force=1`, and the event log records "Override — drafted
  Haiku before Briefly was done". Writing by hand is never interrupted.
- `fixed_position: 'last'` stays. It is where Echoes prints, which is a
  separate question from when it can be made.

## Part B: the MCP interface (v1: local, read-only)

### Why

Jamie, 2026-10-03: "having an MCP interface in WT Builder that allows an agent
to interact with a draft issue would be pretty amazing." A Claude Code session
on the Mac can already reach a draft through the HTTP API with `curl`; an MCP
interface gives any MCP client typed tools for it, with descriptions that say
what each one does, instead of a shell and a reading of `index.ts`.

### The three levels, and which one this is

1. **Local (this plan, read-only).** An `/mcp` endpoint on the existing service. Claude
   Code and Codex on the Mac connect to `http://127.0.0.1:4317/mcp`. No new
   hosting, no new auth.
2. **Tailnet.** The same endpoint at `https://otto.tail09aaf9.ts.net:10001/mcp`
   for MCP clients on Jamie's other devices. Comes with level 1 unless
   decision D2 says otherwise.
3. **claude.ai web and phone.** Those connectors are called from Anthropic's
   cloud and cannot reach the tailnet: they need a public HTTPS path and
   OAuth, most likely the Librarian's authorization server with an
   owner-only scope. AGENTS.md forbids serving this process through Funnel
   (it holds write credentials and has no auth layer), so that path would be
   a separate front, not Funnel on this port. **Not in this plan.** Revisit after using level 1 for an issue or two.

### Read-only first

Jamie, 2026-10-04: "Perhaps we should make v1 read only?" Yes. v1 lets an
agent see everything the editor shows and change nothing. It is the smaller
build by far (no proposal store, no margin UI, no direct tools, no keeping an
open page in step with outside writes, no attribution), it cannot hurt a live
issue, and using it on a real draft will show which writes are actually worth
building. Suggestions in v1 come back in the agent's chat, and Jamie applies
the ones he wants by hand. The write design is kept below as v2.

### Principles

- **Every tool goes through the existing GET routes.** The MCP layer calls
  the same route handlers the editor calls, in process, so the agent sees
  exactly what the page sees. No tool touches the database directly.
- **Read-only, enforced.** The dispatch accepts GET routes only and refuses
  anything else; every tool carries the MCP `readOnlyHint` annotation; a test
  fails if a tool reaches a non-GET route. The one write a GET already makes
  is the editor's own skeleton repair on opening an older issue
  (`normalizeSkeleton`), which is the same thing opening it in Safari does.
- **No model calls, no network writes.** No wands, no editorial review run,
  no link or blocklist checks, no send previews (those reach GitHub).
- **Never silent** (the Librarian MCP rule, 2026-09-30). A list is complete or
  says what it left out and how to get the rest. A refusal says why.

### Design

#### Transport and placement

- A Streamable HTTP MCP endpoint at `/mcp`, in the existing Node process, on
  the existing port. Stateless mode, JSON responses (every tool answers in one
  response). Built on `@modelcontextprotocol/sdk` (1.32.0 on npm as of
  2026-10-04) and its Node transport, which takes the raw
  `IncomingMessage`/`ServerResponse` the service already has.
- **The edge stays in front.** `edge.ts` already refuses a foreign Host (DNS
  rebinding) and any write carrying a browser Origin that is not the app's.
  MCP clients send neither header, so they pass; a web page trying to drive
  `/mcp` from Jamie's browser is refused, which is what the MCP spec asks of a
  local server. No edge change expected; a test pins it.
- **In-process dispatch.** A small `readRoute(path)` finds the GET route in
  the existing table and runs its handler with a synthetic context, so a tool
  is a few lines: name, schema, description, and which route it reads.
  Errors come back as `HttpError` with the route's own message, which becomes
  the tool's error text.

#### Tools

| Tool | What it returns | Backed by |
|---|---|---|
| `get_status` | **Where the issue stands, as the strip and Send view show it.** Lifecycle (draft, published, asleep); every pill in strip order with its state (`done`, `partial`, `todo`, `waiting`), kind, the line that says what finishing it means, and for a waiting pill what it waits on and how far along that is; the counts; and each send leg (website, email, podcast, archive) with sent / failed / not yet, plus the script review and verify results. One call answers "what is left, and what can be worked on now?" | `readiness()`, `doc.sends`, `doc.verify`, `doc.script_review` |
| `list_issues` | Issues with number, date, status, title, and the strip's counts; drafts first, then the most recent published | `GET /api/issues` |
| `get_issue` | The issue as an outline: sections in order, each item with id, type, title, full text fields, sync state, held-out flag, and its pill's state | `GET /api/issues/:id` |
| `get_item` | One item, every field | same |
| `render_issue` | One edition as it will print: `website`, `email`, `audio` (the script) or `source` | `GET /render/:lens` |
| `get_review` | The current editorial review notes, as the margin shows them | the doc's `review` |
| `list_events` | The event log, optionally `since` an event id | `GET /events` |
| `get_timing` | How long the issue has taken, beside the one before | `GET /timing` |

Every tool takes the issue as `wt353` (or the issue id). Any issue can be
read, published ones included, so an agent can compare this week with the
last. Outputs carry an `outputSchema` (structured content) as the Librarian
MCP does.

#### Connecting a client

- Claude Code (user scope, so every session on the Mac has it):
  `claude mcp add --scope user --transport http wt-builder http://127.0.0.1:4317/mcp`
- Codex: an HTTP `[mcp_servers.wt-builder]` entry in `~/.codex/config.toml`,
  confirmed against Codex's current docs when built.
- Server `instructions` (sent at initialize) say: this server is read-only;
  start with `get_status`; pills that are waiting cannot be finished yet;
  suggest changes to Jamie in the conversation, never claim to have made them.

### Out of scope for v1

- Every write: edits, proposals, moves, reorders, adding links.
- Sending, verifying, sharing, rehosting, putting to bed.
- The wands, the editorial review run, link and blocklist checks.
- Levels 2-3 auth (see above).

### Later: v2 writes (not in this plan)

Kept so the thinking is not lost; revisit after v1 has been used on an issue
or two, and build only the writes that use asked for.

- **The agent proposes; Jamie decides.** Text changes arrive as proposals in
  the margin (badge PROPOSED, was → now, the agent's reason, Apply /
  Dismiss), stored as `doc.proposals[]` so review runs never wipe them. Apply
  is Jamie's own PATCH, so write-back and the log behave as if he typed it. A
  full replacement on a field changed since it was proposed warns and offers
  Apply anyway.
- **Direct writes only where one click undoes them:** `reorder_section`
  (requiring exactly the current items; the route itself is lenient) and
  `move_link` between Notable and Briefly.
- **The open page follows outside changes**: a cheap stamp route the page
  checks every 5 seconds while visible, so an agent's move shows without a
  reload and a stale drag cannot put an old order back.
- **Attribution**: an `actor` column on events, set through an
  `AsyncLocalStorage` scope; agent work shown as its own line beside "Made
  in", never counted in it; the watcher shows the actor.
- Deferred decisions: proposals only or some direct text edits; whether
  published issues can take proposals for a re-send.

## Build order

Each step is a commit (or a few), tested, deployed with `npm run deploy`.

Part A:

A1. **The map and the state.** `src/shared/dependencies.ts`, the `waiting`
   state and `waiting_on` in `readiness()`, the no-cycles test, unit tests on
   the representative issue (Haiku waits while a Briefly line is empty; a
   written Haiku stays done; a missing section counts as met; a Featured
   section counts as Notable).
A2. **The editor.** Hollow waiting ticks, tooltip, summary count, checklist
   line, the wands' "draft anyway?" confirm with `?force=1` and the Override
   event. E2e in WebKit first.

Part B (v1):

B1. **Plumbing.** SDK dependency, `/mcp` route, `readRoute`, `get_status`,
   `list_issues`, `get_issue`. Tests: an SDK client round trip against a
   port-0 server; an Origin-bearing POST to `/mcp` is refused; no tool can
   reach a non-GET route.
B2. **The rest of the tools.** `get_item`, `render_issue`, `get_review`,
   `list_events`, `get_timing`.
B3. **Docs and registration.** `docs/service-contracts.md`,
   `docs/decisions.md`, `AGENTS.md`; register the server in Claude Code at
   user scope.
B4. **Try it on a real draft** with Jamie: Claude Code reads WT354 through
   the MCP, checks `get_status`, and suggests Briefly lines and an order in
   the conversation.

## Decisions for Jamie

- **D2. `/mcp` answers on the tailnet too** (recommended: it costs nothing,
  and it is the same trust as the editor, which is already on the tailnet
  without auth; restricting `/mcp` alone protects nothing), or loopback only
  for now.

Settled 2026-10-04: v1 is read-only (D1, D3 and D4 move to v2); Echoes waits
on Notable and Journal (D5); Title and dek wait on Notable (D6); Membership,
Links checked and Deliverability wait on nothing (final review).
