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
resolve. The dependency is **stated, not enforced**: the Website card carries a
blocker strip and nothing prevents sending out of order.

| Leg | Ends at | Evidence |
| --- | --- | --- |
| Podcast | an mp3 on `files.thingelstad.com` | voice, chunk count, duration, byte size, URL |
| Website | a commit on `weekly.thingelstad.com` | commit sha and its URL |
| Buttondown | a **draft** — never scheduled, never sent | draft id and URL |

The podcast's first step is a gate: the script must be approved before the leg
runs. While it waits, the card's own action button disappears so the step row
owns the interaction — a button labelled with a state duplicates the pill beside
it and does nothing when clicked.

A failed leg leaves the others untouched, and retrying resumes from the step that
failed rather than from the beginning.

## The archive feed

Sending issue text to the archive so Thingy can retrieve it is a **separate leg
that is not publishing**. It differs from the three above in three ways:

- it runs after the issue is published, not as part of getting there,
- it is never a readiness gate, and
- its failure is reported but does not degrade the issue's published state.

An issue can sit published with an unsent archive feed. That is a Thingy
staleness problem, not a publishing problem, and it is retried independently from
the dashboard.

The leg is a commit of `data/issues/{N}/` — `archive.md`, `links.json`, and
`metadata.json`, the canonical shape nine years of issues already have there —
into the archive repository (`WT_BUILDER_ARCHIVE_REPO`), whose CI rebuilds and
uploads the corpus on any change under that path. Its evidence is the commit
sha, like the website leg's.

Send text only. The archive receives no audio — the file lives on the CDN and the
website publishes the reference.
