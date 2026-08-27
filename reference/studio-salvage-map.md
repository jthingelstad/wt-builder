# Studio salvage map

Studio is evidence and a possible implementation donor, not WT Builder's
product foundation.

Studio is being split. Authoring and publishing become WT Builder; the corpus
and the retrieval API stay behind in the repository currently called
`studio-thing`, which is being renamed to `archive-thing`. Code listed below as
reusable is code WT Builder is expected to end up owning, not borrowing.

## Likely reusable after prototype validation

- Pinboard and Micro.blog API clients
- Buttondown draft integration
- Website edition build (`pipeline/content`)
- Website repository handoff (`pipeline/deploy/push_site_inputs.py`)
- Audio TTS chunking and synthesis
- Audio validation and faithfulness review
- Bumpers, normalization, upload, and manifest handling
- Feed publication verification
- Thingy/Librarian archive retrieval

The website build and handoff are worth calling out: in Studio they sit on the
producer side, and after the split they belong to WT Builder. The archive does
not publish. See
[`../docs/decisions/0002-publishing-and-archive-boundary.md`](../docs/decisions/0002-publishing-and-archive-boundary.md).

## Re-evaluate before reuse

- Issue storage schema
- Current web application routes and templates
- Section/atom projections
- Publish-state schema
- Job orchestration

## Do not inherit by default

- Studio branding and creative-studio framing
- Agent-centric navigation
- Separate issue/editor/package surfaces
- Flattened Markdown as the source for audio
- Existing assumptions that every discovered section belongs in audio
- Audio metadata kept in a separate manifest and joined at site-build time
- Any path that puts the archive inside the publishing sequence

## Migration principle

Port contracts with tests, not directories wholesale. Preserve Studio and the
existing Shortcuts workflow as fallbacks until WT Builder has published a real
issue successfully.
