# WT Builder MCP: plan (step 1, local)

Status: **proposed 2026-10-04, awaiting Jamie's approval.** Nothing here is built.

## Why

Jamie, 2026-10-03: "having an MCP interface in WT Builder that allows an agent
to interact with a draft issue would be pretty amazing." A Claude Code session
on the Mac can already reach a draft through the HTTP API with `curl`; an MCP
interface gives any MCP client typed tools for it, with descriptions that say
what each one does, instead of a shell and a reading of `index.ts`.

## The three levels, and which one this is

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

## Principles

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

## Design

### Transport and placement

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

### Tools

Read (no writes, no model calls):

| Tool | What it returns | Backed by |
|---|---|---|
| `list_issues` | Issues with number, date, status, title; drafts by default, `include` widens | `GET /api/issues` |
| `get_issue` | The issue as an outline: sections in order, each item with id, type, title, full text fields, sync state, held-out flag; plus readiness (what each anchor still owes) | `GET /api/issues/:id` |
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

### Proposals

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

### The open page follows outside changes

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

### Timing and the watcher

- Issue timing ("Made in") counts Jamie's editing time; agent events are
  excluded from it and shown as their own line ("agent: 14 actions"), so
  WT353+ still say whether a feature saved Jamie time.
- `npm run watch` prints the actor on agent lines.

### Connecting a client

- Claude Code (user scope, so every session on the Mac has it):
  `claude mcp add --scope user --transport http wt-builder http://127.0.0.1:4317/mcp`
- Codex: an HTTP `[mcp_servers.wt-builder]` entry in `~/.codex/config.toml`,
  confirmed against Codex's current docs when built.
- Server `instructions` (sent at initialize) say: drafts only; propose text,
  never claim to have changed it; read `get_issue` first; Jamie applies.

## Out of scope for step 1

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

1. **Plumbing.** SDK dependency, `/mcp` route, `callRoute`, actor scope,
   `events.actor` migration, `list_issues` and `get_issue` only. Test: an SDK
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
   proposes Briefly lines and an order.

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
