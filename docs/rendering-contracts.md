# Rendering contracts

The issue has three first-class editions. Render behavior is defined per item
type; it is not inferred by converting one final Markdown document.

## Initial matrix

| Item type | Website | Buttondown | Audio |
| --- | --- | --- | --- |
| Intro | Yes | Yes | Yes |
| Outro | Yes | Yes | Yes |
| Quote | Yes | Yes | Yes |
| Currently | Yes | Yes | Yes, custom spoken form |
| Photo | Yes | Yes | No |
| Featured link | Yes | Yes | Yes |
| Notable link | Yes | Yes | Yes |
| Briefly link | Yes | Yes | Yes, reversed form |
| Journal post | Yes | Yes | Yes |
| Promoted Journal post | Yes | Yes | Yes |
| Membership | Yes | Yes | To validate |
| Haiku | Yes | Yes | To validate |
| Echoes | Yes, always last | Yes, always last | No |

Unknowns are deliberately marked instead of inheriting Studio behavior.

## Briefly

Website and Buttondown:

```text
Description → linked title
```

Audio:

```text
Title. Description.
```

## Journal

Ordinary Journal items are grouped beneath clear publication-date boundaries.
Each item remains independently removable.

Titled long posts may be promoted. Promotion changes placement and
presentation, not provenance or underlying content.

## Photo

Website and Buttondown include image, alt text, caption, and relevant metadata.
Photo is omitted from audio rather than replaced with a generic narration.

## Thingy attribution

Membership and Echoes must include a visible byline or equivalent attribution.
Thingy's words must never appear to be Jamie's.

Echoes is omitted from audio. If Membership is included in audio after
validation, the spoken script must explicitly introduce Thingy as the author.

## Audio

Audio is rendered from canonical items before publication. Each applicable item
produces its own spoken block, enabling:

- item-specific transformations,
- editorial preview and correction,
- natural pauses and section transitions,
- selective re-rendering, and
- deterministic omission.

The final audio artifact may reuse Studio's proven TTS, validation, bumper,
normalization, and upload machinery, but not its flattened-Markdown dependency.
