# Service contracts

Two services WT Builder calls during assembly. Both are server-side: the archive
retrieval endpoint takes a service credential and is never reachable from browser
code (see `integrations.md`).

Neither service ever writes. Both return text for a human to accept, edit, or
ignore.

## Editorial review

Requested by a button, never automatically (0011). Each review replaces the
last **per pass**: a pass that runs replaces its own kinds wholesale, and a
pass that does not run — skipped, or failed — carries its previous notes
forward untouched. Notes are never merged within a pass or aged.

### Two calls, proofing first

Proofing and judgement are separate calls, in that order.

| | Proof pass | Judgement pass |
| --- | --- | --- |
| Reasoning effort | `low` | `high` |
| Archive context | none | last 8 issues |
| Scope | typos, doubled words, broken possessives, wrong homophones, malformed links | balance and rhythm, repetition, length |
| Re-runnable alone | yes | yes |

The proof pass wants determinism, and the original contract asked for
`temperature: 0`. Claude Opus 5 **rejects `temperature` with a 400** — the
replacement is low reasoning effort plus a tightly scoped prompt, which is what
`src/server/editorial.ts` does.

Two reasons for the split. A typo must never be a matter of taste, and it must
never lose a slot to an opinion — one model call ranking both together will
sometimes drop the typo. And after Jamie fixes things, the cheap deterministic pass
can run again without regenerating all the commentary.

### Request

Send **the rendered website edition, annotated with item ids** — not the raw item
tree. The reviewer should read what a reader reads; the ids are what lets a note
point at something.

```json
{
  "issue": { "number": 350, "publish_date": "2026-09-05" },
  "edition": "website",
  "rendered": "…markdown, each block preceded by <!--item:briefly-forge-->…",
  "recent_issues": [
    { "number": 349, "rendered": "…" }
  ]
}
```

`recent_issues` is present on the judgement call only, and holds **8** issues.
Repetition that matters is recent — the question is "you said this last month", not
"you said this in 2019". Eight issues is roughly 240KB of text: one ordinary call,
no retrieval infrastructure. Deep archive is Echoes' job, not review's.

### Response

```json
{
  "summary": "The Technology Advisory Council post is the strongest thing here…",
  "notes": [
    {
      "kind": "PROOF",
      "item_id": "journal-concert",
      "text": "Doubled word.",
      "was": "the The New Standards",
      "now": "The New Standards"
    },
    {
      "kind": "REPETITION",
      "item_id": "briefly-shortcuts",
      "text": "You made nearly this point in 346.",
      "archive_ref": 346
    },
    {
      "kind": "LENGTH",
      "item_id": null,
      "text": "267 words. Your last four ran nearer 900."
    }
  ]
}
```

`kind` is one of `PROOF`, `BALANCE`, `REPETITION`, `LENGTH`. A null `item_id`
anchors the note to the issue as a whole and it renders in the summary bar rather
than the margin.

### Anchoring: substrings, never offsets

A note anchors to an item id plus, for `PROOF`, **the exact substring** it is about.
No character offsets: an offset rots on the next keystroke, whereas a substring is
self-validating — if it is no longer present, the note is stale and drops silently,
which is exactly right when every review replaces the last. It also gives the
one-click `Fix` affordance for free, since `was` and `now` are already the edit.

Where a substring occurs more than once in the item, add `"nth": 2`. Default is the
first occurrence.

### Failure

A review where *no requested pass* succeeds fails whole, and **leaves the
previous notes untouched**. Clearing the margin on failure would destroy the
thing Jamie was working from for no reason. Where one requested pass succeeds
and the other fails, the failed pass's previous notes are carried forward —
`passes` records which pass actually ran, so a held-over note is legible.

## Drafting

Generates candidate text for one item. Never writes it.

### Request

```json
{
  "item_id": "membership-1",
  "type": "membership",
  "issue": { "number": 350 },
  "context": "optional extra context from the client",
  "current": "whatever is in the item now, possibly empty"
}
```

For Membership, the service fetches the campaign facts itself from the
website repo's `apps/site/_data/support.json` — the same file `/members/`
renders from, so the draft cannot disagree with what a reader sees: the
year's nonprofit, the price, the past years' totals, and the frame (free
for everyone; 100% of fees to the nonprofit; membership is a giving
program, never a paywall). A failed fetch degrades to the evergreen frame —
the prompt forbids inventing figures.

### Response

```json
{ "candidates": ["…", "…", "…"] }
```

**Three candidates** for Membership and Haiku; **two** for link commentary.
Three gives real contrast where the choice is a voice; two reads as a coin flip.
Link commentary is one sentence, where the want is a nudge rather than a menu.

**The haiku wand counts before it offers** (2026-10-04). The prompt asks for
strict 5-7-5, and every candidate is counted (`src/shared/syllables.ts`, a
guess from spelling: silent e, -ed, -es, vowel groups, y, -le, numbers said
aloud, an exceptions list). When some miss and fewer than three pass, the
model is asked once more (`HAIKU_RETRIES`), told which drafts missed and
what they counted. Only drafts that count 5-7-5 are offered; if none do,
the draft fails with one sentence ("None of the haiku drafts came out
5-7-5, even after asking again (they counted 5-6-5). Draft again, or write
one."), logged as a `draft` event like any failed draft. Jamie can still
write one by hand: the row hint and the proof pass say what it counted,
and neither blocks.

The link wand reads the page itself (`src/server/integrations/page.ts`),
on the service's own network, so the read is guarded (review 2026-09-27,
§5): redirects are followed by hand, at most five, and every hop whose host
is or resolves to a loopback, private, link-local or CGNAT (tailnet)
address is refused, in every spelling (an IPv4-mapped `[::ffff:7f00:1]` is
judged as 127.0.0.1, and IPv6 outside global unicast is refused whole); no more than 2 MB is read; and the text goes into the
prompt fenced between `<page>` markers as untrusted data, never
instructions. A page that cannot be read is said to be unread, and the
draft goes on without it.

**The link wand says when a link was in an earlier issue** (2026-09-30):
the item draft route looks the link up in the local records
(`src/server/linked-before.ts`) and the response carries
`linked_before: [{ number, publication_date }]`, newest first, only when
there is one; the picker shows "Linked before in WT274 (2024-01-27)" and
the prompt gets the same fact, to mention only where it helps. A link
matches when it is the same address without its scheme, `www.`,
fragment, trailing slash or tracking parameters (`utm_*`, `fbclid`,
`gclid`, `mc_cid` and the like). Only published issues dated before this
one count, and only what they printed: a held-out item, and Thingy's own
items, are not links Jamie chose. The Librarian is not asked: `/retrieve`
has no link lookup (contract 4.12), and the local records hold every issue
the moment it is sent.

**Membership candidates are pairs** (Jamie, 2026-09-05): each carries `cta`
(the invitation) and `thanks` (what an existing Supporting Member sees
instead, in the email's premium branch). One pick fills both — `body` and
`member_thanks` — so the two branches always agree in register. An empty
`member_thanks` falls back to the historical form: the invitation with the
static thanks line appended.

```json
{ "candidates": [ { "cta": "…", "thanks": "…" } ] }
```

**The bylined prompts wear one wardrobe:** Echoes and Membership prepend
the vendored Thingy print persona (`prompts/thingy-persona.md`, synced
verbatim from the Librarian's canonical charter via `npm run
persona:sync`; tests hold the sha and, when the sibling checkout is
present, the upstream match). The reviewer and every other wand stay
generic services — the byline is the boundary.

**Echoes returns units, not candidates** (Jamie, 2026-09-04): up to five
self-contained echoes, best first, each one or two sentences tracing one
thread with its own citations. Jamie selects any subset and the section
composes from it in offered order (`src/shared/echoes.ts`) — the section's
length follows the quality of what the archive actually offered. Each echo
carries its own references, so citations stay reviewable per unit; an issue
reference carries its number, a blog or podcast reference a title:

```json
{
  "echoes": [
    {
      "text": "The boat went in this week, as it has every May since [WT221](…).",
      "archive_references": [ { "kind": "issue", "issue": 221, "url": "…", "note": "…" } ]
    },
    {
      "text": "…",
      "archive_references": [ { "kind": "blog", "title": "thingelstad.com Data Center", "url": "…", "note": "…" } ]
    }
  ]
}
```

The ask-Thingy door rides at most one echo and is always offered last, so a
selected door closes the section.

### Echoes retrieval

Built 2026-08-28; restructured 2026-09-03 around the settled intent — connect
what is in THIS issue to the archive, primarily the Weekly Thing's own issues,
with blog and podcast pulls welcome. Echoes drafting calls the Librarian's
`/retrieve` (service-secret auth, `LIBRARIAN_RETRIEVE_URL` +
`LIBRARIAN_RETRIEVE_SECRET`, contract 4.12.0) and **fails loud** when
retrieval is unavailable or returns nothing usable — the quality bar is real
semantic retrieval, never a silently degraded guess.

- **Failing loud, in a sentence** (2026-10-04). At most two asks are in
  flight and a 429 is waited out three times (a4fe5d6); each wait is heard
  by the route, and `GET /api/issues/:id/drafting` answers
  `{drafting: {anchor, says}}` ("The archive is busy; trying again…") while
  it lasts, `{drafting: null}` otherwise. Every failure is an
  `ArchiveError`: `says` (a sentence), `again` (`now`, `later`, or null when
  something must be fixed first) and `detail` (the raw answer, logged by the
  route as `[draft] …`, never shown). Echoes words it as "… Try Echoes again
  in a minute." The route logs any failed draft as a `draft` event anchored
  to the item or section.
- **The whole archive, since 2026-09-29.** Until then Echoes sent no scope and
  the Librarian defaulted to Weekly Thing issues only, so the blog and the
  podcast the prompt welcomed never arrived (Jamie: "it is a huge miss if
  Echoes isn't getting the blog and podcast"). Each anchor now asks with
  `scope: 'all'`, `filters: { excludeSourceKinds: ['site_page', 'faq'],
  excludeIssues: [n, n-1, n-2] }` and `caller: 'wt-builder'`
  (`echoesRetrieval`). The exclusion runs on the server, so the excluded
  issues no longer take up the k. Every passage carries a `label` (WT312,
  AT1, a post's title), an absolute `url` and a `source_kind`, and the
  prompt heads each passage with its label; a blog post the Journal carried
  lists those issues (`also_in_issues`). Rolling back is the one `scope`
  field.

- **One retrieval per anchor, not one blended query.** The issue's strongest
  present items are the anchors: each promoted Journal post and each
  Notable/Featured link stands alone; the intro, Currently, photo, and
  ordinary Journal moments pool into one "week itself" anchor — where the
  rituals and seasons live. At most 5 anchors (`echoesAnchors`). One
  1200-char blend of the boat, the railroads, and the semester abroad
  averages into mush; per-anchor queries find the sharp echoes.
- **A recency floor.** The current issue and its two predecessors are
  excluded (on the server, and again in `poolEchoPassages`), and so is a
  blog post or episode those issues carried or published in their three
  weeks (`ECHOES_OWN_DAYS`): the Journal republishes the week's posts, so
  this week's post is repetition, not an echo. Passages older than six
  months rank ahead of younger ones, and undated passages come last. Last
  week is repetition — and the review's judgement pass already owns the
  last 8 issues.
- **This week in past years, as a hint** (2026-09-30). Rituals rhyme
  annually and semantic retrieval has no calendar, so one more anchor, "This
  week in past years", asks with the issue's own words (its dek and printed
  text, never Thingy's: `echoesCalendarAnchor`) and the same retrieval plus
  `filters.calendar: { date: <the issue's date>, window_days: 7 }`
  (contract 4.12: sources within a week of this month-day in an earlier
  year; `echoesCalendarRetrieval`). Jamie: "Calendar is less important for
  echoes than topics and themes", so it is pooled after every topical
  anchor (a passage both found stays with its topic), keeps at most two
  passages (`ECHOES_CALENDAR_MAX`), is headed in the prompt as a light hint,
  and the prompt says topical and thematic connections come first. It
  cannot carry a draft alone: with no topical passage Echoes still fails
  loud. It replaced the deterministic one-year-ago issue excerpt
  (`pickSeasonalIssue`, retired with the `seasonal` draft field).
- **Thingy's words are not Jamie's archive** (review 2026-09-27, §5). From
  WT350 on, the archive leg commits the website render with Thingy's frames
  inside (Echoes, Membership). Since 2026-09-29 librarian-thing strips every
  `<div class="from-thingy">` block before it builds a chunk, a count or a
  link (`strip_thingy_blocks`; Jamie: "Thingy's echoes section should be
  excluded from the corpus entirely"), so no `/retrieve` passage can be
  Thingy's. The frame is the contract: `tests/echoes.test.ts` pins its
  shape here, and librarian-thing's corpus tests pin the strip. The text
  filter that stood in for it (`withoutThingy`, 2026-09-28) is gone. The
  calendar anchor's query leaves Thingy's items out too (`issueExcerpt`),
  because it reads this issue's record, not the corpus.
- **Shape varies by issue** (settled with Jamie 2026-09-03): one echo traced
  well, or two-to-three short callbacks when the resonance genuinely
  spreads. 1–4 citations, never padded toward a count. Whole archive
  citable, issues preferred.
- **The ask-Thingy door is occasional by construction:** at most one of the
  three candidates may close with the invitation to ask Thingy live; picking
  it — or not — is the editorial act, which is what "occasional" means in a
  system where every word ships because Jamie chose it.

The model reports every source it actually cited, and accepting a candidate
stores them on the item as `archive_references`.

**Every offered echo is checked against what was retrieved**
(`echoGrounding`, review 2026-09-27 §5), on the section wand and the
per-echo redraft alike. Each WT number in the text, in an archive URL or in
the references must be an issue a passage came from (or an issue that also
carried a retrieved blog post), the calendar anchor's passages included;
each AT number must
be an episode a passage came from, and an `[ATn]` label must link to that
episode's page; every other cited URL must be a passage's URL (compared
without scheme, `www.`, fragment or trailing slash). A `[WTn]` label that links to a
different `/archive/m/`, and a link in the text missing from the echo's own
references, are flagged too. The result rides on the echo as
`grounding: { flags: [] }` and the picker shows each flag in the warning
colour. Nothing is dropped and nothing is stored: the pick stays Jamie's.

## Both

- Latency is visible, not hidden: the review button reads `Reading…`, the draft
  affordance shows a spinner. Budget 5–15s.
- Review is button-only, so no debounce and no rate limiting is needed.
- Both are advisory. Neither gates sending, and neither writes a word into the
  issue.

## Build status

**Both are wired and have run against Claude.** Review is in
`src/server/editorial.ts` and surfaces as the summary bar plus margin notes;
drafting surfaces as the wand in the editorial margin, which offers candidates
and writes nothing until Jamie picks one.

Review opens an existing read rather than re-running it — re-reading on every
open spends a model call to show Jamie something he has already seen. `Read
again` is the explicit re-run.

## Offered, not called: the MCP interface

The other direction: an agent calls WT Builder. `/mcp` (`src/server/mcp.ts`)
is a read-only MCP server for an agent working beside Jamie on an issue —
Claude Code or Codex on otto, or any MCP client on the tailnet.

- **Transport.** Streamable HTTP, stateless (no `Mcp-Session-Id`), JSON
  responses: each tool answers in one response. `POST /mcp` only (anything
  else is 405), one JSON-RPC message per request: a batch is refused (400,
  -32600), because the calls in one run back to back on the event loop the
  editor shares. A body over 4 MiB is 413.
- **Reading.** Each tool reads the GET route the page reads (`readRoute`),
  so an agent and the editor never disagree. The issue argument is `wt353`,
  `353`, or the id; left out, it is the newest draft.
- **Answers.** Structured content with an `outputSchema`, and the same JSON
  as text. A refusal (no such issue, no such item) is `isError` with a
  sentence that says what to call instead. A list that is cut says so and
  how to get the rest (`shown`, `matching`, `note`), never silently.
- **`get_status`** is the strip and the Send view in one answer: every pill
  in reading order with `state` (`done`, `partial`, `todo`, `waiting`),
  `section`, and for a waiting pill `waiting_on` (`{section, name, done,
  total}` per unfinished input) and a `waiting` sentence; the counts;
  `workable_now`; the link check (dead, moved, and `gift` links with
  their expiry and a `warning` sentence) and the email checks; each send leg with its verification; and the script review,
  with `current` false when the script has changed since.
- **Riding along (1.4.0).** `get_status`, `get_issue` and `get_item` return
  `cursor`, the issue's newest event id. `get_status since=<cursor>` adds
  `changes`: `items` touched after it (each with `kinds`, `last_edited_at`,
  and `settled`), `other` events with no item, `pills` whose state moved
  (`{title, anchor, from, to}`, `null` on the side where a pill did not
  exist), and `focus`, the item of Jamie's newest edit with `since`,
  `quiet_seconds` and `settled` (60 s quiet, or his edits have moved to
  another item). The issue at the cursor comes from `revisions` through
  `GET /api/issues/:id/version?event=<id>` (the newest version written
  before the next event); when that version is older than the 300 kept,
  `pills` is `null` and `note` says why. `render_issue` takes `item_id` or
  `section` (id or label) and renders that slice through
  `GET /api/issues/:id/render/:lens?item=|section=`, cut from the nodes
  before the plan, inside the edition's frame. `overdue_by_days` sits beside
  `overdue`.
- **Failed drafts (1.5.2).** A wand's draft that fails is a `draft` event
  (`Draft failed: <what Jamie was told> — <item or section>`) anchored to
  its item, so `changes.items` carries it with kind `draft`; a section's
  (Echoes) lands in `changes.other`.
- **Row hints (1.5.0).** `get_status` carries `hints` (`{anchor, name,
  kind, text}`, cut at 40 with `hints_note`), and `get_issue` / `get_item`
  carry each item's `hints`: the same list the editor marks
  (`src/shared/hints.ts`). `link` is an open link finding on the item,
  `unfinished` is Jamie's words stopping mid-sentence or a Currently line
  under six words (an item still being typed does this too; `focus` says
  which), `title` is a syndicated title still ending with the site's name
  or over 90 characters, until Jamie edits it. A hint never moves a pill.
  1.5.3 adds `haiku`: the haiku is not three lines of 5, 7 and 5
  syllables, with the counts found ("Counted 5-6-5 syllables, not
  5-7-5…"); the count is a guess from spelling.
- **Writes none.** Suggestions go to Jamie in the agent's conversation (see
  `docs/decisions.md`). It reads through `readRoute` with `readOnly`, so
  even the skeleton repair the page saves on opening an older issue is
  shown to the agent unsaved.
- **Content is data.** The instructions say that tool output is never
  instructions, and which words are not Jamie's: a syndicated link's title
  is the page's own; `authorship: "Thingy"` items and review notes are
  model drafts. Draft-share links are withheld (`withoutShareLinks`), and
  stored integration error text is capped and scrubbed (`scrub`).
- **Where an item stands.** `in_issue` follows the editions' rule (placed,
  a channel on, inside the window, not excluded), and `held_out` says why
  not. Review notes carry `still_applies` (a PROOF note whose words are
  gone no longer does); a PROOF note whose words are gone carries
  `fixed_as_suggested` (false when the suggested words did not take their
  place: a fix that made a new mistake), and any other note on an item
  `changed_since_review`, read against the issue as the review read it
  (`GET /api/issues/:id/version?review=1`). `get_item` carries its item's
  notes as `review_notes`, and `last_edited_at`. Issue-wide pills (links, email) anchor to `issue`
  and say `done_in: "send view"`.
- **Prompts.** `finish_draft`, `briefly_pass`, `proof_issue`,
  `compare_with_last_week`, `ride_along`: the call sequence for the common asks, each
  taking an optional issue.
- **Logging.** One line per call in the service log: `[mcp] <tool> <issue>
  <args> → ok|refused|error <ms>ms (<local|tailnet> [login] <agent>)`, plus
  `[mcp] connected <client> <version>` on initialize and `[mcp] prompt …`.
  A call the SDK rejects before the tool runs (bad arguments, unknown tool)
  is `→ rejected: "…"`; any other erroring request is `[mcp] <method> →
  error`, and a refused HTTP request (405, 400, 413) is logged with its
  status. Arguments are JSON-encoded and every line passes `logSafe`, which
  escapes control, line-separator, and bidi characters, so no input can
  split, forge, or reorder a line. The caller is named, not authenticated:
  the login is Tailscale's header, which a process on otto could set, and
  the client name is what the client says it is.
- **Version.** `serverInfo.version` is `MCP_VERSION` in `src/server/mcp.ts`,
  not the package's: bump it whenever a tool, its arguments, or its answer
  changes.
