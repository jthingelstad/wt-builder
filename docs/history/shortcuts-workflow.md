# Current workflow evidence

> **History, not instruction.** This records the nine-year Shortcuts workflow
> that WT Builder replaces. It is kept because that workflow is still the
> fallback until WT Builder has published a real issue, and because it is the
> behavioural evidence the rendering contracts were derived from.

## Shortcuts model

`Build Issue` calls section shortcuts and concatenates the returned Markdown.
Data Jar stores the current issue and cached section results.

Observed section shortcuts include:

- Intro
- Quote
- Featured
- Currently
- Photo
- Notable/Links
- Membership
- Journal
- Briefly
- Haiku

Pinboard links are imported as structured dictionaries containing a title,
URL, description/commentary, and tags. Tags determine Featured, Notable, or
Briefly placement. Micro.blog posts are imported with title, URL, publication
date, and body. Embedded post images are resized and copied for durable issue
use.

## Strengths to preserve

- The workflow has shipped issues reliably for nine years.
- Section output is deterministic and inspectable.
- Pinboard and Micro.blog remain natural capture systems.
- Custom section behavior is explicit.
- The final Buttondown source is editable before sending.

## Friction to eliminate

- Correcting generated Markdown does not update Pinboard.
- Pinboard commentary must be complete before draft generation.
- Links are date ordered and cannot be rearranged manually.
- Journal formatting is weak and individual posts are hard to remove.
- Long titled posts cannot naturally become movable standalone sections.
- Audio is derived too late from a flattened publication artifact.
- Website, Buttondown, and audio differences are implicit transformations
  rather than explicit item contracts.

## Interpretation

The old workflow is the executable specification for content behavior, not the
architecture to reproduce. WT Builder should preserve its proven outcomes while
keeping the issue structured until all editions have been rendered.
