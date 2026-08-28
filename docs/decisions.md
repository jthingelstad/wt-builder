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

**The archive is not a publishing destination.** WT Builder sends issue text to
it for exactly one reason — so Thingy can retrieve and cite the issue — and that
send happens *after* publication and must never block it. An issue can sit
published with an unsent archive feed. That is a Thingy staleness problem, not a
publishing problem.

The archive receives text only. It receives no audio of any kind: audio lives on
the CDN and the website publishes the reference.

*Invisible in code because it is a boundary between repositories. Nothing in
`src/` can show you that the archive is downstream of publishing rather than part
of it.*

## The archive feed is a commit, not an API call

WT Builder commits issue text directly into the archive repository — the same
cross-repo commit mechanism used to hand generated inputs to
`weekly.thingelstad.com`, pointed at a different target.

Not an ingest endpoint: a commit is durable, diffable, revertible, and carries
provenance for free, and the archive's corpus build already triggers on changes
to that path. An API would have to reinvent all of it and add a service to
operate.

*The mechanism is in `src/server/integrations/github.ts`. The reason it is not an
API is not.*

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
the "as imported" line in the Source lens — but there is nothing for direct
content. Any future undo should start there; the structural acts are already
reversible.

*Do not add locking, autosave indicators, or revision history without revisiting
this.*

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

## Generation offers; it never writes

The wand returns candidates and nothing changes until Jamie picks one. Editorial
review writes notes in the margin and never touches prose. Both are advisory and
neither gates sending.

This is why every word in the issue is Jamie's: not because the model is
prevented from writing, but because the accept step is his.

*Visible in `editorial.ts` as a return type. Invisible as a principle — which is
the part that stops the next convenience feature from quietly writing.*

## The podcast builder will be a sibling, not a feature

The authoring app for *Another Thing* — outlining, recording support,
transcripts, publishing episodes — is **`at-builder`**, scoped 2026-08-28.
**It is its own application, not a mode of WT Builder.** One editor and one newsletter is
what makes this codebase small enough to trust; a second product grafted on
is how Studio became a "publishing brain" and died of it. The product brief's
non-goals already exclude podcast authoring, and that exclusion is load-bearing.

What the sibling should take from here is the *pattern*, and possibly two
mechanisms worth extracting when it starts (not before): the audio mastering
chain (`integrations/audio.ts` — chunked TTS is irrelevant to a recorded
podcast, but the loudnorm/tag/upload tail is not) and the cross-repo commit
client (`integrations/github.ts`). Its send targets differ: an episode is a
commit of `content/episodes/{N}-slug.md` + transcript into
`another.thingelstad.com`, whose URL scheme (`/podcast.xml`, `/YYYY/MM/DD/`,
`/uploads/YYYY/`) is load-bearing for subscribers and must not be redesigned
by the tool. The corpus side needs nothing: the Librarian already ingests
Another's episodes on its own schedule.

*Invisible in code because it is a decision about what this repo will never
contain.*

## Still open

**Should the content window end Friday 11:59 PM CT rather than 00:00?** The
cutoff today is Friday 00:00 to Friday 00:00 Central, half-open, so a
Friday-daytime bookmark lands in the *next* issue. Whether that is right is a
live question. The arithmetic and the daylight-saving handling are in
`src/shared/dates.ts`; only the question is here.
