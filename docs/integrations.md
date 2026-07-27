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

- Membership: generates an attributed CTA from supplied campaign facts.
- Echoes: retrieves relevant archive context and writes an attributed closing
  callback grounded in the assembled current issue.
- Generation must preserve citations/provenance for Jamie's review even if the
  public rendering omits technical retrieval details.

## Buttondown

- Receives a rendered draft.
- Draft creation/update is distinct from scheduling or sending.
- Buttondown-specific Liquid and components belong only in the email renderer.

## Website

- Receives the canonical archive edition through a versioned handoff.
- `weekly.thingelstad.com` remains a downstream render surface.

## Audio

- Receives ordered spoken blocks from item renderers.
- TTS generation, validation, normalization, metadata, storage, and podcast
  feed integration can be salvaged from Studio after product validation.

## Secrets

All credentials are server-side managed secrets. They never appear in browser
code, fixtures, logs, Shortcut exports, or this public repository.
