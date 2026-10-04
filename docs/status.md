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
  click-to-jump. Since 2026-10-04 a unit can be **waiting** on the sections it
  is made from (`src/shared/dependencies.ts`; the map is in
  `docs/mcp-plan.md`, Part A): hollow tick, "Waiting on …" tooltip, a count in
  the readout, WAITING in the checklist. The item and Echoes draft routes
  refuse a waiting unit with 409 `waiting` unless `?force=1`, which drafts
  and logs "Override — drafted … before … was done"; the editor confirms
  first.
- **MCP interface, read-only** (2026-10-04) — `/mcp` on the service's own
  port (`src/server/mcp.ts`; plan `docs/mcp-plan.md`, Part B): stateless
  Streamable HTTP, JSON responses, eight tools (`get_status`, `list_issues`,
  `get_issue`, `get_item`, `render_issue`, `get_review`, `list_events`,
  `get_timing`), all `readOnlyHint`. Every tool reads through `readRoute`,
  which runs GET routes only, so no tool can write, call a model, or reach
  GitHub. Behind the edge like every route (a foreign Host is 421, a
  browser Origin from another site 403), and on the tailnet as the editor
  is. Registered in Claude Code at user scope as `wt-builder`. Tested with
  the SDK's client in `tests/mcp.test.ts`.
  After three adversarial rounds the same day (interface 1.2.0; 1.3.0
  adds gift links to the link check): it reads
  without persisting (`readOnly` on the route context, so the skeleton
  repair a GET saves for the page is not saved for an agent); it answers
  POST only (405 otherwise, so no event stream is held open) and refuses a
  JSON-RPC batch (one request of 500 calls held the event loop 24 s); it
  pages events past the 500 the page shows (`events?all=1`); it names an
  issue through `GET /api/issues?heads=1` (id, number, date, status; no
  readiness), which took a call from ~245 ms to ~15 ms of event loop; it
  withholds draft-share links and scrubs stored error text; four prompts
  (`finish_draft`, `briefly_pass`, `proof_issue`, `compare_with_last_week`);
  and every call is one `[mcp]` line in the service log, including a call
  the SDK rejects before the tool runs, so `npm run watch` shows an agent
  reading the issue. First used on a real draft riding along on WT352
  (2026-10-04, `docs/mcp-ride-along-wt352.md`); 1.4.0 the same day adds
  time (`docs/mcp-ride-along-plan.md`, Part A): a `cursor` on every read,
  `get_status since=` with the items touched, the pills that moved (from →
  to) and Jamie's focus, item- and section-scoped `render_issue`, review
  notes that know they were answered (`fixed_as_suggested`,
  `changed_since_review`), `overdue_by_days`, and a `ride_along` prompt.
  Two read-only routes back it: `GET /api/issues/:id/version` (the issue at
  an event or at the review, from `revisions`) and `?item=`/`?section=` on
  the render route. Event summaries now name Intro, Outro, Haiku and
  Membership by section. 1.5.0 the same day adds row hints
  (`src/shared/hints.ts`, Part B), shown alike in the editor and through
  `hints` on `get_status`, `get_issue` and `get_item`: an amber mark under
  the rail for an open link finding (Jamie expected one on WT352's expired
  Verge gift link), a faint one for a title still ending with the site's
  name (until he edits it; `title_edited` on the item), and a line under
  words that stop mid-sentence or a Currently line under six words, hidden
  while the row has the caret. Never a gate; no pill moves. 1.5.3 adds a
  `haiku` hint: a haiku that does not count 5-7-5, with the counts.
- **Haiku counted 5-7-5** (2026-10-04, plan item 2) — WT352's generated
  haiku was not 5-7-5 and nearly went out. `src/shared/syllables.ts`
  counts syllables from spelling. The haiku wand asks for strict 5-7-5,
  counts every candidate, asks once more for the ones that miss (with their
  counts), and offers only drafts that pass, or says in a sentence that
  none did. A hand-written miss gets an amber `haiku` row hint with what it
  counted, and the review's proof pass adds a PROOF note (whole haiku as
  `was`, no `now`: the fix is Jamie's; the margin shows no was→now line
  without a `now`). Warn, never block. Tested with the model stubbed.
- **Inspector** — fields per type, editions with locked channels and their
  reasons, provenance, archive references. A Thingy item still shows a
  Reviewed / Mark draft toggle, but it gates nothing: picking or writing the
  words is the review, and the strip counts the item done when it has words
  (2026-09-20, `docs/decisions.md`, *Picking is the review*).
- **Editorial review** — the summary bar and margin notes, measured and
  stacked. Run for real against Claude; the notes were good.
  **Apply** (2026-10-04): a PROOF note with a fix carries `Apply <change>`
  in the panel and the margin; one click makes it in place through `POST
  /api/issues/:id/proof` (written back like a hand edit, logged as an
  edit), the note drops because its words are gone, and **Undo** shows for
  a few seconds. **Apply all** in the PROOF header when two or more apply,
  reporting what it could not. Words found twice or across fields show only
  Show me; a refusal turns the button into "Words changed — Show me".
  Tested offline (unit, route, and browser on WebKit and Chromium); not yet
  used on a live issue.
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
  `?force=1`, the deliberate escape for an issue with no audio (the card's
  **Commit without audio…** since 2026-09-29) — and every
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
  Since 2026-09-28 the view cannot surprise (review 2026-09-27 §2.4):
  every bulk run ("Send all four" / "Send the rest", "Re-send all sent")
  asks first with a `confirm` naming its legs in run order, and "← Issue"
  stops a run between legs. A leg the server shows out (`sending`, under
  the ten-minute in-flight window, `IN_FLIGHT_MS` in `src/shared/sends.ts`)
  disables every send button, and the view re-reads the issue until it
  lands, at three seconds backing off to thirty; an older `sending` is
  stranded and blocks nothing. A failed send re-reads the issue, so the card
  goes DID NOT SEND; the view re-reads it on opening; the evidence comes
  from the issue, so it survives a reload. It lies over the editor, which
  stays mounted and inert; the editor's open-scan is skipped under it and
  once any leg has gone. Every API answer carries `X-WT-Builder-Build`,
  read from the `build-id.txt` a build writes beside the client, and a tab
  whose own build differs shows "WT Builder was updated" with Reload. A
  missing `/assets/*` file is a 404, not the app shell.
- **A failed cover fetch keeps the live banner** (2026-09-28) — when the
  issue's photo cannot be fetched, `buildCover` still squares the show art
  for the mp3, but uploads it as `weekly-thing/{N}/cover.jpg` only when no
  banner is there yet (one HEAD against the bucket), so a re-send never puts
  show art over a real cover and a first send never leaves the page pointing
  at a missing one. (The back catalogue never uploads a banner: `banner:
  false`.) A HEAD that fails for any reason but a 404 — a 403, a network
  error — counts as "there", so nothing is uploaded and the service log only
  warns ("could not tell whether … exists"): on a first send that can leave
  `cover.jpg` missing, with nothing on the card to say so. Review
  2026-09-27, appendix (Audio).
- **The script read starts with a mechanical lint** (2026-10-04, plan
  item 3) — the model missed WT352's "The Replacements)". Before the model
  reads it, `POST /api/issues/:id/script/review` runs
  `src/shared/render/script-lint.ts` over the rendered script: unbalanced
  `)` `]` `(` `[`, a `](`, URLs, Markdown residue (`**`, `_x_`, `#` or `>`
  at a line start, backticks, `![`), HTML tags and entities, emoticons and
  emoji. Its findings (`mechanical: true`) lead the review; a model finding
  on the same block and words is dropped; every finding names its item or
  section (`anchor`, `where`), and the Send view shows the name. The
  representative issue's script lints clean, as did WT350 and WT351; WT352's
  finds its ":-)". MCP 1.5.4 counts them (`script_review.mechanical`).
- **The server holds the podcast to the approved script** (2026-09-28) —
  the gate was the client's alone, and the server synthesized whatever
  script it held. A podcast send now needs `script_review.approved_at` on
  the script as it stands (same hash); otherwise a 409, before any
  synthesis or leg state. A podcast that has ever gone out is exempt, as
  on the card: any earlier good send (`lastSent`), so a re-send after a
  failed attempt asks for no second approval (Jamie, 2026-09-29; until
  then only a latest status of `sent` was). Review 2026-09-27, appendix
  (Audio). `?force=1` synthesizes it anyway (2026-09-29, *Every send gate
  can be overridden* below).
- **A failed leg keeps its last good send** (2026-09-28) — every leg's
  `SendState` carries `last_sent` through `sending` and `failed`
  (`recordSend`, one place for all four). The Buttondown retry, the website
  page's audio and email URL, the archive's email record, the email's
  "Listen to it", and verification read it (`lastSent`,
  `src/shared/sends.ts`). A failed podcast re-render no longer erases the
  episode's audio, and a Buttondown send cut off mid-flight is retried as
  an update of the same draft. Buttondown's draft id is read once
  (`emailOf`), falling back to the id a failed state from before
  `last_sent` carried, by the retry, the website page and index, the
  archive, and verify alike — none writes an empty `buttondown_id`.
  A failed card's strip says `Last good:`
  with when and a link to the draft, mp3, or commit. Review 2026-09-27,
  §2.1.
- **Buttondown is asked before it is changed; only a draft is edited**
  (2026-09-28; narrowed 2026-09-29) — the leg reads the email's status
  (`getEmail`) before it PATCHes the draft it made. `draft` updates as
  before. Every other status — `scheduled`, `about_to_send`, `in_flight`,
  `sent`, `imported`, anything new — answers 409 `code: "not_draft"`, "no
  longer a draft … can't be edited safely", and leaves the leg untouched,
  unless the send says `?force=1` (2026-09-29, below)
  (Jamie, 2026-09-29: the archive is not hosted on Buttondown, so a sent
  email has no copy worth editing; the `?web_copy=1` update and its
  "Update web copy…" action are gone, and `scheduled` is no longer
  updated). Every refusal is one event-log line ("Send refused —
  buttondown: …"), so `npm run watch` shows it. A status read that fails is
  a failed send that changes nothing in Buttondown; only those refusals
  skip the failure record — any other error in the leg, a 409 included,
  records `failed` rather than leaving `sending`. The Buttondown check
  records the status it read (`verify.buttondown.remote_status`); once it
  is anything but `draft`, the card shows why and offers only
  **Update anyway…** (2026-09-29), and "Re-send all sent" / "Send the
  rest" leave Buttondown out. The refusal
  records `remote_status` itself (through `recordVerify` — a fresh read
  with no revision, so a refused click never pushes a real edit out of the
  history — keeping the check's findings; with no check at all, only the
  fact, as `waiting` via `refusedNotDraft` — never `passed`, since
  subject, body and delivery were not read — and the real check is
  started): WT350 and WT351's checks predate the field, so the card
  re-reads the issue on that refusal and switches at once, and a run
  carries on past it. "Check again" keeps `remote_status` on its `running`
  record and on an `error` result, so the card does not flip back to
  "Update draft" while it checks; a check that reads `draft` again (an
  email unscheduled in Buttondown) gives the action back. Review
  2026-09-27 §8 #7.
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
  Librarian returning the issue's own passages (asked for that issue
  exactly, `filters.issueNumber`). A leg still landing (scheduled,
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
  index chip, issue banner with Wake. Since 2026-09-28 it is the only
  freeze. A published issue that is awake edits its text as a draft does,
  and its kicker says edits need a re-send. Asleep, the client offers no
  editable run, rail action, wand, field or write button, so the 423 is a
  backstop and never the message.
- **Published, derived** (2026-08-30) — an issue becomes `published` the
  moment its website and buttondown legs are both `sent`; nothing un-derives
  it. This is what keeps `lastPublishedNumber()`, the next-issue default,
  and the website's prior-issues index true after the first real send.
  A leg counts once it has ever sent (`lastSent`), so a failed re-send
  since does not hold the issue back; the Send view's Archive blocker and
  put-to-bed "Not sent" list read legs the same way, and the put-to-bed
  card names a leg whose latest attempt failed ("Last attempt failed"), a
  warning that does not stop it going to bed (2026-09-28: an email
  sent, a failed update of its draft, then the website, had left the issue
  a draft, with the locks, put to bed and the Archive all off).
- **A published issue keeps its number, date and window** (2026-09-28) —
  `POST /api/issues/:id/settings` refuses `number`, `publication_date` and
  `window_days` with a 409 once the issue is not a draft, and saves nothing
  from that request; title and dek still save. `POST …/sweep` refuses a
  non-draft before it fetches, and drops a scan that finds the issue
  published when it lands. The panel shows the three as facts and offers no
  Re-scan. A renumber had forked the site page, emails.json, the feed and
  the archive on the next re-send. Review 2026-09-27, §2.5.
- **Creating an issue never replaces one** (2026-09-28) — `POST /api/issues`
  inserts only (`createIssueRow`): an issue's id is `wt<N>` for life and a
  renumbered one keeps it, so creating that number again is a 409 naming
  the issue that holds it, not an upsert over it. Only a taken id or number
  is that 409; any other constraint failure is an error, not "already
  exists". Review 2026-09-27, §1.1. Nor is a second issue dated the same
  Saturday (2026-09-28): the create is a 409 naming the issue that holds
  the date, and the new-issue sheet says so and disables Create. With no
  date given the service, like the sheet, dates it the Saturday after the
  latest issue, and never a Saturday already past. On send day the default
  had been the issue just sent. Review 2026-09-27, §3.
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
  raw reply. On `syncing` the inspector adds no message of its own, though
  the saved document it absorbs first has already cleared a failed call's
  message from the bar.
  **A conflict has a way out** (2026-09-28): the inspector's sync area
  offers **Keep mine** (`POST /api/issues/:id/items/:itemId/keep-mine` —
  re-read the source, make it the base, write the local copy over it) and
  **Take theirs** (`POST …/take-theirs` — adopt the source's fields and
  follow a section tag they carry), in place of a Retry the source would
  refuse again. Both refuse an item not in `conflict` (409) and change
  nothing when the source cannot be read (502). They also answer 409 and
  change nothing when the item was edited, or left `conflict`, while the
  source was being read, and 423 when the issue was put to bed meanwhile
  (2026-09-28). A write-back whose turn comes after the issue is put to
  bed writes nothing (423, saying the item is saved here but not written
  to the source, and what writes it once the issue is woken: a restart if
  it is still `syncing`, Keep mine or Take theirs if it is in `conflict`,
  otherwise Retry). One put to bed while it is being written has
  reached the source, so its outcome is still recorded — the sync state
  and the snapshot of what the source now holds — and no word changes:
  bed freezes the words, not the record of the source. It is not written
  again while asleep; an edit that landed during the write stays `syncing`
  on the new base, and once the issue is woken a restart writes it with no
  conflict. A failed or conflicted
  item from Pinboard or Micro.blog is a `sync` unit on the checklist.
  Review 2026-09-27, §1.2.
- **The website commit is the issue page alone** (2026-09-29) — the site
  derives its issue index from the pages' front matter at build time
  (weekly's `apps/site/lib/issueIndex.js`), so the leg no longer sends
  emails.json. That file carried the same fields a second time, and every
  send read, merged into and rewrote it whole: 5 MB for one page. The
  machinery it needed goes with it: the merge that preserved every entry
  verbatim (2026-08-31, after the index was once rebuilt from the
  Builder's sparser records and gutted, commit 91688fc7, reverted), the
  refusal of a missing, unparseable or truncated file, the floor at the
  last published issue (review 2026-09-27 §7), and the merge inside the
  commit against a concurrent writer (appendix, Sending & verify). The page
  commits through `putTree`, the path WT350 and WT351 went out on.
- **Every send gate can be overridden** (2026-09-29) — Jamie: "There should
  be nothing that I cannot override. I'm the only user." Every gate on a
  leg takes `?force=1`: the podcast's script approval (`sendPodcast`,
  `scriptUnapproved`), the website's audio reference (`sendWebsite`),
  a Buttondown email that is not a draft, and a dead link on the website or
  email (2026-10-01, *Link check* below). While a gate holds, the card's
  one action is its override — named for what it skips, ending in `…`,
  plain `btn` rather than `btn primary` — and it asks with a `confirm`
  saying what going past means: **Send without approval…** (not read,
  read but not approved, or changed since it was read), **Commit without
  audio…** (the page has no episode until a re-commit after the podcast),
  **Update anyway…** (the strip and the confirm say what an update does
  for Buttondown's status: a sent email changes only Buttondown's copy and
  nothing is sent again, a scheduled one stays scheduled, one going out
  races the delivery). The Buttondown update is the same PATCH as a
  draft's — subject and body, never a status, pinned in
  `tests/integrations.test.ts` — so no override schedules or sends an
  email. Every override is one event-log line ("Override — podcast: …",
  "Override — website: …", "Override — buttondown: …"), and a forced
  Buttondown update finishes "updated while "sent", by override; status
  unchanged", so `npm run watch` shows it. `?force=1` on a leg whose gate
  is open is an ordinary send and logs nothing extra. The bulk runs never
  override: "Send the rest" still stops at an unapproved podcast, and both
  runs leave a non-draft email out and say so in their confirm. Without
  `force`, every gate refuses exactly as before.
- **Link check** (2026-10-01, librarian-thing's QA follow-up
  plan of 2026-10-01, §3; moved into the editor 2026-10-04, plan before
  WT353 item 1) — every link the issue prints
  (each Pinboard link's rendered URL, every link in commentary or a body;
  not images, not Thingy's items) is fetched and stored on the issue as
  `link_check` (`src/server/link-check.ts`). **Checked as it arrives**
  (`src/server/arrival-check.ts`): a save that brings in a link not checked
  yet (a sweep or sync, or a link typed into a body or commentary) starts a
  check in the background, 1.5 s after the edits settle, three fetches at a
  time; the save never waits, and answers `checking: true`, so the client
  looks again (GET the issue every 2.5 s) until it is false. The result goes
  onto a fresh read (the savedFresh rule) and logs one `links` event
  ("Checked as they arrived — …"). One answer per URL serves every issue for
  6 hours; a link the site would not answer for is asked again after 6
  hours. An issue put to bed or imported is never checked. There is no
  button: `POST /api/issues/:id/links/check` stays for a script, and nothing
  in the client calls it. **What Jamie can act on, and nothing else, is
  marked** (`actionOf` in `src/shared/link-findings.ts`): 404, 410, no such
  host and a redirect to the site's front page are **dead**; a shortener, a
  redirect or the page's own `rel=canonical` to **a different page** is
  **moved**, with a suggestion. Not findings: http→https on the same page,
  `www.`, a trailing slash, tracking parameters (`linkKey` says they are the
  same page), and a redirect to a sign-in, sign-up, subscribe or consent
  page. A suggestion never drops https, except where the https address
  fails (a TLS error or refused: bowlingalone.com's certificate is
  self-signed) and the http one answers; an http link whose https address
  fails is the right link and is not flagged, and one whose https works
  says so in the email's plain-http warning (`https: 'works' | 'fails'` on
  the result). 401/403/429/5xx and timeouts are **unchecked**: kept, never
  marked, never dead. Stored results from before 2026-10-04 are judged
  again by the same rule, so an old http canonical is not offered. A **gift
  link** (a paywalled site's share token: `view_token`,
  `unlocked_article_code`, `pwapi_token`, `gift`, and `accessToken` or `st`
  on the sites that use them; `giftOf` in `src/shared/link-findings.ts`) is
  read off the URL, before any check, with its expiry when the token is a
  JWT: a finding until kept, never a send gate (2026-10-04, after an expired
  Verge gift nearly went out in WT352). **A finding is its row's note**
  (`rowHints` in `src/shared/hints.ts`, Row.tsx): amber, under the words,
  opening the inspector. The "Links checked" readiness unit is done unless
  a row has something to act on, and then jumps to it. The inspector
  offers, per finding, **Use the suggested link**
  (`POST /api/issues/:id/items/:itemId/link` `{action: "use"}` — sets
  `canonical_url`, which the website, email and audio print; `source_url`
  is untouched; refused with 409 for a stored suggestion the rule above
  would not offer), **Keep as it is** (`{action: "keep", url}`), **Back to the
  bookmark's link** (`{action: "original"}`), and **Move bookmark…**
  (`POST /api/issues/:id/items/:itemId/move-bookmark`, click-only, with a
  confirm): Pinboard `posts/add` at the new URL with every field of the old
  record (title, extended, tags, date, toread, shared; `replace=no`, and
  refused if a bookmark is already there), then `posts/delete` of the old,
  and the item's `source_url`/`source_id` follow. A delete that fails is
  reported, not retried. The **website** and **Buttondown** legs check any
  link not yet checked before they go and refuse with
  `409 dead_links` while a dead link is not kept: the Send card's action
  becomes **Commit with dead links…** / **Send with dead links…**, and
  `?force=1` records the dead links as kept ("Override — website: … sent
  with N dead links"), so the next send does not ask. Moved links never
  gate. **The Send view has one line** for the link and email checks:
  green "Links and email: nothing to act on." when clear, amber naming each
  row with something open (a jump back to it in the editor) and what is the
  whole email's (its size, a listed domain no row prints). Offline
  (`WT_BUILDER_OFFLINE=1`) nothing is fetched and the check on arrival is
  off. The URL canonicalization shared with the Librarian's link index is
  `src/shared/links.ts`, its cases in `fixtures/canonical-urls.json`.
  Tests: `tests/links.test.ts`, `tests/link-check.test.ts`,
  `tests/link-routes.test.ts`, `tests/arrival-check.test.ts`,
  `tests/e2e/links.e2e.ts`.
- **Deliverability** (2026-10-01) — will the email reach the inbox.
  Three parts, each warn-don't-block except the one that has sunk an
  issue before:
  - **Blocklists.** Every domain the email prints (links, images, the
    membership button, the open pixel; grouped by registered name) is
    looked up by DNS (`src/server/domain-check.ts`): the **Spamhaus DBL**
    through the Data Query Service with `SPAMHAUS_DQS_KEY` (by host and by
    domain), and **URIBL** asked at its own nameservers (black and red are
    listings; grey is bulk mail and is not). otto resolves through
    Cloudflare, which every list refuses — Spamhaus answers
    127.255.255.254, URIBL 127.0.0.1, SURBL nothing — so each run first
    asks for the list's own test domain and leaves out any list that does
    not name it; a domain no list could be asked about is **unchecked**,
    never clean. Without the key the DBL is skipped and the card says
    "URIBL only". SURBL is not asked: its servers do not answer us at all.
    First live run 2026-10-01 with the key: both lists passed their test
    domains, and WT352's 30 domains came back clean in about half a second.
    Each domain is looked up as it arrives, beside the links
    (`src/server/arrival-check.ts`; one answer serves for an hour), and
    stored as `domain_check`; a listed one is said on the row that prints
    it. The **Buttondown** leg looks every
    domain up again before it goes (lists change by the hour; saved only
    when an answer changed, so a click adds no revision) and refuses with
    `409 listed_domains` while a listed domain is not accepted; the card's
    action becomes **Send with a blocklisted domain…**, and `?force=1`
    records it in `domain_check.accepted` for as long as it stays listed.
    The website leg is never stopped by it.
  - **The email itself** (`src/shared/deliverability.ts`, pure): a
    mostly-capitals subject, repeated "!"/"?", a "Re:"/"Fwd:" subject,
    plain-http links, links to a bare address or with "@" before the
    host, links straight to a download, link text naming another site
    than the link goes to, and a body over 80 KB of HTML (Gmail clips at
    102 KB with Buttondown's template, hiding the unsubscribe link).
    Warnings only, each said on the row that prints it (the subject's on
    the title row; the size, the whole email's, on the Send line);
    **Keep as it is** on the row
    (`POST /api/issues/:id/deliverability/keep` `{key, keep}`) stores the
    key in `deliverability.kept`. A plain-http link whose https address the
    link check found failing is not flagged. Spam trigger words are deliberately not
    checked: "free" is in every issue, and the prototype flagged every one.
  - **Complaints**, on the Buttondown check once the email has gone:
    Buttondown's issue-level `complaints` and `unsubscriptions` (never per
    reader), passing under 0.1% of delivered, a warning from 0.1%, a
    failure from 0.3% (Gmail's bulk-sender lines; Buttondown's count is
    only the providers that report complaints back, so it is a floor),
    with the four earlier issues' counts beside it. The counts are kept as
    `verify.buttondown.metrics` for the next issue to compare with (WT352
    onward; WT351 read 0 complaints, 10 unsubscribed). The check looks
    again every 6 hours for 72 hours after the send while complaints
    arrive (`settling`: a warning stays a warning, not `waiting`), and a
    restart re-arms any promised recheck, not only a `waiting` one.
  - **DMARC**, on the same check, with `POSTMARK_DMARC_TOKEN`: Postmark's
    DMARC Digests (`src/server/integrations/dmarc.ts`, GET only) for the
    48 hours after the send, grouped by sending source. The largest source
    is the newsletter (Postmark, `mtasv.net`: Buttondown sends through it):
    under 98% passing fails the check (p=reject turns failing mail away, so
    that is mail that never arrived). Another source is ours when raw SPF
    passed it for the From domain (Fastmail, `messagingengine.com`); one of
    ours failing over 2% warns. Every other source — forwarders, a
    recipient's mail filter re-sending the issue, spoofers — is listed with
    its failures and never counted. No reports yet is fine
    for 72 hours and a warning after. `dmarc_messages` / `dmarc_pass` join
    the kept metrics, with the earlier issues' rates beside them. Without
    the token there is no DMARC line and the health check says MISSING;
    a Postmark failure is a warning, never an error on the leg. First live
    read 2026-10-01 over WT351's window: 36 reports, 1,612 messages, 99.63%
    passing, Postmark 1,509 of 1,509. That read set the "ours" rule: a
    Check Point gateway (`cloud-sec-av.com`) re-sending to one recipient
    failed six of seven and would otherwise have warned every week; and
    wp.pl sends a blank row of no messages, now skipped.
  The "Deliverability" readiness unit (`kind: 'mail'`) is done unless a
  listed domain or a finding in the email is left open (a domain not
  looked up yet holds nothing), and jumps to the row that prints the first
  one. Tests: `tests/deliverability.test.ts`, `tests/link-routes.test.ts`,
  `tests/arrival-check.test.ts`, `tests/verify.test.ts`,
  `tests/e2e/deliverability.e2e.ts`.
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
  re-scan until a restart's `finishStrandedWrites` writes it. A restart
  finishes such writes on every issue that is not frozen — a draft, or a
  published issue still awake; one put to bed, or an imported record, is
  left as it is (2026-09-28: it had skipped every non-draft, and a
  published issue refuses a re-scan, so an edit made after publishing
  stayed `syncing` for good).
  Opening a draft issue re-scans automatically, and Re-scan sits on the
  at-rest meta card as well as in the edit panel, on a draft only. The automatic scan is
  skipped when the editor opens under the Send view (a link to
  `/<id>/send`), when it is uncovered from it, and once any leg has been
  sent or is out, so the legs of a run render the same issue (2026-09-28).
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
  `apps/site/_includes/layouts/issue.njk`, the cue loop at :252-279, each
  cue's entities decoded and then set as text).
- **Transcript text is WebVTT-safe** (2026-09-28; revisited 2026-09-29) —
  cue text carries the standard escapes, `&amp;`, `&lt;` and `&gt;`, which
  the site panel decodes before setting each cue as text. From 2026-09-28
  to 2026-09-29 a `<` was written as `‹` because the panel did not decode;
  Jamie decided it should. The site change must deploy before WT Builder
  sends a `.vtt` with `&lt;`. `backfill/assess.py` decodes the entities
  (and still reads an old `‹` back as `<`). Review 2026-09-27 §3; the rule
  is in `docs/rendering-contracts.md`.

- **Lost-edit protection** (2026-09-20) — every save keeps the replaced
  document in `revisions` (last 300 per issue; `npm run revisions`), and every
  handler that awaits the network — re-scan, photo upload, write-back,
  review, share, rehost, sends — applies its result to a fresh read instead of
  saving the copy it started from. Found the hard way: the auto re-scan on
  page open wrote its stale copy over two Currently lines.

- **Echoes reads the whole archive** (2026-09-29) — each anchor asks the
  Librarian (contract 4.11.0) across issues, blog and podcast, without the
  site pages or the last three issues; passages arrive labelled (WT312, AT1,
  a post's title) with absolute URLs, and grounding checks AT numbers and a
  blog post's issues. The corpus holds no Thingy text (stripped in
  librarian-thing), so `withoutThingy` is gone. The verify probe asks for
  its issue exactly. Not yet run against a live draft: WT352 is the first.

- **Echoes fails like a person would say it** (2026-10-04, after WT352's
  Librarian 429 reached Jamie as the Lambda's JSON) — every Librarian failure
  is an `ArchiveError` with a sentence and whether trying again helps
  ("The archive was too busy to answer. Try Echoes again in a minute.";
  timeouts, a dropped connection, 5xx, a refused key, a 409 contract), the
  raw answer kept for the service log only. Model failures from the SDK
  (429/529 busy, 5xx, timeout, connection, refused key) are said the same
  way for every wand and the review (`modelFailure`). While Echoes waits out
  a 429 the wand says "The archive is busy; trying again…" (the editor polls
  `GET /api/issues/:id/drafting` while an Echoes draft is out). A draft that
  fails, any wand, is a `draft` event on its item or section ("Draft failed:
  … — Echoes"), so the log and the MCP's `changes` show it (MCP 1.5.2).
  Tested with the Librarian's fetch and the model stubbed.

- **Echoes: this week in past years** (2026-09-30) — the one-year-ago
  issue that rode along as an excerpt (`pickSeasonalIssue`, the `seasonal`
  draft field) is gone. In its place a calendar pseudo-anchor asks the
  Librarian (contract 4.12.0) with the issue's own words and
  `filters.calendar` `{date: the issue's date, window_days: 7}`, across
  issues, blog and podcast with the same exclusions as every anchor. It is a
  hint (Jamie: "Calendar is less important for echoes than topics and
  themes"): at most two passages, pooled after the topical anchors, headed
  as a hint in the prompt, and it cannot carry a draft alone — Echoes still
  fails loud without a topical passage. Tested with the Librarian stubbed;
  not yet run against the live Librarian or a live draft.

- **Linked before** (2026-09-30) — the link wand says when this exact link
  was in an earlier published issue: "Linked before in WT274 (2024-01-27)",
  newest first, above the candidates in the attention colour, each number
  linked to its archive page; the draft prompt gets the same fact. The
  item draft route reads it from the local records (`linkedBefore` in
  `src/server/linked-before.ts`): every pre-Builder issue's published body
  and every Builder issue's printed items, the issue being drafted and
  anything dated on or after it excluded. Links compare without scheme,
  `www.`, fragment, trailing slash or tracking parameters (`utm_*`, click
  ids). About 20 ms a lookup over 351 issues. Tested over HTTP against a
  throwaway database; not yet run in the live service.

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
  the first failure. It asks first, naming the legs, and is disabled while
  the server shows a leg out (2026-09-28, review 2026-09-27 §2.4). Once the email has gone to readers, Buttondown is left
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

- **Section headings typed on the canvas** (2026-09-28) — an ad hoc
  section's heading saves as the node's label through
  `POST /api/issues/:id/nodes/:nodeId/rename`. The route existed and the
  client had never called it: the heading's commit was a no-op, so the edit
  looked saved and every edition published the old `## Section`. A promoted
  post's heading shows and saves the post's `title`, which is what the
  renderers print and what writes back to Micro.blog; its node label is not
  used. An emptied heading goes back to its saved text and sends nothing,
  and the rename route answers 400 for an empty or blank label: an empty
  heading published as `## `, and an empty promoted title left Micro.blog
  with the old name while the post read synced (Batch 5 review, B2). The
  Inspector's Title field was a second way in (round 2): cleared on a
  promoted post, it goes back to the saved title too, and
  `PATCH /api/issues/:id/items/:itemId` answers 400 for a blank `title` on
  an item in a promoted node, refusing the whole patch, so nothing reaches
  the issue or Micro.blog. A post in the Journal may still have no title.
  Underneath both, the renderers treat a blank title as a missing one and
  head the post with its node label, so no edition prints an empty heading
  whatever the issue holds. Review 2026-09-27, §1.5. Exercised in the
  browser tests (tests/e2e/headings.e2e.ts), routes.test.ts and
  render.test.ts; not yet typed into against a live post.

- **The edge** (2026-09-28, review §1.6) — the service has no auth and
  trusts the tailnet, so the door itself refuses what it cannot trust.
  The 403s, the 421s and every stray error below are written to stderr,
  which launchd sends to `~/Library/Logs/wt-builder/wt-builder.err`, not
  `wt-builder.log`; `npm run watch` reads both.
  - A request whose target is not a URL is a 400 (the URL is parsed inside
    the handler's `try`, against a fixed base, never from the Host header).
    This one refusal is answered but not logged: the handler logs only 5xx.
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
  - Every 403 and 421 is logged (`[edge] 403` / `[edge] 421`) with the values
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
  every image numbered; each alt names its picture, and an answer that does
  not name every picture exactly once is refused, 2026-09-28) and offers an
  alt per picture, each editable in the
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
  archive page + emails.json (since 2026-09-29, the page alone). No
  commit — a real one publishes.
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

**Known gap, open for Jamie (2026-09-28):** a re-scan, or any answer that
carries one (a write-back PATCH out when the scan lands), that moves the
row being typed in can lose that typing: WebKit gives no blur, so nothing
is saved, and Chromium loses what is typed after the move. A hold on the
scan's own answer was tried and withdrawn (Batch 5 review round 2).
