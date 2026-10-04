# MCP ride-along notes: WT352

Notes from an agent riding alongside Jamie while WT352 is written
(2026-10-04), using the read-only WT Builder MCP. Goal: what the interface
needs so an agent can follow the work and jump in usefully, without leaning on
`npm run watch` (which is for catching WT Builder bugs, not for following the
editing).

Format: each note says what the agent was trying to do, what the MCP gave, and
what would have helped. Numbered so they can be referred to.

## Summary: what to build, in order

The MCP already answers "where is the issue?" well. What it lacks is
**time**: when something changed, whether Jamie is done with it, and what
changed as a result. Riding along is mostly that.

1. **A change cursor** (notes 1, 3, 9): `last_event_id` on `get_status` and
   `get_issue`, and `get_status since=<id>` returning only the pills that
   changed state (with "Title is no longer waiting" as a first-class change).
   That one feature replaces the watcher for riding along and removes the
   agent's error-prone counting.
2. **A settle signal** (note 5): `last_edited_at` per item, or coalesced edit
   events. The agent's working heuristic was "Jamie's next edit landed on a
   different item"; make that explicit.
3. **Item-scoped reads** (notes 7, 11): `render_issue item_id=` / `section=`,
   and the review notes that apply to an item on `get_item`.
4. **Review notes that know they were answered** (note 10): non-PROOF notes
   keep `still_applies: true` after Jamie acts on them.
5. **Small clarity fixes** (notes 4, 6): `overdue_by_days`; name single-item
   sections by label in event summaries.

Ideas for WT Builder itself, surfaced through the MCP, warn-don't-block
(notes 2, 12): a "looks unfinished" warning (commentary ending mid-sentence,
a three-word Currently line), and a "page title, not trimmed" hint for
syndicated titles carrying a site suffix or a missing separator.

What worked: `get_status` → `get_issue` → `get_review` gave a complete
overview in three calls; `get_item` was the right size for a per-item
proofread; the review's archive-grounded REPETITION notes were the one thing
the agent could not do on its own (note 8). The split that fell out: the
agent proofreads and suggests craft in chat as Jamie goes; the review earns
its keep on memory of past issues.

## Session setup

- Opened with `get_status` → `get_issue` → `get_review` (empty, no review run).
  That sequence gave a complete, accurate overview in three calls. Good.

## Notes

### 1. No cheap "has anything changed?" call
Riding along means re-checking after Jamie acts. The only signal the agent has
that something happened is `npm run watch` (outside the MCP). Inside the MCP,
`list_events since=<id>` works as a poll, but `get_status` and `get_issue` carry
no event cursor, so the agent cannot tie a snapshot to a point in the log.
**Want:** `last_event_id` (and `updated_at`) on `get_status` / `get_issue`, so
an agent can poll `list_events since=` and only re-read when it moves. Longer
term, a subscription or resource-updated notification would remove polling.

### 2. Word-count pills read truncated text as done
The dots Notable commentary ends mid-sentence ("…Dots feels more") but is
`done` because it clears 20 words. It also synced that way to Pinboard
(event 1021, 2026-10-03). The Currently "Planning" line is "Apple Legacy
Contacts", three words, also `done`. The agent caught both only by reading the
full text in `get_issue`.
**Want (WT Builder, surfaced through the MCP):** a soft "looks unfinished"
signal: commentary ending without terminal punctuation, a Currently line with
no verb or under N words. A warning, not a gate (warn, don't block).

### 3. The watcher echoes the agent's own MCP calls
Every MCP call logs an `[mcp]` line, and `npm run watch` relays the service
log, so each agent read wakes the agent. Filtered with `grep -v '\[mcp\]'`.
Fine for bug-hunting; noisy for riding along. Another reason note 1 matters.

### 4. Overdue is stated but not explained
`get_status` says `overdue: true` with `publication_date: 2026-10-03`. It
took `list_issues include=all` to confirm Saturday publication dates are the
norm (350 → 09-19, 351 → 09-26), so this is just a day late, not a bad date.
**Want:** `overdue_by_days`, or the expected cadence, next to the flag.

### 5. Can't tell "still typing" from "finished"
Editing Planning produced an `edit` event every few seconds (12:12:37,
12:13:06, 12:13:07Z). A `get_item` between them returned a half-sentence
("…I set this up a while ago and gave"), already `done`. The agent has to
guess when to look, and a mid-typing read invites a false "this is cut off".
**Want:** a settle signal: `last_edited_at` per item (so the agent can wait
for, say, 60s of quiet), or coalesced edit events ("Edited body ×3 over 30s").
Note 2's truncation warning would also need to ignore an item that is still
being typed. In practice the best settle signal was Jamie's next edit landing
on a *different* item (Planning → Reading at 12:15:44Z). A "focus" or
"current item" field would make that explicit.

### 6. Event summaries name an item by its first words
Editing the intro logged "Edited body — testing", then "Edited body — Hello
there! 👋 Fall is in the air…" a minute later: the item is named by its
current text, so while it still holds a placeholder the name says nothing, and
the same item changes name from event to event. The anchor (`intro-1`) is
stable, but an agent skimming `list_events` reads "testing" as content.
**Want:** name single-item sections (Intro, Outro, Haiku, Membership, the
Currently labels) by their section or label, as Planning and Reading already
are.

### 7. render_issue is all or nothing
To check one markdown link in the intro (a Wikipedia URL with `(band)` in
it), the agent rendered the whole email edition: ~12k characters, mostly
unchanged Journal and empty Briefly. Riding along, the agent wants to see one
item or section as it prints, many times over.
**Want:** `render_issue` with an optional `section` or `item_id`.

### 7a. The MCP sees the editions, not the editor
Jamie spotted the Briefly arrow after the title in the editor's Website and
Email lenses ("line title →"). `render_issue email` had shown the agent the
right order ("line → title") minutes earlier, because it renders the shared
edition, not the editor's lens. So the agent could not have caught it, and
that is expected: the MCP is for riding along with the issue, and editor UI
bugs are what `npm run watch` and the e2e suite are for. Fixed a25b4e4. Worth
knowing: "the MCP render looks right" says nothing about what Jamie sees in
the editor.

### 8. Proofing as Jamie goes duplicates the review, with no way to share it
Riding along, the agent proofread each Notable item as Jamie left it (six
typos in dots, two in space-and-time, two in Reddit), offered in chat. That
is exactly what the editorial review's PROOF notes do, but `get_review` only
reads the last review, and none has run. The agent's proofs live in the
conversation; the margin never sees them, and a later review will find the
same things again.
**Want (open question for Jamie):** either a way for the agent to see a
fresh per-item review (a read-only "review this item" that does not persist),
or accept that ride-along proofing is chat-only and the formal review stays a
send-time pass.

*Update 13:10Z:* Jamie ran the review. Its 11 PROOF notes were all ones the
agent had already offered in chat, so for a ride-along agent the PROOF pass is
pure duplication. What the review added that the agent did not have: three
REPETITION notes grounded in the archive (the AWS anecdote ran in WT351, the
agents-need-money line in WT346, "sunset OpenClaw" a third time after WT344/345),
and BALANCE/LENGTH against WT351. What the agent caught that the review did
not: syndicated titles that need trimming (EFF, GLM-5.3's missing separator),
a dangling modifier (certificate authority), "fall in place", and pairings
(the two museums, blockchain trust ↔ Buterin). Suggests the split: agent does
running proof and craft in chat; the review earns its keep on archive memory.
An agent with the Librarian MCP could do the repetition check as it goes too.

### 9. Unblocking is only visible by re-reading status
The agent told Jamie Title/dek and Echoes had unblocked after the `cf`
commentary, inferring it from the event stream. Wrong: it had lost count, and
"Plan mode is dead" still had none (Notable 4 of 5). A re-read of `get_status`
caught it, a turn late. Nothing in the event stream says "Title is no longer
waiting", so the agent counts, and counting from events is error-prone. An event, or a `since`
filter on `get_status` that returns only pills that changed, would let the
agent say "Title and Echoes just opened up" at the moment it happens.

### 10. Non-PROOF review notes never learn they were answered
After the review, Jamie linked the "agents will need money" line back to
WT346 and reworked the "sunset OpenClaw" line into a nod to the running
thread: both REPETITION notes were answered. `get_review` still reported
both `still_applies: true`, because only PROOF notes track their words. An
agent relaying open notes would nag about settled ones.
**Want:** REPETITION/BALANCE notes carry the words they are about (or the
item's text hash at review time), so `still_applies` can turn to "changed
since the review: check".

### 11. Fixes can regress, and the review cannot see it
Fixing the review's "ask it it do more" produced "ask it do more": the PROOF
note flipped to `still_applies: false` (its words were gone), yet the line is
still wrong. The agent caught it only by re-reading the item. A PROOF note
could check that its `now` text appears, not just that its `was` text is
gone. Relatedly, `get_item` does not include the review notes for that item,
so the agent read the review and the item separately and matched them by id.

### 12. Syndicated titles are the page's own, and nothing says so
Several titles printed as the linked page's full `<title>`: the EFF headline
plus "| Electronic Frontier Foundation", "GLM-5.3 … capabilities Anthropic"
(the separator lost), "- Derek Thompson", "| The Verge". Jamie trims some
(he cut dots to "Introducing dots"), so a hint that a title still carries a
site suffix, or is over N characters, would help him and the agent equally.

## Resuming

State at the 13:20Z break: all 11 review PROOF notes cleared; open are
"Plan mode is dead" (no commentary), the cf/AWS repetition, eight bare
Briefly links, the expired Verge gift link, Outro, Haiku pick, Membership,
Echoes, Title and dek, and the send-view checks. Re-arm with
`npm run watch -- wt352 --from <last event> | grep -v '\[mcp\]'`.


## Afternoon session (MCP 1.5.0), 2026-10-04

Resumed from cursor 1128. Notes on the 1.4/1.5 features as they get used:

### 13. Resume in three calls worked
`get_status` + `get_issue` + `get_review` rebuilt the whole break list without
reading this doc's "Resuming" paragraph. The REPETITION notes on cf, Buterin
and dots now say `changed_since_review: true` (1.4), so the agent knew to
re-read them instead of relaying stale notes: the cf AWS anecdote is gone, the
WT346 link and the OpenClaw nod are in. Item 10 is answered.

### 14. fixed_as_suggested false found both regressions, but not their words
Both `fixed_as_suggested: false` notes ("ask it it do", "OpenClaw project I
the next") are real leads. But the note only carries `was` and the suggested
`now`; the agent still had to open the item and search for the sentence to see
what the words became ("ask it do more"). **Want:** an `actual` snippet, the
current text around where `was` used to be, on a note that was fixed some
other way.

### 15. Title hints: good on suffixes, blind to a lost separator
The 1.5 title hint caught all twelve "| Site" / "- Site" / "— Site" suffixes,
and the gift-link hint surfaced the expired Verge token on the row. It does not
flag "GLM-5.3 and the spread of advanced cyber capabilities Anthropic", where
the separator was already lost before the hint could see it, nor a prefix like
"Daring Fireball: I'll Wait". Twelve title hints on one issue is also a lot of
noise for an editor who keeps most suffixes on purpose; a per-domain "keep"
memory (or a hint that drops once Jamie has edited the title) would quiet it.

### 16. Deliverability's http finding needs a "no https" escape
bowlingalone.com is flagged as plain http, but its https endpoint serves a
self-signed certificate, so http is the right link. The finding has no way to
say "checked, keep it". (Not yet known: whether it alone holds the pill at
partial once the domain lookups run.)

### 17. `since=` repeats the whole strip every poll
`get_status since=1132` returned two events of changes (dots, unsettled) plus
all 49 pills, 13 hints and both checks again, about 12k tokens to learn "Jamie
is typing in dots". **Want:** a `changes_only` flag (or make `since` imply it)
that returns `changes`, `counts`, `cursor` and any pills/hints that moved, so a
ride-along poll costs a few hundred tokens and the full strip is a deliberate
re-read.

### 18. A swept-in item shows its pill as `from: null`
The three Minnedemo posts arrived as pills moving `null → partial/done`.
That's right, but nothing in `changes.items` lists them (only `other` has the
swept-in events), so "new rows to read" lives in two places.

### 19. Video is the first media type the MCP can't describe
The Beastbox post carries an HLS `<video>`. `render_issue` showed it raw in
both the website and the email lens; only by reading the HTML could the agent
tell the email would show nothing in Gmail. A hint like the gift-link one
("a video: mail clients drop it") would have surfaced it on the row.

### 20. fixed_as_suggested heals itself
After Jamie wrote "ask it to do more", the note flipped from
`fixed_as_suggested: false` to `true` with no new review: it checks that the
suggested words are now present, not just that the old ones are gone. Item 11
is answered. (Item 14's want, an `actual` snippet while it is still false,
stands.) `get_item` now carries `review_notes` too, so the item and its notes
come in one read.

### 21. An edited title quiets its hint (answers part of 15)
Jamie trimmed the EFF title's front ("EFF to Court:") and kept the suffix;
`get_item` now carries `title_edited: true` and the title hint is gone. So the
hint already respects a deliberate keep, as long as Jamie has touched the
title once. GLM shows the same: Jamie restored "| Anthropic" on purpose.

### 22. "3 the site would not answer" without saying which three
`checks.links.unchecked` is a count (3) in `get_status`; the URLs and their
status (openai.com 403, markdown.beauty 429, MIT Press Reader 403) were only
findable by reading the issue doc out of SQLite. `moved` and `gift` list
their URLs; `unchecked` should too, with the note ("turns checkers away").

### 23. A "moved" suggestion that downgrades to http
Plan mode's link (https, 200, on aymannadeem.com) was flagged moved because
the page's canonical is `http://aymannadeem.github.io/…`. Taking the
suggestion would swap a working https link for plain http and trip the
deliverability check. Not an MCP issue as such, but the MCP relays it as a
fix; the link check should not suggest a canonical that drops https.

### 24. Echoes failed on the Librarian's reserved concurrency (fixed a4fe5d6)

Not an MCP finding, but the ride-along caught it: the Echoes wand sent one
/retrieve per Notable anchor, all at once (ten for WT352), into a Lambda
with reserved concurrency 5 shared with Thingy chat and the MCP. Three 429s
in a row. `retrieve()` now keeps two in flight and retries a 429 three
times before failing loud. The MCP saw none of it: get_status showed Echoes
`todo` with no hint that the wand had failed. A failed generation could be
an `other` entry in changes.

### 25. Argument names differ from the words the results use

get_status returns items by `anchor`; get_item wants `item_id` (the same
string). render_issue takes `lens`, while the server instructions and the
results say "edition". Both cost a failed call on first use after a resume.
Accept `anchor` as an alias on get_item, or name the field the same way in
both places.

### 26. Echoes are checkable, and the MCP made it quick

render_issue lens=email section=echoes gave all three echoes with their
cited issues in one call, and the citations were enough to check each
claim against `librarian-thing/data/issues/<n>/`. One date phrase was
loose ("two years earlier" for WT306, January 2025). An echo's cited
issue's publish date in get_item would let an agent check "earlier" and
"in March" claims without leaving the MCP.

## Follow-up work (tagged by Jamie, 2026-10-04)

- **Haiku evaluator.** The Haiku wand offered a 6-8-6 poem and it was
  picked; the proof caught it, and Jamie fixed it before sending. Jamie: "we
  should build an evaluator on that to have it generate and then check -- i
  don't want to have a non-haiku sent". Plan: count syllables on every
  candidate (generate, then check, then regenerate or drop any that is not
  5-7-5) and give the Haiku pill a warning hint for a hand-edited non-5-7-5,
  overridable like every gate.
