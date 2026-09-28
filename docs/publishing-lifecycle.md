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
- a Pinboard write-back failed,
- Thingy-authored content is undrafted, or drafted and not yet reviewed,
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
`?force=1` is the escape for an issue with no audio, and is offered only when
there is none. The Website card's blocker strip shows the same condition.

| Leg | Ends at | Evidence |
| --- | --- | --- |
| Podcast | an mp3 on `files.thingelstad.com` | voice, chunk count, duration, byte size, URL |
| Website | a commit on `weekly.thingelstad.com` | commit sha and its URL |
| Buttondown | a **draft** — never scheduled, never sent | draft id and URL |

The podcast leg also writes the issue's banner, `weekly-thing/{N}/cover.jpg`,
cut from the issue's photo (the show art when it has none). When the photo
cannot be fetched, the mp3 gets the show art and the live banner is left as it
is — a failed fetch never puts show art over a real cover.

The website commit is the issue's page plus the site's `emails.json` with this
issue's entry merged in. The merge is made against the file as it stands when
the commit is made — re-read and re-merged if the ref update loses a race — so a
commit that lands on the site meanwhile (the back catalogue's audio records) is
kept, never overwritten by an earlier read. A missing, unparseable or truncated
index refuses the leg; truncated means fewer entries than the last published
issue's number (never under the pre-Builder archive's 349).

Before it changes an existing email, the Buttondown leg asks Buttondown what the
email is. `draft` or `scheduled`: it is updated, as always. `about_to_send` or
`in_flight`: refused (409, "Buttondown is delivering it now"), recording nothing.
`sent`: refused unless the request says `?web_copy=1` — "Update web copy…" on the
card, behind a confirm — which changes only the copy in Buttondown's archive and is
logged as such. The card knows the email has gone from the Buttondown check
(`verify.buttondown.remote_status`), and "Re-send all sent" then leaves Buttondown
out. The `sent` refusal records that status too, and names itself
(`code: "email_sent"`): a check older than `remote_status` (WT350, WT351) or none
at all no longer hides it, the card re-reads the issue and switches at once, and a
run that meets the refusal carries on to the legs after it. Any other status is
refused and changes nothing.

The podcast's first step is a gate: the script must be approved before the leg
runs. The server holds it too (2026-09-28, review 2026-09-27 §8): a podcast
send with no approval, or with an approval of a script that has since changed
(the hash no longer matches), is refused with a 409 before anything is
synthesized or recorded. A podcast already sent re-synthesizes without asking
again, as the card allows. While it waits, the card's own action button disappears so the step row
owns the interaction — a button labelled with a state duplicates the pill beside
it and does nothing when clicked.

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
