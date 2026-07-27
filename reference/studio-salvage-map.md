# Studio salvage map

Studio is evidence and a possible implementation donor, not WT Builder's
product foundation.

## Likely reusable after prototype validation

- Pinboard and Micro.blog API clients
- Buttondown draft integration
- Website repository handoff
- Audio TTS chunking and synthesis
- Audio validation and faithfulness review
- Bumpers, normalization, upload, and manifest handling
- Feed publication verification
- Thingy/Librarian archive retrieval

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

## Migration principle

Port contracts with tests, not directories wholesale. Preserve Studio and the
existing Shortcuts workflow as fallbacks until WT Builder has published a real
issue successfully.
