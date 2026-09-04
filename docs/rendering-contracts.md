# Rendering contracts

The issue has three first-class editions. Render behavior is defined per item
type; it is not inferred by converting one final Markdown document.

Per-item channel flags decide what renders where. This matrix is the default the
flags are seeded from, and the rows marked No are **locked**: the flag cannot be
set true, and `channel_locks` carries the reason so the interface states it
rather than failing quietly.

## Initial matrix

| Item type | Website | Buttondown | Audio | Publishes heading |
| --- | --- | --- | --- | --- |
| Intro | Yes | Yes | Yes | No |
| Outro | Yes | Yes | Yes | No |
| Quote | Yes | Yes | Yes | No |
| Currently | Yes | Yes | Yes, custom spoken form | Yes |
| Photo | Yes | Yes | No | No |
| Featured link | Yes | Yes | Yes | Yes |
| Notable link | Yes | Yes | Yes | Yes |
| Briefly link | Yes | Yes | Yes, reversed form | Yes |
| Journal post | Yes | Yes | Yes | Yes |
| Promoted Journal post | Yes | Yes | Yes | Yes, its own title |
| Membership | Yes | Yes | Yes, Thingy introduced as author | No |
| Haiku | Yes | Yes | Yes, one line at a time | No |
| Echoes | Yes, last | Yes, last | No | Yes |
| Ad hoc section | Yes | Yes | Yes | Yes, its own title |
| Markdown block | Yes | Yes | Yes | No |

Unknowns are deliberately marked instead of inheriting Studio behavior.

Photo, Haiku, and Membership print no heading. The builder shows their section
names in the structural gutter instead, so the editor can see what a block is
without the reader being told.

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

Ordinary Journal items are grouped beneath publication-date boundaries. The
group prints the weekday alone — the date is already established by the issue.
Each item remains independently removable.

Titled long posts may be promoted. Promotion changes placement and
presentation, not provenance or underlying content. A promoted post prints its
weekday and time beneath its heading.

## Photo

Website and Buttondown include image, alt text, caption, and relevant metadata.
The location in the metadata line links to OpenStreetMap at the photo's exact
EXIF coordinates when the camera recorded them (`media.coordinates`); without
coordinates the place prints as plain text. Photo is omitted from audio rather
than replaced with a generic narration. Photo may appear more than once in an
issue.

## Thingy attribution

Membership and Echoes must include a visible byline or equivalent attribution.
Thingy's words must never appear to be Jamie's.

Echoes is omitted from audio. Membership **is** spoken, and the script must
introduce Thingy as its author before the words themselves:

```text
Next, a word about membership. This part was written by Thingy, the assistant
that helps with the Weekly Thing.
```

## Echoes

Echoes renders last when it is present. It is not required: an issue may be
published without it.

## Audio

**Every word in the script is spoken.** Section transitions are script lines, not
markers: "Now, the Notable section.", "And to close, this week's haiku." A line
that appears in the script and is not read aloud is a bug.

**Link sections carry spoken signposts.** Notable, Featured, and Briefly announce
position — "Link 1 of 5." — before each item, so a listener has somewhere to
anchor. The count is of items actually in the audio edition, not of items in the
section.

**Haiku is read one line at a time**, each line its own spoken block, so the
pauses fall where the line breaks are.

Audio is rendered from canonical items before publication. Each applicable item
produces its own spoken block, enabling:

- item-specific transformations,
- editorial preview and correction,
- natural pauses and section transitions,
- selective re-rendering, and
- deterministic omission.

**Membership and Haiku are spoken.** Membership is introduced as Thingy's words
before the words themselves; Haiku is read one line at a time. Settled
2026-08-28; the interface spec previously flagged both as undecided.

The audio artifact is synthesized with OpenAI TTS, mastered with a two-pass
ffmpeg loudnorm, and tagged with cover art before upload. It is rendered from
canonical items, never from flattened Markdown.
