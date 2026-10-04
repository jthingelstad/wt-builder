# Before WT353: what WT352 taught us

WT352 went out on 2026-10-04: 2 h 05 m over 10 sittings, 30 m less than WT351,
sent with Send all four in 3 m, every verify leg green. Four editor bugs were
fixed live while Jamie wrote (video, the link banner, the Echoes 429, links with
parentheses). The ride-along notes are in `mcp-ride-along-wt352.md`.

The lesson under most of it: **the things the agent caught by hand should be
caught by WT Builder.** A non-haiku reached "done", a stray ")" reached the audio
script, and link findings arrived at the Send view, where Jamie is sending, not
editing.

WT353 is dated Saturday 2026-10-10. Everything here is warn, never block.

## Before WT353 (in this order)

### 1. Link and deliverability checks move onto the rows (M)

Jamie, 2026-10-04: "this link checking stuff in the send page doesn't work at
all.. at that point I'm about sending, not editing. All of the link checking was
really hard to work with."

- Check each link when it arrives (sweep, sync, a link typed into a body), in the
  background, cached per URL. The finding is the row's note (c3b0360), seen while
  writing the commentary. The Check links button goes.
- Mark only what Jamie can act on: dead (404/410), an expiring gift link, a real
  redirect to a different page, a blocklisted domain. Never suggest a canonical
  that drops https (Plan mode). "Would not answer" (403/429 from bot blocking)
  gets no mark. Plain http only when the https address actually works
  (bowlingalone.com's certificate is self-signed).
- The Send view gets one line: green when clear, amber only when something
  actionable is open, naming the row with a jump back. All-clear is never drawn
  as a warning (today both boxes always use `send-warn` + the alert icon).
- The "Links checked" and "Deliverability" pills leave the Send view: done unless
  a row still has something to act on. The dead-link confirm on send stays.

### 2. Haiku evaluator (S)

Jamie tagged it: "we should build an evaluator on that to have it generate and
then check -- i don't want to have a non-haiku sent". The wand checks 5-7-5 on
every candidate and regenerates or drops the rest; a hand-edited non-5-7-5 puts
a warning hint on the Haiku pill. The review checks form too.
*Built 2026-10-04*: `src/shared/syllables.ts` counts; the wand asks once
more for drafts that miss, offers only 5-7-5, and says so in a sentence when
none pass; a hand-written miss is a `haiku` row hint ("Counted 5-6-5…") on
the Haiku row rather than the pill, since a hint never moves a pill; the
proof pass adds a PROOF note (MCP 1.5.3).

### 3. Lint the audio script before the model reads it (S)

The script read flagged four voice issues and missed "The Replacements)". A
mechanical pass first: stray `)` `]` `](`, URLs, Markdown or HTML residue, bare
emoji. Its findings join the script review.

### 4. Echoes fails like a person would say it (S)

The 429 surfaced as raw JSON. Say "The archive is busy; trying again…" during
the retries and a plain sentence if they run out. Log a failed generation as an
event so the MCP's `changes` shows it.
*Built 2026-10-04*: `ArchiveError` and `modelFailure` say every failure in a
sentence; the wand line polls `GET /drafting`; a failed draft is a `draft`
event (MCP 1.5.2).

### 5. Fix the flaky hints test (S)

`tests/e2e/hints.e2e.ts` (written 10-04) failed once on WebKit and passed on
rerun. Find the race before it teaches anyone to ignore a red run.

## Next, when there is room

6. **One Markdown parser** (M). The parenthesis bug lived in about eight
   hand-written link patterns while markdown-it was already loaded. Build plain
   text and speech from markdown-it's tokens, and add a tricky-links item
   (parentheses, a title, nested brackets) to `fixtures/representative-issue.json`
   so every renderer is tested against it.
7. **MCP 1.6** (M), the ride-along costs:
   - `since=` returns only what moved (each poll was about 12k tokens).
   - `get_item` accepts `anchor`; settle on "lens" or "edition" in one place.
   - `checks.links.unchecked` lists its URLs.
   - Failed generations appear in `changes`.
   - An echo's cited issues carry their publish dates, so "two years earlier"
     can be checked.
8. **Video, second pass** (S). Rehost the poster like images (the email
   hotlinks micro.blog's CDN today). The source is HLS, which Firefox will not
   play natively; the "Watch it on the blog" link covers it, but say so in the
   inspector.
9. **Title hints remember a keep per site** (S). Six suffix hints were still
   showing at send; Jamie keeps most on purpose.
10. **Buttondown "Check now"** (S). After sending from Buttondown, the verify
    leg waits up to 10 minutes.
11. **Librarian batch `/retrieve`** (M, cross-repo with `librarian-thing`).
    WT Builder shares the Lambda's five reserved slots with Thingy chat; one
    call for many queries ends the contention instead of rationing it.

## The ride-along itself

- Filter the watcher to errors, `[edge]` refusals and send legs; every deploy
  printed 17 startup lines into the conversation.
- The agent proofs the audio slice of each settled item, not only the words.
- Push and let CI run after each live session (WT352's fixes sat five commits
  ahead of origin).

## Done on 2026-10-04 (for reference)

`770e8e4` video · `c3b0360` per-row link notes · `a4fe5d6` Echoes concurrency
and 429 retry · `bf7951c` links with parentheses · `0ff3c3c` and `f5d0799` the
Made in card shows days, never clock times, tidy enough to share.
