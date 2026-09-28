# Where WT Builder stands

Written 2026-08-27, at the end of the rebuild-from-the-design session.
Amended 2026-08-28 after a full review: the send dispatch is restored (it had
been silently severed since 2dd684b), the archive corpus send exists as the
fourth leg, and the Pinboard sweep uses the window's true instants.

The first build was made from the written contracts without opening the design
files. This session imported the handoff, read the whole spec and its decision
records, and rebuilt the client against them. What follows is what is actually
finished, what is half-finished, and what has never run.

## Working, and verified in a browser against live data

- **Dashboard** — rows with the completion strip full-width beneath a draft
  line, the deadline countdown chip, SITE/MAIL/POD send chips, and the
  archive-feed cell. Plus the setup sheet.
- **URLs** — `/`, `/wt350`, `/wt350/send`. Back, deep links, reload-in-place,
  and two issues in two tabs all work.
- **The canvas**: the three-column grid at `76px | 680px | {0 | 250px}`, the
  card painted per row, the structural margin with its 2×n control rail, the
  editorial margin.
- **Website lens** — head block, section rules, headings, Currently, Journal
  with date grouping, Briefly, Haiku, Echoes, held-out strips.
- **Source lens** — every item as stored, its own section headings with
  `SECTION · type · n ITEMS`, prose plus one quiet meta line, state chips.
- **Left panel** — issue metadata at rest and open, the outline with drag
  reorder, provenance chips, add-back chips for absent sections.
- **Progress strip** — one tick per readiness unit, edge-aware tooltips,
  click-to-jump.
- **Inspector** — fields per type, the Thingy review gate, editions with locked
  channels and their reasons, provenance, archive references.
- **Editorial review** — the summary bar and margin notes, measured and
  stacked. Run for real against Claude; the notes were good.
- **Audio lens** — a numbered script rather than a page, rendered from the
  same `audioScript()` that feeds the synthesizer, so it cannot drift from
  the mp3. Section cues, omission strips, and the TO VALIDATE flag.
- **Email lens** — the Buttondown Liquid branch after Membership.
- **Checklist popover** — opens from the strip, coloured by kind, each row
  saying what finishing it means and jumping to the offending item.
- **Collapse mode** — one row per section with preview, counts, drag reorder,
  and Echoes pinned last.
- **Photo upload** — drop a file, it is resized to 1200px, stored on the CDN,
  and the camera's own time and coordinates are read from EXIF. Verified end
  to end: a 2400x1600 photo stored at 1200x800, 23 KB down to 3 KB, served
  from files.thingelstad.com, and the "Photo placed" checklist item flipped.
- **Send view** — Podcast, Website, Buttondown in run order, the audio gate,
  real per-step evidence. As of 2026-08-30 the ordering blocker is enforced,
  not stated: the server refuses a website send until an audio reference is
  recorded — the podcast's last good send, so a failed re-render does not
  block a re-send (2026-09-28, review 2026-09-27 §2.1); the 409 says whether
  the podcast has not run, failed, or is still sending, and offers
  `?force=1`, the deliberate escape for an issue with no audio, only then — and every
  leg refuses a second POST while one is in flight. Since 2026-09-28 a leg
  is claimed the moment it passes its guards — in flight in the process (a
  set of `id:leg`, the real guard) and `sending` on the issue, before any
  await — so two clicks never make two Buttondown drafts; and at boot,
  once it holds the port and before it handles a request, the service
  turns every persisted `sending` into `failed` ("interrupted by a
  restart"), keeping the last good send. A second process on the same
  database whose listen fails (`npm run dev` beside the service) sweeps
  nothing, so the live service's legs in flight are left alone. A
  persisted `sending` under ten minutes old still refuses, for another
  process on the same database. `sending` is written before the key is
  taken, so a write that throws (a busy database) leaves nothing held.
  Review 2026-09-27, §2.1.
- **A failed cover fetch keeps the live banner** (2026-09-28) — when the
  issue's photo cannot be fetched, `buildCover` still squares the show art
  for the mp3 but no longer uploads it over `weekly-thing/{N}/cover.jpg`. A
  back-catalogue episode's cover source is that banner itself, so one bad
  fetch had replaced a real cover with show art. Review 2026-09-27, §8.
- **The server holds the podcast to the approved script** (2026-09-28) —
  the gate was the client's alone, and the server synthesized whatever
  script it held. A podcast send now needs `script_review.approved_at` on
  the script as it stands (same hash); otherwise a 409, before any
  synthesis or leg state. A podcast already sent is exempt, as on the
  card. Review 2026-09-27, §8.
- **A failed leg keeps its last good send** (2026-09-28) — every leg's
  `SendState` carries `last_sent` through `sending` and `failed`
  (`recordSend`, one place for all four). The Buttondown retry, the website
  page's audio and email URL, the archive's email record, the email's
  "Listen to it", and verification read it (`lastSent`,
  `src/shared/sends.ts`). A failed podcast re-render no longer erases the
  episode's audio, and a Buttondown send cut off mid-flight is retried as
  an update of the same draft. A failed card's strip says `Last good:`
  with when and a link to the draft, mp3, or commit. Review 2026-09-27,
  §2.1.
- **Buttondown is asked before it is changed** (2026-09-28) — the leg
  reads the email's status (`getEmail`) before it PATCHes the draft it
  made: `about_to_send` / `in_flight` answer 409 "Buttondown is delivering
  it now" and record nothing; `sent` answers 409 unless `?web_copy=1`, and
  a web-copy update is logged (event log and service log); `draft` /
  `scheduled` update as before; anything else is refused. A status read
  that fails is a failed send that changes nothing in Buttondown. The
  Buttondown check records the status it read (`verify.buttondown.
  remote_status`); once it is `sent`, the card's action is "Update web
  copy…" behind a confirm, and "Re-send all sent" / "Send the rest" leave
  Buttondown out. The `sent` refusal records `remote_status` itself
  (through `savedFresh`, keeping the check's findings) and carries
  `code: "email_sent"`: WT350 and WT351's checks predate the field, so
  their cards offered "Update draft" and a bulk run stopped at the 409
  before the archive. Now the card re-reads the issue on that refusal and
  switches at once, and the run carries on. Review 2026-09-27 §8 #7.
- **Verify after send** (2026-09-26, WT351) — each leg is read back from its
  destination once it goes out, and the Send card shows the result under
  VERIFY: the podcast's three files on the CDN at the rendered size, its length
  against the script, its chapters, and whisper listening to the episode
  (`backfill/assess.py --json`, numbers compared spelled out, a doubtful cue
  heard again on its own) with the pause before every section change; the
  website's live page, its embedded audio, the episode in podcast.xml, and a
  warning naming any image the page loads from off the CDN (review
  2026-09-27 §2.2), waiting out the deploy — until the page is this send's:
  it answers, carries the title, and, when the issue has audio, embeds this
  send's audio file (the previous build already carries the title, and a
  re-send after a podcast re-run was once judged on the old page, review
  2026-09-27 §2.3). A page still on the previous build within an hour of the
  send is `waiting`, looked at again every 5 minutes; after that it is
  judged as it stands. A text-only re-send has no such marker, so its check
  cannot tell the new build from the old one (the commit's check runs would;
  the GitHub token is documented as Contents-only, so they are not read);
  the Buttondown draft's status, subject, and body
  against the email edition (the subject as sent, template tags broken like
  the body's, review 2026-09-27 §3 — a draft sent before 2026-09-28 whose
  title carries `{{`, `{%` or `{#` shows a Subject warning until "Update
  draft"; every other draft's subject is unchanged), and once sent, Buttondown's delivery counts (never
  opens or clicks); the archive's corpus files against the issue, and the
  Librarian returning the issue's own passages. A leg still landing (scheduled,
  not yet indexed) is `waiting` and re-checks itself (`recheck_at`, re-armed on
  boot). Runs in the background after every send and on
  "Check again" (`POST /api/issues/:id/verify/:dest`); results live on
  `doc.verify`, never in a revision. Code: `src/server/verify.ts`.
- **Issue timing** (2026-09-26) — `GET /api/issues/:id/timing`: how long the
  issue took, from its event log (`src/shared/timing.ts`): Jamie's own acts
  only, sittings split at 30 min, the last "Published" as the real one,
  same-day fixing after it, time by section (events carry an `anchor` item id
  since schema v4; older ones match by name). Beside it, the Builder issue
  before and what shipped in WT Builder between the two (git log of `src/`).
  Send view panel; `made in …` on the index row. WT350 3 h 12 m + 57 m fixing;
  WT351 2 h 30 m + 5 m.
- **Put to bed** (2026-09-26, WT351) — `POST /api/issues/:id/bed {asleep}`;
  a published issue only; while asleep every non-GET to the issue answers 423
  except `/bed` and `/verify/*` (docs/decisions.md). Send view's last card,
  index chip, issue banner with Wake.
- **Published, derived** (2026-08-30) — an issue becomes `published` the
  moment its website and buttondown legs are both `sent`; nothing un-derives
  it. This is what keeps `lastPublishedNumber()`, the next-issue default,
  and the website's prior-issues index true after the first real send.
- **Creating an issue never replaces one** (2026-09-28) — `POST /api/issues`
  inserts only (`createIssueRow`): an issue's id is `wt<N>` for life and a
  renumbered one keeps it, so creating that number again is a 409 naming
  the issue that holds it, not an upsert over it. Only a taken id or number
  is that 409; any other constraint failure is an error, not "already
  exists". Review 2026-09-27, §1.1.
- **Write-back compare-and-set** (2026-08-30) — before replacing a bookmark
  or post, write-back fetches the record and refuses with `conflict` when it
  no longer matches the sweep's snapshot (or `gone` when deleted), so an
  edit made at the source between scans can never be silently overwritten.
  A read that fails writes nothing: the item is `failed` ("could not read
  the bookmark first — your edit is kept") until Retry (2026-09-28, review
  2026-09-27 §4; it used to write blind).
  A successful write moves the snapshot to what was written. Writes to one
  item run one at a time, each reading the item when its turn comes, and an
  item is marked synced only if it still says what was written; otherwise
  it stays `syncing` and the newer words are written too (2026-09-28,
  review 2026-09-27 §4). After three writes that each land stale it is
  `failed` ("it kept changing while it was written"). Every write-back
  route's `result` is the item's sync state as saved, never the source's
  raw reply, and the inspector leaves its error bar alone on `syncing`.
  **A conflict has a way out** (2026-09-28): the inspector's sync area
  offers **Keep mine** (`POST /api/issues/:id/items/:itemId/keep-mine` —
  re-read the source, make it the base, write the local copy over it) and
  **Take theirs** (`POST …/take-theirs` — adopt the source's fields and
  follow a section tag they carry), in place of a Retry the source would
  refuse again. Both refuse an item not in `conflict` (409) and change
  nothing when the source cannot be read (502). They also answer 409 and
  change nothing when the item was edited, or left `conflict`, while the
  source was being read. A failed or conflicted
  item from Pinboard or Micro.blog is a `sync` unit on the checklist.
  Review 2026-09-27, §1.2.
- **emails.json is merged, never rebuilt** (2026-08-31) — the website leg
  reads the site's live emails.json first and preserves every entry verbatim
  (unknown fields included), replacing only the issue being sent. It refuses
  the send when the file is missing, unparseable, or below the entries the
  archive is known to hold — since 2026-09-28 the last published issue's
  number (never under 349), not a fixed 349 that weakened every week
  (review 2026-09-27 §8). This closes the accidental-send finding: the
  index was once rebuilt from the Builder's sparser records, gutting 104k
  lines to 10k (commit 91688fc7, reverted). Since 2026-09-28 the merge
  happens inside the commit (`editTree`): the file is read, checked and
  merged as it stands at commit time, and again on a lost ref race, so a
  back-catalogue audio record committed while the leg was rehosting is kept
  rather than overwritten by the copy read before it. Review 2026-09-27,
  §2.3.
- **Front matter quotes every string** (2026-09-28) — the site page, the
  archive text, and the audio record write each string scalar as a JSON
  string (`yamlString` in `src/server/publish.ts`), which is always valid
  YAML. An arXiv title (`[2410.12345] …`) or one opening with a quote, `@`,
  `*`, `!`, `|` or `{` had broken the site build, and with it every later
  deploy. The back catalogue's front-matter reader JSON-unescapes. Held by a
  js-yaml round trip per indicator character in `tests/publish.test.ts`.
  DEL, the C1 controls and U+FFFE/U+FFFF are written as `\u` escapes:
  JSON leaves them raw, and PyYAML (librarian-thing's reader) refuses them
  even quoted, or folds U+0085 into a space. The site page also carries
  `templateEngineOverride: "md"`: the site preprocesses Markdown with Nunjucks, and a title with `{{` failed the whole
  Eleventy build while `{% if %}` in a comment printed nothing. Generated
  pages use no Nunjucks; the layout still renders as Nunjucks around them.
  Review 2026-09-27, §1.3.
- **Docs freshness gate** (2026-08-30) — tests/docs.test.ts fails the build
  when any doc cites a file path that no longer exists, or claims a test
  count (a number in prose only ever decays).
- **Sweep** — every Pinboard bookmark in the window (read/unread is Jamie's
  flag; the builder stopped selecting on it and writing it 2026-09-20 after
  WT350's 34 read-flag writes) and Micro.blog Micropub `q=source`, with
  the corrected Friday-to-Friday Central window. As of 2026-08-30 the sweep
  also reconciles the read side of the mirror: Pinboard and Micro.blog are
  the CMS, so edits made there are adopted when the local copy is untouched
  (`source_snapshot` is the merge base), two-sided edits surface as
  `conflict`, and a deleted source record drops the item from the issue at
  that re-scan (2026-09-20 — deleting the bookmark IS the editorial act; the
  words stay one row away in `revisions`). Until 2026-09-20 a `gone` copy
  was kept and refused write-back, which left deleted links in the issue to
  be removed a second time by hand.
  An item whose write-back landed while the scan ran (its snapshot moved),
  or is still in flight, is not reconciled or moved by that scan; the next
  one reads it afresh (2026-09-28, review 2026-09-27 §1.2). The price: an
  item stuck in `syncing` (a write that never finished) is skipped by every
  re-scan until a restart's `finishStrandedWrites` writes it.
  Opening a draft issue re-scans automatically, and Re-scan sits on the
  at-rest meta card as well as in the edit panel.
- **Event log** (2026-08-30) — every action on an issue is narrated to an
  append-only `events` table (its own table; the document rewrites wholesale
  on every save): sweep arrivals, source-side refreshes/gone/conflicts,
  edits, outline changes, channel flips, settings, write-backs, review runs,
  and sends. `GET /api/issues/:id/events`, newest first; the **Log** button
  on the meta card opens it as a sheet. Quiet re-scans (nothing changed) log
  nothing, so the auto-scan on open cannot bury the signal.

- **Ordering wand** (2026-09-20) — a wand on the Notable and Briefly headings
  asks the model for a sequence that reads better than bookmark order; the
  proposal shows numbered beside the current order with a one-line why and
  per-item notes where placement is not obvious; **Apply** moves the items,
  nothing moves otherwise. Validated server-side to a permutation of exactly
  the links offered. Routes: `POST /nodes/:id/order` (propose),
  `POST /nodes/:id/reorder` (apply, logged with the why).

- **Thingy's frame** (2026-09-20) — "From Thingy, my agentic librarian",
  linked to thingy.thingelstad.com, around Membership and Echoes: a sans block
  on the site (`.from-thingy` in weekly.thingelstad.com), an inline-styled
  block in email, and Thingy's own voice (nova) in audio. `VOICE_ID` records
  both voices. Heard in WT350's send (2026-09-20).

- **The back catalogue re-renders from its canonical text** (2026-09-26) —
  `npm run rerender:archive` merges each page (WT1–WT349 and 140-special)
  with the archive's `data/issues/{N}/archive.md`: body and editorial front
  matter from there; layout, permalink, tags and the audio record kept from
  the page. Dry run by default, with a diff per page in `tmp/rerender/` and a
  refusal when a page's own keys would change; `--commit` lands it as one
  commit. It and the daily backfill both commit through `editTree`, which
  applies each edit to the page as it stands at commit time, so neither can
  write a stale copy over the other. First run 2026-09-26: 350 pages, 103
  with repaired text (librarian-thing #64, #65 and the Sept 5 alt-text fix).
  Not automatic — run it after a repair lands in the archive. The spoken
  scripts in `backfill/scripts/` are not regenerated from it.
- **The back catalogue is being published, ten a day** (2026-09-22) — six
  calibration renders assessed by whisper (`backfill/assess.py`); the daily
  job (`scripts/backfill-daily.ts`, LaunchAgent `com.thingelstad.wt-backfill`
  at 02:15) renders the newest ten without a current edition against the live
  page on GitHub, verifies the CDN, commits the pages, checks the feed, and
  writes `tmp/backfill/reports/<date>.md`. Newest first: 349 → 1. Jamie chose
  ten a day over one bill (2026-09-22).
- **The back catalogue can be spoken** (2026-09-22) — `legacyBlocks()`
  (`src/shared/render/legacy-blocks.ts`) turns a `backfill/scripts/<N>.txt`
  into the assembler's blocks: section cues become title-only chapters on
  section boundaries, links and journal entries sit on item boundaries, lists
  get ordinals, tables are read by row, signatures are not read as hex.
  `renderAudio` takes an `Episode` (number, title, date, cover source) rather
  than an IssueDoc, so an issue never authored here can be rendered;
  `npm run backfill:audio -- --plan --all` parses all 350 at no cost, `--dry`
  renders to `tmp/backfill/` for a listen, `--write` puts the audio fields
  into the archive page. Not yet run for real: the calibration listen is next.
- **The spoken pieces are stored** (2026-09-22) — `speakCached` writes every
  new piece to `weekly-thing/tts/` on the CDN bucket before the local cache,
  and reads back from there on a miss; the 132 pieces already on disk were
  pushed. A lost `data/tts-cache/` now costs nothing. `backfill/` holds the
  frozen scripts for issues 1–349 and the retired transform that made them;
  the block adapter that reads them is the next step.
- **The audio edition, assembled** (2026-09-21) — after Jamie listened to
  WT350: one synthesized piece per script block, placed with silence by
  boundary (`PAUSE`), the two voices gain-matched, pieces cached in
  `data/tts-cache/`; ID3 chapters in the mp3, `chapters.json` (every link
  with its URL, photos as square chapter art) and a speaker-labelled WebVTT
  beside it, content-addressed. Bumpers gone; opener and close are script;
  quotes framed, lists spoken with ordinals, sections opened with counts and
  closed. **WT350 regenerated for real** the same evening: 110 pieces, 26:26,
  `weekly-thing-350-cf2b3845.mp3`; the website leg re-sent (d13cfa38) so the
  page and feed moved to it. Verified by transcribing the result
  (`uvx --from mlx-whisper mlx_whisper`) and measuring every structural pause
  ≥1.08 s where the old file had 0.0 s. Not yet listened to by Jamie. The
  site renders the chapters (`audio_chapters`) and a transcript panel that
  loads the `.vtt` from `audio_transcript_url` (weekly.thingelstad.com
  `apps/site/_includes/layouts/issue.njk`, the cue loop at :251-274, each
  cue set as text with no entity decoding).
- **Transcript text is WebVTT-safe** (2026-09-28) — a `<` in spoken text is
  written as `‹` in the `.vtt`, so the site panel and podcast apps show `‹`;
  a bare `&` stays, and `&` becomes `&amp;` only where it would read as a
  character reference; `-->` becomes `→`. `backfill/assess.py` reads `‹`
  back as `<`. Review 2026-09-27 §3; the rule is in
  `docs/rendering-contracts.md`.

- **Lost-edit protection** (2026-09-20) — every save keeps the replaced
  document in `revisions` (last 300 per issue; `npm run revisions`), and every
  handler that awaits the network — re-scan, photo upload, write-back,
  review, share, rehost, sends — applies its result to a fresh read instead of
  saving the copy it started from. Found the hard way: the auto re-scan on
  page open wrote its stale copy over two Currently lines.

- **Echoes as items** (2026-09-20) — the Echoes section holds `echo` items,
  each a thread, its citations, and a question for Thingy; the section wand
  on the heading offers up to five and **appends** the ticked ones
  (`POST /nodes/:id/echoes/draft` → `POST /nodes/:id/echoes`), a second run
  is told what is there and offers other threads; each echo's wand redrafts
  that one (up to three ways of saying the same thread, through the item
  draft route). Readiness names one chip per echo after its thread; the
  empty section owes its wand. Issues seeded before this lose their empty
  single-body seed on read; a body with words, and every published issue,
  is untouched. Run against WT351's draft and the Librarian for real.

- **Images leave the editions plain** (2026-09-20) — Micro.blog stores its
  photos as `<img src width height alt>` and the item mirrors that for
  write-back; the website and email editions strip `width`/`height` on the
  way out (`withPlainImages`, beside the rehost map in `finishEdition`), as
  every pre-builder issue was. WT350's email went out sized and the Journal
  photos overflowed in Mail. Fixed for WT351 on; WT350 is not re-sent.

- **OmniFocus project** (2026-09-20) — the meta card's OmniFocus button
  writes the issue's project as TaskPaper (`src/shared/taskpaper.ts`: Jamie's
  template trimmed to what is outside the builder, his date offsets kept,
  the builder's three dates filled in as absolute clock times) and hands it
  to OmniFocus through `omnifocus:///paste?target=projects`; ⌥-click copies
  the text instead. Retires the Drafts template and the Create OmniFocus
  Project shortcut. Not yet clicked into a real OmniFocus.

- **Re-send all sent** (2026-09-20) — on the Send view once any text leg
  has gone: re-runs website, Buttondown, and archive, in order, stopping at
  the first failure. Once the email has gone to readers, Buttondown is left
  out (2026-09-28). The podcast is left alone (re-sending it re-synthesizes
  what changed and publishes a new, content-named mp3 — the website leg must
  follow for the page and feed to move; its card does that on purpose). WT350's send day
  ended with an hour of re-sending those three by hand after two fixes.

- **Placement is Jamie's** (2026-09-20) — a link is placed once, when it
  arrives (tag, else described → Notable, undescribed → Briefly); after
  that only a move in the builder or a section tag put on the bookmark
  moves it. A description never re-files a placed link and the canvas
  no longer asks "stay, or move up" — on WT350's send day the rule moved
  links Jamie had placed and asked him three times.

- **Notable ↔ Briefly move** (2026-09-03) — a link's rail carries a move
  action (it takes the promote slot, which for a link was a permanently
  disabled button): Notable/Featured links move down to Briefly, Briefly
  links move up to Notable. The move is also a source edit — Briefly is the
  `_brief` tag on the bookmark, so the server adjusts tags and immediately
  writes back to Pinboard through the shared write-back path (snapshot moves
  on success; `gone` bookmarks move locally only; written links have no
  source and just move). Route: `POST /api/issues/:id/items/:itemId/section`.
  Exercised over HTTP in routes.test.ts; not yet clicked in a browser
  against a live bookmark.

- **Draft share** (2026-09-03) — Share on the meta card publishes the draft
  as one static page on the CDN (`weekly-thing/drafts/wt{N}-{token}.html`,
  unguessable token, `no-store`, `noindex`): a sticky DRAFT banner, Jamie's
  optional note to the reader, the rendered website edition, and a
  don't-pass-this-along footer. Re-sharing refreshes the same URL; Stop
  sharing deletes the page; a successful website send retires it
  automatically. The builder itself stays unshareable — this is the rendered
  snapshot leaving, never the app. Routes:
  `POST|DELETE /api/issues/:id/share`. Page rendering and routes are tested;
  the S3 upload has not yet run for real.

- **The edge** (2026-09-28, review §1.6) — the service has no auth and
  trusts the tailnet, so the door itself refuses what it cannot trust.
  Every refusal and stray error below is written to stderr, which launchd
  sends to `~/Library/Logs/wt-builder/wt-builder.err`, not `wt-builder.log`;
  `npm run watch` reads both.
  - A request whose target is not a URL is a 400 (the URL is parsed inside
    the handler's `try`, against a fixed base, never from the Host header).
  - An error nothing awaited is logged (`[process]`) and does not exit the
    service (`logStrayErrors` in `src/server/index.ts`;
    tests/service-process.test.ts boots the service and proves it). A
    process that survives an uncaught exception is not restarted by
    launchd (`KeepAlive` is `SuccessfulExit=false`), so one wedged by it
    needs a manual restart (`npm run deploy`).
  - A write that another site sends through Jamie's browser is a 403
    before routing (`guardEdge`, `src/server/edge.ts`): any method but GET
    and HEAD with an `Origin` that is not the tailnet URL, the Vite dev
    client, or loopback on the listening port, or with a `Sec-Fetch-Site`
    present and other than `same-origin`/`none`. Only an origin from
    `WT_BUILDER_ALLOWED_ORIGINS` passes whatever `Sec-Fetch-Site` says, so
    the env list can let in a caller the browser counts as same-site while
    a built-in origin marked cross-site is still refused. `Origin: null` (a
    sandboxed or file: page) is never allowed: listed in the env, it is
    dropped with a warning at boot. Scripts and curl send neither header
    and pass.
  - Against DNS rebinding, a Host that is not `otto.tail09aaf9.ts.net`
    (bare or `:10001`) or `localhost`/`127.0.0.1` on the listening port is
    a 421 for every method, reads included.
  - Every refusal is logged (`[edge] 403` / `[edge] 421`) with the values
    it refused — a 403 names both `Origin` and `Sec-Fetch-Site` — and
    `WT_BUILDER_ALLOWED_ORIGINS` / `WT_BUILDER_ALLOWED_HOSTS` extend the
    lists without a code change. Tested over HTTP and a raw socket in
    tests/routes.test.ts; not yet run against the tailnet, so the first
    live session after the deploy watches `wt-builder.err` (or
    `npm run watch`) for `[edge]`.
  - `DELETE /api/issues/:id`, which the client never calls, deletes only an
    unsent draft (no leg sent, in flight, or failed, and no live share
    page: unshare it first) and answers 409 for anything else. The document
    as it stood is kept in `revisions`, the one way back:
    `npm run revisions -- <id>` still lists a deleted issue's versions, and
    `--restore` recreates its row from the newest
    (tests/revisions-script.test.ts). Issue ids are `wt<number>`, so an
    issue re-created under the same number shares the deleted one's
    revision history.

## Not built

- ~~The 352px editorial review panel~~ — built 2026-08-28: shares the rail
  with the inspector (← Review swaps back), staleness hint, WHAT'S WORKING,
  grouped notes with kind badges and was→now, done/ignore with reopen and
  Show cleared, and PROOF notes that drop live when their substring is fixed.
- ~~Insert points and add affordances~~ — built 2026-08-28: hover insert
  points at section boundaries, `+ Currently entry` / `+ Write a link here`
  chips, and the tail row of absent sections. The outline's drag-reorder is
  also actually persisted now — it had silently done nothing.
- ~~Audio lens details~~ — built 2026-08-28 ("Dates spoken long, and the
  Briefly reversal is visible in the lens"): Briefly reverses visibly and
  dates are spoken long ("Saturday, August twenty-ninth"). This entry sat
  stale for two days after the commit landed — the same decay the send
  dispatch taught, and what finally earned the docs freshness gate above.
- ~~Pre-Builder issue records~~ — built 2026-08-28: all 349 imported as
  read-only records (scripts/import-prebuilder.ts, idempotent); the
  dashboard shows them with a PRE-BUILDER chip and their archive state.
- ~~Echoes archive retrieval~~ — built 2026-08-28: the wand retrieves from
  the Librarian, fails loud without it, and stores the citations it used.
- ~~Alt text for Journal images, written back to Micro.blog~~ — built
  2026-09-20: the wand on a Journal post looks at its pictures (one call,
  every image in order) and offers an alt per picture, each editable in the
  picker; **Use these** writes them into the post's own `<img>` tags
  (`withImageAlts` in `src/shared/body.ts`, every other byte of the tag
  kept) and the existing body write-back carries them to Micro.blog, so the
  site and the email get them through the same body. The Journal chip is
  *started* rather than done while a picture lacks alt, and says how many.
  WT350 shipped 11 of 12 without. Not yet picked against a live post.
- ~~Thingy's sign-off~~ — done 2026-09-20: the prompt says no sign-off and
  `stripSignOff` in `src/server/editorial.ts` makes sure of it on every
  Membership candidate, both branches. The frame says who is speaking.
- ~~Draft URL in the website front matter~~ — done 2026-09-20: a
  Buttondown `…/archive/untitled/` placeholder is never recorded as the
  draft's URL (`usableArchiveUrl` in `src/server/integrations/buttondown.ts`),
  so the website leg falls back to the numbered archive URL it knows until a
  re-send records the real slug.
- ~~Echoes are items, like Currently~~ — built 2026-09-20 (Jamie, after the
  first real Echoes): an `echo` item type (`body`, `ask`,
  `archive_references`), the Echoes node a real multi-item section still
  pinned last, the wand on the heading appends what Jamie ticks and can run
  again, each echo's own wand redrafts it in place, the three editions
  iterate the items inside one Thingy frame, and `echoBlock` moved from the
  composer to the renderers. WT350's single body still renders byte for byte
  (tests/echoes.test.ts holds both shapes). Verified live on WT351's draft:
  the section wand offered three, one appended and rendered in all three
  editions, the redraft offered three ways of saying it, the delete took it
  out. See **Echoes as items** under Working.
- **The log shows the change, not just that one happened** (Jamie,
  2026-09-20, after the revisions table landed). Today an `edit` line says
  "Edited body — Building"; with every replaced document now kept in
  `revisions`, the log can show was→now for the field, the way review notes
  already do. Not scoped yet; the data is there.

## The dry run — 2026-08-28, all four legs

- **Podcast: RAN FOR REAL.** WT350's draft script synthesized (tts-1-hd,
  echo), wrapped in the bumpers of the day, loudnorm-mastered, tagged with
  show art, uploaded: 68 seconds, 1.78 MB, verified 200 on the CDN. The first
  audio WT Builder has ever produced. (The bumpers were retired 2026-09-21.)
- **Buttondown: RAN FOR REAL.** Draft created (never scheduled, never sent),
  with 3 images rehosted to the CDN first. Re-sending updates the same draft.
- **Website: previewed.** The diff against the live repo shows exactly the
  archive page + emails.json. No commit — a real one publishes.
- **Archive: previewed.** The diff against the corpus repository shows
  exactly the canonical trio. No commit — a real one reaches Thingy.

What remains unrun is exactly the two commits that reach readers, and both
run on send day.

## Test artifact left behind

A 3 KB test image is on the CDN at
`weekly-thing/999/images/f778b1d5eccf.jpg`. It is a blue rectangle under a
fake issue number, uploaded to verify the pipeline. I could not remove it —
the AWS CLI session on this machine is expired and the service's credentials
live in `.env` rather than the CLI's profile. Safe to leave; safe to delete.

## Decisions taken this session

- The window is Friday 00:00 CT to Friday 00:00 CT, half-open, compared as
  instants rather than date strings.
- Micro.blog and Pinboard write-back are live, not read-only.

## Conflicts found in the design, and how they were resolved

The design was revised in layers and some earlier text survived. Each of these
was resolved by recency, using the sync history in `github.md`:

| Conflict | Resolution |
| --- | --- |
| Overview says one 264px right margin; Screens says two margins | **Two margins.** The 2026-08-27T20:33:39Z sync says structure moved back to a 76px left gutter. Record 0014 agrees. |
| Record 0012 is titled "One margin on the right" but its body specifies `76px │ 680px │ 250px` | Body wins; the title is stale. |
| 0012 puts notes at `left: 838px` | Spec's `left: 756px` wins — 838 is arithmetic from the old 158px gutter. |
| 0012's Consequences say "a 360px floor"; token list says "page 360–720" | **Fixed 680px.** A range is the exact failure the margin work exists to prevent. |
| Lens kicker `padding-left: 160px` | Uses gutter + 40px. The 160 was measured when the gutter was 158px. |
| `item-model.md` says the window ends Thursday | Superseded: the span ends Friday. |
| Two `Issue index` sections: the later one (line 47) forbids the kicker, lede, and footnote the earlier one (line 280) specifies | **The later one.** Sections at the top of the file are the newer additions — the same is true of `Send view`. |

## One thing the design did not say — settled 2026-08-28

The wand and a block's review notes both anchor to the top of the same row
in the editorial margin. Settled: during a read the margin belongs to the
notes, and the wand yields — hover-revealed in its reserved 24px inset, the
spec's own idiom for secondary chrome. Read closed, the wand returns.

## Still open, and deliberately not answered here

~~The content cutoff question~~ — settled 2026-08-28: the cutoff is always
midnight, Friday to Friday CT; a Friday-daytime capture belongs to the next
issue by intent. And the issue is dated its Saturday no matter when it
sends — a Sunday send dates back, never forward. See docs/decisions.md.
