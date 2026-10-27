# Decisions

Only the decisions that are **invisible in the code** live here: absences, and
boundaries that span repositories. Everything else belongs in a comment next to
the thing it constrains, which is where it will actually be read.

There used to be a `docs/decisions/` directory of numbered records. It was
deleted. Two thirds of the records it cited did not exist in this repo, its
numbers collided with a second scheme in the design bundle, and citations like
`(0011)` resolved to nothing — including three in our own source comments. A
register that looks authoritative and is two thirds empty is worse than none.
The reasoning those records carried is not lost: it is what makes
`docs/interface-spec.md` 937 lines, and the load-bearing parts are quoted in
code where they apply.

**Do not recreate the numbered directory.** If a decision is visible in the
code, comment the code. If it is not, add a section here.

---

## Publishing and the archive are different acts

Publishing means delivering an issue to a reader. WT Builder owns every
publishing leg and sends directly to each destination: the website edition as a
committed handoff to `weekly.thingelstad.com`, the email edition as a Buttondown
draft, the audio file to `files.thingelstad.com`.

**The archive is not a publishing destination.** WT Builder tells it an issue
is out for exactly one reason — so Thingy can retrieve and cite the issue — and
that send happens *after* publication and must never block it. An issue can sit
published with an unsent archive leg. That is a Thingy staleness problem, not a
publishing problem.

The archive receives nothing from WT Builder but that word. It pulls the issue
from weekly.thingelstad.com, the source of authority for issues (Jamie,
2026-10-01), the way it pulls the blog from micro.blog. No audio of any kind:
audio lives on the CDN and the website publishes the reference.

*Invisible in code because it is a boundary between repositories. Nothing in
`src/` can show you that the archive is downstream of publishing rather than part
of it.*

## The archive pulls; the archive leg only knocks

Until 2026-10-22 the archive leg committed the issue's text into
`librarian-thing/data/issues/{N}/`, and that commit started the corpus build.
Then the Librarian's archive moved out of git into its library, one SQLite
file in S3 that pulls every source (librarian-thing
`PLAN-2026-10-22-blog-steward.md` in its docs, approved by Jamie). weekly's
`apps/site/archive/{N}.md` already held everything the commit carried, so the
library pulls that page, and a second copy written from here could only
disagree with it.

The leg stays, as a `repository_dispatch` of `issue-sent` with the issue's
number to `WT_BUILDER_ARCHIVE_REPO`. Without it a send reaches Thingy at the
next morning's round, and the corpus holds still from Friday until a send
names its issue, so a Saturday send would wait until Sunday. A dispatch rather
than a call into the library: GitHub runs the round with the archive's own
credentials, WT Builder needs no access to the library's bucket, and the token
it already holds (Contents: write on the archive) is enough. The receipt is
the event, and the evidence is downstream: Verify asks the Librarian for the
issue's own passages.

The leg refuses to go before the website leg has sent (overridable, as every
gate is): the round would find no page. A repair is a fix at the source and a
re-send, website first, then the archive; for WT1 to WT349, which WT Builder
never authored, an edit to the page on weekly (`npm run rerender:archive`
re-rendered those pages from the archive's copy and retired with it).

*The mechanism is `dispatch` in `src/server/integrations/github.ts`. Why the
leg sends no text is not in the code.*

## No undo, no locking, no conflict model

One editor, one live issue. Both omissions are the kind a later reader assumes is
an oversight, so both are written down.

**No conflict model.** No locking, no revision vectors, no merge. Nobody else is
editing. The durable path is the write-back: editing a Pinboard or Micro.blog
field writes through promptly, last-writer-wins, and the interface shows
saving / synced / failed per item. A failed write never discards the local edit.
That is the whole durability story, and it is visible per item rather than hidden
behind a save button.

**No undo.** Deliberate. What makes it tolerable is that the destructive acts
have another route back: removing a section holds its syndicated items out under
**Held out** with a `Put back`; missing standard sections are offered back as
chips; clearing an item's channels hides it and rechecking one returns it.

**Text edits are the exception, and it is a known hole.** Typing over a paragraph
and blurring loses what was there. `source_snapshot` covers imported material —
the "as imported" line in the Inspector (the Source lens's, until 2026-10-11) — but there is nothing for direct
content. Any future undo should start there; the structural acts are already
reversible.

*Do not add locking, autosave indicators, or revision history without revisiting
this.*

**Revisited 2026-09-26 — put to bed.** Jamie asked for a newsroom's "put to
bed": a published issue he marks finished so nothing in it changes by accident.
It is not a conflict lock — there is still one editor and no merge — it is an
editorial state. It is **manual**, the last step on the Send view, never
automatic: WT350 needed fixes and re-sends after publishing. While
`issue.put_to_bed_at` is set the server refuses every change to the issue (one
guard at the door, `guardBed`, so a later route cannot forget it) with 423;
reads, verification, and waking pass. The index marks it PUT TO BED and the
issue opens with a banner and `Wake it`. Editing stays open after publishing
because fixes and re-sends follow it, and put to bed is the only freeze (Jamie,
2026-09-28).

**Revisited 2026-10-06 — shares sit outside put to bed.** Sharing an issue is
what happens after it is put to bed, this week or a year later ("after an
issue is put to bed, then instead of there being a publish button, there's now
a share button", Jamie). So shares are their own table, not part of the issue
document, and `guardBed` lets `/shares` through as it does `/verify/`: the
freeze still holds every word of the issue. A share that went out is the
record and is never edited, re-posted or deleted; sharing again is a new
share. There is no dropped state, no back-dating, and no link in a LinkedIn
comment (Jamie: "gross"); the link is in the words (`docs/share-plan.md`).

**Revisited 2026-09-28 — the source is the second editor.** "Nobody else is
editing" held for this service, but Pinboard and Micro.blog are Jamie's CMS, and
he edits there too. Since 2026-08-30 write-back has been compare-and-set, not
last-writer-wins. It reads the record first and writes nothing when the record no
longer matches the merge base (`source_snapshot`), marking the item `conflict`,
or `gone` when the record was deleted. A re-scan that finds both sides edited
does the same. Since 2026-09-28 a conflict has a way out. **Keep mine** re-reads
the source, makes it the base and writes the local copy over it. **Take theirs**
adopts the source's fields as the copy and the base. Both change nothing when
the source cannot be read or the item moved during the read. That is the conflict
model: compare-and-set, then Jamie chooses. Still no locking, no revision
vectors, no merge, and a local edit is never discarded without that choice.

**Revisited 2026-09-28 — text edits are no longer a hole, and there is still no
undo.** "Typing over a paragraph and blurring loses what was there" predates the
`revisions` table. Since 2026-09-20 every save keeps the document it replaces
(the last 300 per issue, `src/server/db.ts`), direct content included, so the
paragraph that was typed over is kept: `npm run revisions -- <issue> [item-id]`
prints every version an item has had. It is a recovery tool, not undo: it runs
outside the editor and only prints the words, and putting them back is an
ordinary edit.

**Revisited 2026-09-28 — one exception.** "Only prints the words" holds for an
issue that exists. For a deleted issue, `npm run revisions -- <issue> --restore`
recreates its row from the newest revision (`DELETE /api/issues/:id` keeps the
document among its revisions). It will not restore over a live issue.

**Revisited 2026-10-04 — Apply's Undo.** Jamie asked for an Apply button on
the review's PROOF notes ("I have to manually find each one, edit it by hand").
Apply makes one model-suggested fix that Jamie chose, in place
(`POST /api/issues/:id/proof`), and for a few seconds offers **Undo**. That Undo
is a reverse Apply of that one fix — `now` back to `was`, at the spot the Apply
answered with, under the same checks and refusals — not a general undo. There
is no history stack, nothing else is undoable, and Apply all offers no Undo at
all: each fix it made can still be reversed by hand.

## Pre-Builder issues import as a record, not as items

Issues 349 and back were built by the Shortcuts workflow and exist as published
Markdown. **Do not parse them into items.** A pre-Builder issue imports as the
issue record, one Markdown block holding the published text, the archive URL, and
read-only.

The value of having them here is continuity of numbering and being able to open
one and see what was sent. Neither needs items. Parsing nine years of generated
Markdown back into structured items is a lossy heuristic producing items nobody
will edit, after which every renderer change has to consider whether it applies
to reconstructed history.

*There is no Markdown parser in this codebase, and none should be added for this.
An absence cannot be seen by reading the code.*

## There is no candidate tray

Everything bookmarked or posted inside the window is on the page from the moment
the issue exists. **Inclusion is automatic; exclusion is the editorial act.**

An earlier target workflow described a source tray of unplaced items, and that
document has been retired. The tray is not a missing feature — it is a rejected
one. It makes the editor's first job triage rather than writing, and it puts the
issue in two places at once.

*A tray that was never built looks identical to a tray nobody got round to.*

## Picking is the review

A Thingy draft used to need a second act — "Mark reviewed" in the inspector —
before it counted as done, and any edit to its words dropped it back to draft.
Jamie, on the first real Membership pick (2026-09-20): "I see the three options
and put it in." Choosing a candidate, or writing the words, is the review; the
strip counts the item done when it has words. The byline still says Thingy
wrote it, which is the part that matters.

*The gate that nobody can find is a gate nobody passes.*

## Echoes are items, like Currently

WT350 (2026-09-20) was the first issue with real Echoes, and they went out as
one item whose body the picker had glued together from the echoes Jamie
ticked. Jamie, reading it: an echo is a unit with a fixed shape — thread,
citations, question — the way a Currently line is label and body, and the
glued body meant no echo could be reordered, removed, or redrafted alone,
and the citations pooled instead of belonging to the echo they came from.

So an `echo` is an item and Echoes is a multi-item section. What is
invisible in the code is what was deliberately *not* done:

- **No migration.** WT350 and earlier keep their single `echoes` body and the
  renderers accept both shapes forever. A published issue is a contract with
  its readers and the archive; rewriting it to a nicer model would change
  bytes that already shipped.
- **No composed body anywhere.** The Ask-Thingy door is built at render from
  `ask` and the issue number, never written into `body`. Storing it would
  make the question uneditable without breaking the link, which is exactly
  the failure the glued body had.
- **The section wand appends; it never replaces.** Jamie may run it more than
  once, and the second run is told what the section holds so it offers other
  threads. Replacing would throw away picks he already made.
- **Picking is the review** here as everywhere: an echo arrives reviewed
  because Jamie ticked it. There is no per-echo gate.

*A section that is one string is one string no matter how many things it
says.*

## Echoes reads the whole archive, which holds no Thingy (2026-09-29)

Jamie, after the Librarian MCP review: "it is a huge miss if Echoes isn't
getting the blog and podcast", and "Thingy's echoes section should be
excluded from the corpus entirely". Membership too.

Echoes sent no scope, so the Librarian answered from issues alone while the
prompt promised the blog and the podcast. It now asks for the whole archive
and the server drops the site pages and the last three issues. The Thingy
filter moved from here to the corpus build: librarian-thing strips every
`.from-thingy` block before anything is indexed, so the frame this repo
renders is now a contract two repos pin, and the text match that stood in
for it is gone.

What was deliberately *not* done: Echoes did not become an MCP client.
It is a fixed pipeline, a few anchors and one prompt, with no tool loop to
drive, so `/retrieve` stays, versioned (4.11.0). "Primarily the Weekly
Thing" and four passages per anchor also stay; rolling the scope back is one
field.

## Past years are a hint; "linked before" reads the local records (2026-09-30)

Jamie, on the past-years lens: "Yes, and that is just a hint. Calendar is
less important for echoes than topics and themes." So the one-year-ago
issue that rode along whole is gone, and what replaced it is deliberately
small: two passages at most, pooled last, and a prompt that puts topics and
themes first. Nothing brings back a guaranteed year-ago echo.

The link wand's "Linked before in WTn" deliberately does not ask the
archive. `/retrieve` has no link lookup, and librarian-thing's `data/` on this
Mac is an export of its library, as current as the last time someone exported
it. This service's own records hold every issue the moment it is sent, and all
349 pre-Builder issues were imported from the archive's text. A later repair
to a page on weekly is not seen here; for whether a link was carried, that is
an acceptable gap. If it ever is not, the answer is a
service-auth link lookup in the Librarian (the MCP's `find_links` already
takes a `url` over the corpus link graph; `/retrieve` would need the same),
not a runtime read of a sibling checkout.

## Generation offers; it never writes

The wand returns candidates and nothing changes until Jamie picks one. Editorial
review writes notes in the margin and never touches prose. Both are advisory and
neither gates sending.

This is why every word in the issue is Jamie's: not because the model is
prevented from writing, but because the accept step is his.

*Visible in `editorial.ts` as a return type. Invisible as a principle — which is
the part that stops the next convenience feature from quietly writing.*

## Another Thing is a second product here, not a feature of the issue (2026-10-11)

This section used to say the podcast builder would be a sibling application,
`at-builder`, scoped 2026-08-28. It was built that way, never sent an
episode, and was folded in here on 2026-10-11 (Jamie: "an outliner, a view
that allows me to show that outline on screen for recording with timers and
such, and publishing workflow"). The two apps were mirroring the same shell
(event log, revisions, time spent, send guards, the GitHub commit client,
deploy) while sharing nothing on screen, so every fix to one was a port to
the other.

What changed is where the shell lives, not the old reasoning. The newsletter
and the podcast are **two products in one service**, and neither is a mode of
the other:

- **Separate documents.** An episode is its own row in its own tables
  (`episodes`, `episode_revisions`, migration 7), never an issue and never an
  item. `npm run revisions -- --restore` cannot put an episode into `issues`.
  Nothing under `src/server/podcast/` reads or writes an issue, and nothing
  in the issue code reads an episode.
- **Separate screens.** `/another`, `/at<N>` and `/at<N>/record` hold their
  own state (`src/client/podcast/`); they share the header, the buttons and
  the log sheet, and nothing else. The recording card keeps AT Builder's dark
  palette and block contract, scoped under `.card-surface`.
- **Shared shell.** One event log (the kinds `episode`, `recording` and
  `audio` were added; an episode's events carry `at<N>`), one way of
  counting the time spent, one send-claim rule, one GitHub client (a
  repository can name its own token: `ANOTHER_GITHUB_PAT_TOKEN`), one deploy.
- **Left behind on purpose:** AT Builder's wands, prospecting, hooks and
  chapter editing. The outline is Jamie's; nothing generates it. The only
  model call is transcription of the mastered audio, which drafts text Jamie
  then edits.

The send puts `uploads/YYYY/another-thing-N.mp3` into the another-site
stack's audio bucket, reads it back, and then commits
`content/episodes/NNN-slug.md` and its transcript into
`another.thingelstad.com`, as one commit. The mp3 is not in git (2026-10-26,
another.thingelstad.com PRs #12 and #13; Jamie: "Not great for the audio
files to be in git -- we can and should change that to be more AWS
proper"): CloudFront serves the bucket at the same URLs, and the page
carries `audioBytes` and `audioSeconds` for the feed. Like the site's own
`npm run audio:put`, the send leaves the same bytes alone, refuses different
audio at the key unless an earlier send of this episode put it there (a new
master keeps its URL; the bucket keeps old versions a year), and never
deletes. Its URL scheme (`/podcast.xml`, `/YYYY/MM/DD/slug.html` by the
date's UTC day, `/uploads/YYYY/`) is held by every subscriber's client and
must not be redesigned by the tool. **A blocking validation problem is a
hard stop** (a value Another's parser would misread, no offset on the date,
no audio): unlike every other gate here it cannot be overridden, because what
it protects is a feed entry subscribers cannot un-receive. Warnings (no
transcript, no show notes) are overridable with `?force=1` and a confirm, as
everywhere else. A number already used in the repository refuses the send
too: episode 1 was published by hand.

The corpus side still needs nothing: the Librarian ingests Another's episodes
from that repository on its own schedule.

*Invisible in code because it is a boundary: what each product may touch.*

## There are no bumpers, and no music (2026-09-21)

The audio edition is speech from its first second to its last. The intro and
outro bumpers that wrapped it — two pre-rendered mp3s inherited from the
Shortcuts era — are gone: everything they said is now script, so it is spoken
in the issue's own voice, names the issue, and cannot repeat what the script
says (WT350's opener said "You're listening to…" twice, once per source). No
section sting either: the pauses, the counts, and the closers are the
transitions, and a sound effect would be the first thing in the edition that
is not a word from the newsletter. Revisit only if the placed pauses prove
insufficient by ear.

## The audio transcript is a surface artifact, not archive

The WebVTT transcript and the chapters JSON are published beside the mp3 on the
CDN and referenced from the website's issue record. They are not sent to
`librarian-thing`: the archive already holds the canonical text every cue was
rendered from, and the timings describe one rendering of it. (The archive's
WT349 transcript directory is a Studio-era artifact and is not a precedent.)

## The spoken pieces are stored, not cached (2026-09-22)

Synthesis is the one paid step in the audio edition, and until today its
output lived only in `data/tts-cache/` on one Mac — git-ignored, and outside
the critical-state backup despite a comment saying otherwise. Every piece is
now written to the CDN bucket (`weekly-thing/tts/<key>.mp3`) before it is
written locally, and read back from there on a local miss. The local
directory is a cache of the store and can be emptied at any time.

Why a store and not a manifest: the key already says everything about a
piece — model, voice, speed, and the exact text — so the pieces index
themselves. A per-block manifest, an assets table in SQLite, and S3 copies of
either were considered and rejected as second sources of truth beside the
website's frontmatter, which already names every published asset and is what
the site actually serves from. "What do we have for WT-N" is answered by
reading `archive/N.md` and HEAD-ing three URLs.

The consequence Jamie asked for: a change to pauses, mastering, chapters, or
art re-assembles for free, on any machine. Only a changed voice, model, speed,
or word is new speech. `TTS_SPEED` is settled at 1.0 for that reason — every
podcast player gives the listener a speed control.

The back catalogue (issues 1–349) is rendered from the frozen scripts in
`backfill/` through the same assembler; see `backfill/README.md`.

## The cutoff is always midnight (settled 2026-08-28)

Jamie: "The content cutoff is always midnight. It is typically Friday to
Friday midnight CT." The window stays Friday 00:00 CT to Friday 00:00 CT,
half-open — a Friday-daytime blog post or bookmark belongs to the *following*
week's issue, and that is the intent, not an accident of the arithmetic.

**The issue is dated its Saturday, no matter when it sends.** The send may
slip to Sunday or Monday (the archive's 67 Sunday dates are the old
workflow's send timestamps), but the date is the issue's identity: a Sunday
or Monday date snaps *back* to the Saturday just past, a midweek date snaps
forward to the target. The window can therefore never move with a late send.

## A forked post never reaches the blog, and has no merge (2026-10-10)

Jamie: "fork the content that the newsletter will get so edit this but DO NOT
change the blog post it is sourced from", and then "it is as simple as just
STOPPING the edits going back to the blog". So a fork is only that: a
Micro.blog item marked `forked`, which write-back and the re-scan's reconcile
both pass over. There is deliberately no way to push a fork's words to the
blog, no diff-and-merge between the two copies, and no field holding a second
body beside the post's: the item's own `body` and `title` are the newsletter's
copy, so every renderer, proof, link check and wand already reads it. Rejoin
is the one way back, and it takes the blog's words; the newsletter's copy is
let go (the `revisions` table still has it).

## The log records presses, and not what says nothing new (2026-10-11)

Jamie, after WT353: "We have a product level feature here of a user visible
log per issue and we even use it to generate the time spent per issue. But
when Claude is looking at things like 'was this item forked' it could not
find it until after the fact." So the event log is the record of the issue,
not a narration of some of it (`docs/event-log.md`). That shows up in what
is logged that never was, and what is no longer logged:

- **A wand that works is logged**, not only one that fails, and so is the
  pick from it (`via: 'wand'`). When only failures were logged, the log could
  say how often the wands failed and nothing about how much they helped.
- **A recheck that agrees is not logged.** WT352's log was 124 rechecks of
  420 events, each one "still waiting". A check is logged when its status
  moves, when it errs, or when Jamie asked for it.
- **Who did it is a column, not a guess from the kind.** Only Jamie's acts
  are his time. Before this, an automatic write-back after each edit was
  counted as work.
- **No `agent` actor yet.** The MCP cannot write (below), so nothing an
  agent does reaches the log. Writes add that actor.

## A share's words are a template, never generated (2026-10-11)

There is no share wand. Jamie, after WT353, on its copy: "They all felt either
inauthentically pretending to be me but not, or too hype-y." A share goes out
on Jamie's LinkedIn or his blog, where Thingy does not post, so the newsletter's
answer (Thingy writing under its own byline) does not reach it. What he is
comfortable with is "simple templates that show the list of things in it
because it is obviously not me writing the share, and also obviously not AI
pretending to be me". So a share starts as a contents template filled from the
issue (`src/shared/shares.ts`; `docs/share-plan.md`). Do not bring generated
share copy back, in any voice, without asking Jamie.

## A share's blog post is never swept into the next issue (2026-10-06)

The Weekly Thing reprints every blog post, and a share's blog post is a blog
post. Left alone, the post announcing WT353 would be swept into WT354's
Journal. The sweep skips every post whose URL a share recorded
(`sharedBlogUrls`), and only those. It does not go by the `Weekly Thing`
category: Jamie writes his own posts about the Weekly Thing, and they belong
in Journal (WT352 carried one). This is why a blog share that comes back
from Micropub without the new post's URL is a failure, not a success.

## The MCP interface reads; it does not write (2026-10-04)

`/mcp` has no write tool, and that is the decision, not a gap to fill
quietly. Jamie, 2026-10-04: "Perhaps we should make v1 read only?" An agent
reads the issue as the editor shows it and suggests in its own
conversation; Jamie applies what is worth keeping. Every word in the issue
stays Jamie's choice without a new attribution model.
Writes are a v2 with its own plan (`docs/mcp-plan.md`, *Later*): proposals
Jamie accepts on the page, the editor following outside changes live, and an
actor on each event.

It has no authentication either, by the same reasoning as the editor: it is
reached on loopback and on the tailnet, where Tailscale has already said who
is asking, and it is never served through Funnel. Restricting `/mcp` alone
to loopback would protect nothing while the editor beside it can write.

## A send is announced on the bus, never gated by it (2026-10-27)

Every leg puts a `published` event on the publishing bus after its send is
on the record (`integrations/publishing.ts`). The event is a receipt for
others (the sync page measures each hop from it), not a step of the send:
if the bus is unreachable, or slow past ten seconds, the leg is still sent,
the failure is logged and recorded on the issue, and nothing is retried.
An issue is published by its legs, as before (*Published is derived*), not
by the bus hearing about it. Jamie, 2026-10-26: "I really would like to get
as many things to be event based"; the bus is how, and the sends stay
the thing that happened.

**Prepared exception for the archive command (2026-10-27, off).** Once the
bus rule has carried a natural real send and its destination receipt, Jamie
may retire the direct nudge with the two cutover variables in `status.md`.
The archive is a trigger rather than a reader-facing publication, so in
that mode its published event is the delivery itself. It needs an
acknowledgement before success is recorded; it is not a second optional
announcement after a dispatch. An uncertain command is never retried here.
Every reader-facing leg retains its non-gating announcement. The nudge stays
until the operator has checked the real workflow and received evidence.
