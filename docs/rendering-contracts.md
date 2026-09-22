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
| Photo | Yes | Yes | Yes, caption, place, and date | No |
| Featured link | Yes | Yes | Yes | Yes |
| Notable link | Yes | Yes | Yes | Yes |
| Briefly link | Yes | Yes | Yes, reversed form | Yes |
| Journal post | Yes | Yes | Yes | Yes |
| Promoted Journal post | Yes | Yes | Yes | Yes, its own title |
| Membership | Yes | Yes | Yes, Thingy introduced as author | No |
| Haiku | Yes | Yes | Yes, one line at a time | No |
| Echoes | Yes, last | Yes, last | Yes, last, in Thingy's voice | Yes |
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

## The email's shape

No title in the body — the subject is `WT<N> — Title` and Buttondown prints it
— and a `---` rule between sections. Matched to the issues Jamie sent before
the builder (WT349 compared side by side, 2026-09-20). The body ends with the
Tinylytics open pixel as every issue before the builder carried it — anonymous,
named for the issue (`/email/<N>/`), never for the reader, email medium only.
Membership's regular-subscriber branch ends with the button to the members
page — the year at $48 is the only offer, and the button is the only thing to
do — with the reader's email prefilled and `ref=WT<N>`; the premium branch is
thanks with no button. WT349's second mid-issue button is not carried:
Membership is one Thingy-framed section now.

## Journal

Ordinary Journal items are grouped beneath publication-date boundaries. The
group prints the weekday alone — the date is already established by the issue.
Each item leads with a link back to the post: its title when it has one
(bold), the time of day otherwise. All clocks are Central. Each item remains independently
removable.

Titled long posts may be promoted. Promotion changes placement and
presentation, not provenance or underlying content. A promoted post is a
section of its own: its title is the heading, its body prints with its own
paragraphs, headings, lists, and quotes intact (headings shifted to sit under
the post's heading), and it carries no time — the clock belongs to the Journal
moment it stopped being. Audio speaks it one paragraph per block.

## Photo

Website and Buttondown include image, alt text, caption, and a metadata line of
the date (no time of day) and the place.
The location in the metadata line links to OpenStreetMap at the photo's exact
EXIF coordinates when the camera recorded them (`media.coordinates`); without
coordinates the place prints as plain text. Audio speaks the caption — Jamie's
words — then the place and date ("Taken in Falcon Heights, Minnesota, on
Saturday, May sixteenth."), and shows the picture as the chapter's art. The
photo is never described: the alt text is for the page (Jamie, 2026-09-21; it
was omitted from audio entirely until then). Photo may appear more than once in
an issue.

## Thingy attribution

Thingy is Jamie's sidekick, showing up in the content from time to time
(Membership, Echoes). Thingy's words must never appear to be Jamie's, so Thingy
identifies itself the same way everywhere and differently per channel
(2026-09-20):

- **Website** — `<div class="from-thingy">` with a label line, `From Thingy`
  linked to https://thingy.thingelstad.com, then `, my agentic librarian`; the
  body follows as Markdown. The site sets the block in its sans against the
  issue's serif — the different font is the identity. Not a blockquote.
- **Email** — the same label in an inline-styled block (mail clients keep
  inline styles and little else), with the body rendered to HTML inside so no
  mail-side Markdown parser has to look inside a div. The Liquid membership
  branch sits inside the frame.
- **Audio** — a different voice. Jamie hands over in his voice, Thingy
  introduces itself in its own (`nova`, same `tts-1-hd` model as Jamie's
  `echo`), then speaks; Jamie takes the next section back:

```text
Next, a word about membership, from Thingy, my agentic librarian.   ← echo
Hello, this is Thingy. <the membership words>                       ← nova
…
Before we go, Echoes from the archive, from Thingy, my agentic librarian.  ← echo
<the echoes words>                                                          ← nova
```

Thingy says hello once an episode. Echoes is spoken since 2026-09-20 — it was
omitted from audio until Thingy had a voice.

## Echoes

Echoes renders last when it is present. It is not required: an issue may be
published without it.

**Echoes is items, and the edition assembles the section from them**
(2026-09-20). Each `echo` item prints, in section order:

```text
<the thread — Markdown, with its citations inline>

_Ask Thingy:_ [<the question>](https://thingy.thingelstad.com/chat/?prompt=<question>&from=weekly-thing-<N>)
```

An echo with no question prints its thread alone; an echo with no thread
prints nothing. The door is built by the renderer from `ask` and the issue
number (`src/shared/echoes.ts`) — it is never stored in the body, so editing
the question changes the link. **One Thingy frame wraps the whole section**,
not each echo: on the website the `.from-thingy` div, in email the
inline-styled block with each echo rendered to HTML inside it, in audio one
hand-over and one hello. Audio speaks each echo as its thread, then
"Ask Thingy: <question>" — the link's words, never its URL.

An issue whose Echoes is one `echoes` item — WT350 and earlier, where the
body was composed at pick time — renders that body as written, inside the
same frame. Both shapes are held by `tests/echoes.test.ts`; the old one is a
published contract and does not change.

## Audio

**Every word in the script is spoken.** Section transitions are script lines, not
markers, and the listener hears both ends of a section: "Now, the Notable
section. Seven links this week." … "That's the end of Notable." A promoted post
opens "Next, a longer piece: <title>." and closes the same way; the Journal
closes too. A line that appears in the script and is not read aloud is a bug.

**The pauses are placed, not hoped for.** The synthesizer does not honour a
blank line — measured on WT350 (2026-09-21), the gap before a block ran
0.0–1.6 s with no relation to structure, and a section opener got none. So
every block carries a boundary (`section`, `lead`, `item`, `paragraph`,
`line`), each block is synthesized on its own, and the assembler inserts that
boundary's silence between the pieces (`PAUSE` in
`src/server/integrations/audio.ts`). Pieces are cached by what was said and
how, so regenerating an issue re-synthesizes only the blocks that changed.

**The opening and the close are script.** There are no pre-rendered bumpers
(gone 2026-09-21). The opener names the issue, its date, and its author, then
says that the edition is generated and where the newsletter is; the close is
one sentence after Echoes, which stays the last thing said.

**Link sections carry spoken signposts.** Notable, Featured, and Briefly announce
position — "Link 1 of 5." — before each item, so a listener has somewhere to
anchor. The count is of items actually in the audio edition, not of items in the
section. A title's " | Site" or " - Site" is spoken as an aside after a comma —
"Your car is selling your data, The Verge." — because a source and a tagline
cannot be told apart and both read correctly that way.

**Print structure becomes speech.** A blockquote is framed "Quote. … End
quote." A bulleted list speaks ordinals — "First," "Second," — and a numbered
list its numbers. A heading inside a post is spoken on an item boundary. Images
say nothing.

**Haiku is read one line at a time**, each line its own spoken block, so the
pauses fall where the line breaks are. "And to close" is said only when the
haiku is in fact the last section spoken.

**Membership and Haiku are spoken.** Membership is introduced as Thingy's words
before the words themselves. Settled 2026-08-28.

**Chapters and a transcript ship with the file.** Every block that begins a
chapter — each section, each link with its URL, each Journal post with its blog
URL and first photo, the Photo with its picture, each echo with its Ask Thingy
door, Membership with the members page — is timed by where the assembler placed
it. Thingy's portrait (the site's `img/thingy.png`) is the art of every chapter
Thingy speaks, so the attribution is seen as well as heard. Chapter art is cropped square (1000px, attention crop, like the cover) so it
fills a player's frame on purpose, and uploaded content-addressed beside the
file. The mp3 carries ID3v2 chapters; `<name>.chapters.json` (Podcasting 2.0) and
`<name>.vtt` (WebVTT, every cue naming its speaker, so Thingy is attributed in
text as in voice) sit beside it on the CDN, and the issue record carries their
URLs and the chapter list. This is how the podcast hands a listener the links.

The audio artifact is synthesized with OpenAI TTS (`tts-1-hd`, echo for Jamie,
nova for Thingy, the two gain-matched before mastering), mastered with a
two-pass ffmpeg loudnorm, and tagged with cover art before upload under a
content-addressed name — the CDN serves it immutable, so a regenerated issue is
a new object and the page and feed move to it when the website leg re-sends. It
is rendered from canonical items, never from flattened Markdown.
