# 0002: Publishing and archive boundary

Status: accepted

## Context

Studio combined three roles: authoring, publishing, and serving the archive
that Thingy queries. WT Builder takes over authoring and publishing. The
archive and its retrieval API remain in the other repository, which is
`studio-thing` today and is being renamed to `archive-thing`.

That split raises a question the earlier product brief did not answer: is the
archive a publishing destination, or something else?

## Decision

Publishing means delivering an issue to a reader. WT Builder owns every
publishing leg and sends directly to each destination:

- `weekly.thingelstad.com` receives the website edition as a committed handoff.
- Buttondown receives the email edition as a draft.
- `files.thingelstad.com` receives the audio file.

The archive is not a publishing destination. WT Builder sends issue text to it
for one reason: so Thingy can retrieve and cite the issue. That send is a
separate act that happens after publication and must never block it.

WT Builder also owns audio end to end: script generation, synthesis, bumpers,
cover art, validation, upload, and the audio metadata. The archive receives no
audio of any kind.

## Consequences

- The archive sits outside the send path. A corpus, retrieval, or archive
  repository failure degrades Thingy and leaves publishing unaffected.
- The archive feed is its own lifecycle leg with its own evidence and retry. It
  is not a readiness gate.
- The website publishes an audio reference, not an audio file. The file lives
  only on the CDN. Issue audio runs tens of megabytes and never belongs in a
  git repository.
- The corpus must not ingest audio scripts. Spoken audio restates the issue
  text, so embedding it would place near-duplicate passages in the corpus that
  compete with the canonical text during reranking and produce citations to the
  spoken variant. The existing corpus build already ignores audio. Preserve
  that.
- Audio metadata belongs to the issue. The four fields the website needs
  (`audio_url`, `audio_duration_seconds`, `audio_voice`, `audio_byte_size`) are
  stamped into the issue record at publication rather than joined from a
  separate manifest at site-build time. This keeps a single source for each
  field and removes the last audio dependency from the archive side.
- `pipeline/content` and `pipeline/deploy/push_site_inputs.py` in Studio are
  WT Builder's code, not the archive's. They build the website edition and
  commit the handoff.
- One artifact still flows from the archive to the website: the topic graph
  that powers topic pages. It is derived from the corpus, is not part of any
  issue send, and a stale graph degrades topic pages without blocking an issue.
