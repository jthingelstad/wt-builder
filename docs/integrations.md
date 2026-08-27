# Integration boundaries

## Pinboard

- Imports candidate links and tags.
- WT Builder can author and edit commentary directly.
- Supported edits sync automatically using last-writer-wins.
- Local edits survive transient API failures.

## Micro.blog

- Imports posts, titles, dates, bodies, URLs, and media.
- Original posts remain canonical for published blog content.
- Inclusion, exclusion, ordering, promotion, and WT-specific presentation are
  owned by WT Builder.

## Thingy / Librarian

Thingy is a generation service WT Builder calls during assembly.

- Membership: generates an attributed CTA from supplied campaign facts.
- Echoes: retrieves relevant archive context and writes an attributed closing
  callback grounded in the assembled current issue.
- Generation must preserve citations/provenance for Jamie's review even if the
  public rendering omits technical retrieval details.
- Both call the archive's retrieval endpoint. It is a server-side call with a
  service credential and is never reachable from browser code.

## Archive

The archive holds the corpus Thingy answers from. It is a separate repository,
currently `studio-thing` and being renamed to `archive-thing`.

- The archive is not a publishing destination. See
  [`decisions/0002-publishing-and-archive-boundary.md`](decisions/0002-publishing-and-archive-boundary.md).
- After an issue publishes, WT Builder sends its text to the archive so Thingy
  can retrieve and cite it.
- The send is a direct commit into the archive repository, scoped to the issue
  data path. See
  [`decisions/0003-archive-feed-mechanism.md`](decisions/0003-archive-feed-mechanism.md).
- The send is asynchronous and non-blocking. It has its own evidence and retry
  and is never a readiness gate. A failed archive send means the issue is
  published and Thingy does not know about it yet.
- Send text only. The archive receives no audio.

## Buttondown

- Receives a rendered draft.
- Draft creation/update is distinct from scheduling or sending.
- Buttondown-specific Liquid and components belong only in the email renderer.

## Website

- Receives the website edition through a versioned handoff that WT Builder
  builds and commits.
- `weekly.thingelstad.com` remains a downstream render surface. It renders what
  it is given, including the audio feed, and holds no publishing logic.
- The handoff carries an audio reference, never an audio file.

## Audio

- Receives ordered spoken blocks from item renderers.
- WT Builder owns audio end to end: script, synthesis, bumpers, cover,
  validation, normalization, upload, and metadata.
- The rendered file is uploaded to `files.thingelstad.com` and lives only
  there. It is never committed to a repository.
- The website publishes the reference and renders the podcast feed from it.
  Stamp `audio_url`, `audio_duration_seconds`, `audio_voice`, and
  `audio_byte_size` into the issue record at publication so the website edition
  needs no second source.
- TTS generation, validation, normalization, metadata, storage, and podcast
  feed integration can be salvaged from Studio after product validation.

## Secrets

All credentials are server-side managed secrets. They never appear in browser
code, fixtures, logs, Shortcut exports, or this public repository.
