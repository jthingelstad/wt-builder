# Publishing lifecycle

Publishing is called **sending**, and it runs per destination. Nothing WT Builder
sends becomes authoritative where it lands.

## States

An issue has **two** states:

```text
draft | published
```

Each destination carries **its own** state alongside them:

```text
none | sending | sent | failed
```

with a timestamp, an external identifier, and — on failure — the error.

A leg that is `sending` or `failed` still carries its **last good send**,
`last_sent`: the draft Buttondown holds, the mp3 on the CDN, the commit on the
site. `recordSend` carries it forward for every leg, and a new success replaces
it. Everything that needs what a leg delivered reads it through `lastSent`
(`src/shared/sends.ts`): the Buttondown retry updates the draft it made instead
of creating a second one, the website page keeps the episode's audio and the
email's URL, and the email's "Listen to it" keeps the mp3. A failed podcast
re-render used to erase the episode's audio record, and a `sending` Buttondown
leg its draft id (review 2026-09-27 §2.1).

An earlier version of this document specified eight states
(`assembling → reviewing → ready → rendering → drafted → scheduled-or-sent →
verified → closed`). They were never built, and the reason they should not be is
that a single mutable status cannot describe an issue that is **live on the
website, has no audio, and still has a draft sitting in Buttondown**. That is an
ordinary Saturday. Three independent legs need three independent states, which is
what the Send view shows as three cards and the dashboard shows as `SITE`, `MAIL`,
and `POD` chips.

## Readiness

Readiness is **derived from the document**, never stored, so it cannot disagree
with what is actually in the issue. It is advisory: nothing on this list gates
sending.

A unit is outstanding when:

- a required direct item is empty — Intro, Outro, Currently, Photo. A section
  that is *not in the issue* counts as satisfied, not outstanding.
- a link has no commentary,
- a Pinboard or Micro.blog write-back failed, or is in `conflict` awaiting
  Keep mine or Take theirs,
- Thingy-authored content has no words yet (picking a candidate, or writing
  it, is the review: `decisions.md`, *Picking is the review*),
- the haiku is unchosen.

The progress strip draws one tick per unit; the checklist popover names each one,
says what finishing it means, and jumps to the item.

## Send legs, in run order

**Podcast → Website → Buttondown.** The website handoff publishes an audio
*reference*, so the podcast has to have produced a file for that reference to
resolve. The server enforces it: a website send is refused (409) until an audio
reference is recorded — the podcast's last good send, so a failed re-render
does not block a re-send, and the page keeps the episode that is on the CDN.
The refusal says what the podcast leg did (not run, failed, still sending).
`?force=1` is the escape for an issue with no audio: while there is none, the
Website card's action is **Commit without audio…**, which asks first
(2026-09-29). The Website card's blocker strip shows the same condition.

| Leg | Ends at | Evidence |
| --- | --- | --- |
| Podcast | an mp3 on `files.thingelstad.com` | voice, chunk count, duration, byte size, URL |
| Website | a commit on `weekly.thingelstad.com` | commit sha and its URL |
| Buttondown | a **draft** — never scheduled, never sent | draft id and URL |

The podcast leg also writes the issue's banner, `weekly-thing/{N}/cover.jpg`,
cut from the issue's photo (the show art when it has none). When the photo
cannot be fetched, the mp3 gets the show art, and so does the banner only if the
issue has none yet — a failed fetch never puts show art over a real cover, and
never leaves the page pointing at a missing one.

The website commit is the issue's page alone. The site derives its issue index
from the pages' front matter when it builds (2026-09-29); the leg once also
merged this issue's entry into a site `emails.json`, the same fields a second
time, and refused a missing or truncated one. Nothing in the commit is shared
with another writer, so there is nothing to merge and no index to guard.

Before it changes an existing email, the Buttondown leg asks Buttondown what the
email is, and only a `draft` is updated. Any other status — `scheduled`,
`about_to_send`, `in_flight`, `sent`, `imported`, or one not seen before — is
refused (409, `code: "not_draft"`, "no longer a draft … can't be edited safely"),
leaving the leg as it was, and every refusal is logged to the issue's event log —
unless the send says `?force=1` (below).
The card knows the status from the Buttondown check
(`verify.buttondown.remote_status`): once it is not `draft`, the card says so and
what an update would do, its action is **Update anyway…**, and "Re-send all sent"
and "Send the rest" leave Buttondown out.
The refusal records that status too: a check older than `remote_status` (WT350,
WT351) or none at all no longer hides it, the card re-reads the issue and switches
at once, and a run that meets the refusal carries on to the legs after it. With no
check behind it, the refusal records only that fact — `waiting`, never `passed`,
so the card still says the email is not verified — and starts the real check.

*Revisited 2026-09-29:* from 2026-09-28 a `scheduled` email was updated as a
draft was, and a `sent` one could be changed with `?web_copy=1` ("Update web
copy…" behind a confirm), which rewrote the copy in Buttondown's archive. Jamie
decided only a draft is edited: the archive is not hosted on Buttondown, so there
is no reason to edit a sent email, and every other status is one a PATCH cannot
safely change. The web-copy update is gone.

*Revisited 2026-09-29, later:* "There should be nothing that I cannot override.
I'm the only user." A plain send still refuses a non-draft; `?force=1` updates it
anyway, and the card's **Update anyway…** asks first with what an update does for
that status — a sent email changes only Buttondown's copy and nothing is sent
again, a scheduled one stays scheduled and sends the new text, one going out
races the delivery. The update is the same PATCH as a draft's, subject and body
and never a status, so no override schedules or sends. The event log says
"Override — buttondown: …" and "updated while "…", by override; status
unchanged".

The podcast's first step is a gate: the script must be approved before the leg
runs. The server holds it too (2026-09-28, review 2026-09-27, appendix: Audio): a podcast
send with no approval, or with an approval of a script that has since changed
(the hash no longer matches), is refused with a 409 before anything is
synthesized or recorded — unless the send says `?force=1`, which synthesizes the
script as it stands and logs "Override — podcast: synthesized without approval
(…)". A podcast that has ever gone out re-synthesizes
without asking again, as the card allows — an earlier good send (`lastSent`) is
enough, so a failed re-send does not bring the gate back (Revisited 2026-09-29:
until then only a latest status of `sent` was exempt; Jamie wants as few forced
steps in their own tool as can be). While it waits, reading and approving stay
in the step row, and the card's action is **Send without approval…** — plain, not
primary — which asks first and sends `?force=1` (2026-09-29; until then the button
disappeared and nothing could skip the gate). A button labelled only with a state
is still never shown: it duplicates the pill beside it and does nothing when
clicked.

A failed leg leaves the others untouched, and retrying resumes from the step that
failed rather than from the beginning.

A leg is `sending` from the moment it passes its guards, before it awaits
anything, and a second request for it is refused (409) while it runs. Sends run
in the service's own process, so a `sending` found when the service starts was
cut off by the restart: it becomes `failed` ("interrupted by a restart") with its
last good send kept, and can be retried at once. Only the process that wins the
port does this, as it starts listening and before any request: a second process
opened on the same database cannot fail the running service's legs.

## The archive feed

Sending issue text to the archive so Thingy can retrieve it is a **separate leg
that is not publishing**. It differs from the three above in three ways:

- it runs after the issue is published, not as part of getting there,
- it is never a readiness gate, and
- its failure is reported but does not degrade the issue's published state.

The Send view shows it as a fourth card, as prominent as the other three
(WT351), and verifies it like them: the corpus files match the issue, and the
Librarian returns the issue's own passages. None of the three differences above
changed. An issue can sit published with an unsent archive feed. That is a Thingy
staleness problem, not a publishing problem, and it is retried independently from
the dashboard.

The leg is a commit of `data/issues/{N}/` — `archive.md`, `links.json`, and
`metadata.json`, the canonical shape nine years of issues already have there —
into the archive repository (`WT_BUILDER_ARCHIVE_REPO`), whose CI rebuilds and
uploads the corpus on any change under that path. Its evidence is the commit
sha, like the website leg's.

Send text only. The archive receives no audio — the file lives on the CDN and the
website publishes the reference.

## Repairs to the back catalogue

The archive's `data/issues/{N}/archive.md` is the canonical text of every
issue, and historical repairs land there. For issues WT Builder authored
(WT350 on), a re-send of the website leg carries a repair to the site. For
WT1–WT349, which it never authored, `npm run rerender:archive` does: it
re-renders the site page from the canonical text, keeping everything the site
page owns — layout, permalink, tags, and the audio record the back catalogue
writes. It is a merge, never a copy: the audio record is the podcast feed's
data, and the canonical text has none.
