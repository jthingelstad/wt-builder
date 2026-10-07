# Integration boundaries

## Pinboard

- Imports candidate links and tags.
- The sweep requests the window's true Central instants in UTC, padded an
  hour each side, and then filters on `inWindow` — the same authority the
  Micro.blog sweep and the renderers use. The window is never approximated
  as midnight UTC.
- WT Builder can author and edit commentary directly.
- Supported edits sync automatically, compare-and-set: write-back reads the
  bookmark first and writes nothing when it has changed at Pinboard since the
  last scan (`conflict`, resolved with Keep mine or Take theirs) or been
  deleted (`gone`). See [`decisions.md`](decisions.md), *Revisited 2026-09-28
  — the source is the second editor*.
- Local edits survive transient API failures.
- The `_brief` tag (one underscore) is Jamie's filing mark: on, the link is
  Briefly. A link is placed once, when it arrives: the tag wins; otherwise
  **no description** is Briefly (nothing to say about it yet) and a described
  link is Notable. After that, where Jamie put it is where it goes: moving a
  link between Notable and Briefly in the builder adds or removes `_brief` on
  the bookmark through the normal write-back path, and putting a section tag
  on the bookmark at Pinboard moves it here at the next re-scan. Writing a
  description never moves a placed link and nothing asks (2026-09-20: the
  description rule re-filed placed links and asked three times on WT350's
  send day). A bookmark deleted at Pinboard is dropped from the issue at the
  next re-scan.
- **`_exclude`** is the other mark. Holding a link out of the issue (the X on
  its rail) writes `_exclude` onto the bookmark, so the exclusion lives where
  Jamie files and survives a rebuild; a bookmark carrying it is never swept
  in; putting it on at Pinboard holds a placed link out at the next re-scan,
  and taking it off puts the link back. Deleting the bookmark is still the
  stronger act.
- **Read/unread is Jamie's flag, not the builder's.** The sweep takes every
  bookmark in the window whatever its read state, and write-back hands
  `toread` and `shared` back as they stand at Pinboard when it writes, never
  set by the builder. Until 2026-09-20 it swept the unread queue only and
  marked a bookmark read when its commentary was written or it was held out.
  **Placement follows the bookmark:** when a re-scan finds the
  tag changed at Pinboard and no local tag edit is pending, the link moves
  section to match. (Until 2026-09-20 the builder looked for `__brief` and
  filed unmarked links in Briefly; the old spelling is still read.)

## Micro.blog

- Reads through the Micropub **`q=source`** endpoint, which returns the exact
  Markdown a post is stored as. The blog's JSON Feed returns *rendered* content
  and cannot be handed back in an update, so it is not used.
- `/posts/all` is the **timeline** — everyone Jamie follows — and must never be
  swept into an issue.
- Writes back through the Micropub `update` action, compare-and-set on the
  same terms as Pinboard: a post edited on the blog since the last scan is not
  replaced but marked `conflict`. Editing a post's title or body in WT Builder
  edits the post.
- **Creates one kind of post** (2026-10-06): a share's blog post announcing a
  published issue, through Micropub create (`createPost`: a JSON h-entry,
  `content`, optional `name`, category `Weekly Thing`, never a `published`
  date, so never back-dated). The new post's URL comes from the `Location`
  header and is recorded on the share; an answer without one is a failure.
  Every other write is an update of a post Jamie made.
- **The sweep skips a share's post** by URL (`sharedBlogUrls`, compared
  without scheme, case or trailing slash), never by category: Jamie's own
  posts about the Weekly Thing still belong in Journal (`docs/decisions.md`).
- Original posts remain canonical for the blog. Inclusion, exclusion, ordering,
  promotion, and WT-specific presentation are owned by WT Builder.
- Post bodies carry raw `<img>` tags. Trailing images are split off for display
  and rejoined on commit, so Jamie edits the words and the picture stays a
  picture.

## Thingy / Librarian

Thingy is a generation service WT Builder calls during assembly.

- Membership: generates an attributed CTA from supplied campaign facts.
- Echoes: retrieves archive context per anchor item of the current issue,
  across the issues, the blog and the podcast (`scope: 'all'`, contract
  4.12.0), plus at most two passages from this week in past years
  (`filters.calendar`) as a light hint, and writes an attributed closing
  note connecting this issue to the archive — primarily Weekly Thing
  issues; blog and podcast citations when the echo lives there. See
  `service-contracts.md`, "Echoes retrieval".
- The link wand's "Linked before in WTn" is not a Librarian call: it reads
  the local issue records (`/retrieve` has no link lookup).
- The corpus holds none of Thingy's words: the Librarian strips the
  `.from-thingy` frame at build, so nothing here filters retrieved text.
- Every `/retrieve` call names itself (`caller: 'wt-builder'`) for the
  Librarian's log. The verify leg's "Retrievable by Thingy" asks for its
  issue exactly (`filters.issueNumber`).
- Generation must preserve citations/provenance for Jamie's review even if the
  public rendering omits technical retrieval details.
- Both call the archive's retrieval endpoint. It is a server-side call with a
  service credential and is never reachable from browser code.

## Archive

The archive holds the corpus Thingy answers from. It is a separate repository,
`librarian-thing` — renamed from `studio-thing` and streamlined to the
Librarian API and corpus on 2026-08-28.

- The archive is not a publishing destination. See [`decisions.md`](decisions.md).
- After an issue publishes, WT Builder sends its text to the archive so Thingy
  can retrieve and cite it.
- The send is a direct commit into the archive repository, scoped to
  `data/issues/{N}/`, rather than an API call. See [`decisions.md`](decisions.md).
  The target repository is `WT_BUILDER_ARCHIVE_REPO`.
- The send is asynchronous and non-blocking. It has its own evidence and retry
  and is never a readiness gate. A failed archive send means the issue is
  published and Thingy does not know about it yet.
- Send text only. The archive receives no audio.

## Buttondown

- Receives a rendered draft.
- Draft creation/update is distinct from scheduling or sending.
- An email is updated only while Buttondown says it is a `draft`; any other
  status refuses the update (Jamie, 2026-09-29; `docs/publishing-lifecycle.md`)
  unless the send says `?force=1`, the card's **Update anyway…**. The update
  sends subject and body only, never a status.
- Buttondown-specific Liquid and components belong only in the email renderer.
- Analytics are read issue-level only: delivery counts, `complaints` and
  `unsubscriptions` for the Buttondown check. Opens and clicks are not read.

## Postmark DMARC Digests

- thingelstad.com's DMARC record sends aggregate reports to Postmark
  (`rua=mailto:…@dmarc.postmarkapp.com`); the Buttondown check reads them
  back with `POSTMARK_DMARC_TOKEN` (`X-Api-Token`).
- GET only: `/records/my/reports` (by date, `next_url` pages) and
  `/records/my/reports/:id`. The API can also rotate the token and delete
  the record; WT Builder calls neither.
- Reports count messages per sending source, never per recipient.
- Each row has `host_name` (trailing dot), `source_ip`, `count`, raw
  `spf_result`/`spf_domain` and `dkim_result`/`dkim_domain`, and the
  aligned `policy_evaluated_spf`/`_dkim`/`_disposition`. Buttondown's mail
  arrives as `*.mtasv.net` with SPF domain `pm-bounces.thingelstad.com`;
  Jamie's own as `*.messagingengine.com` with `thingelstad.com`. Some
  providers send a blank row with `count: 0`.

## Spam blocklists

- DNS lookups only, never HTTP: every domain the email prints, before the
  email leg and with the link check (`src/server/domain-check.ts`).
- Spamhaus DBL through the free Data Query Service:
  `<name>.<SPAMHAUS_DQS_KEY>.dbl.dq.spamhaus.net`. Free for non-commercial
  use at low volume; sign up at
  https://portal.spamhaus.com/auth/account-setup?ps=free_dqs_product.
- URIBL at its authoritative nameservers (`multi.uribl.com`'s NS), since
  public resolvers are refused. No account.
- Each list proves itself on its own test domain (`dbltest.com`,
  `test.uribl.com`) before a run trusts it.

## Images

- Remote images referenced by an item are copied to `files.thingelstad.com`,
  resized to 1200px wide and re-encoded, before an issue is sent. Micro.blog
  serves originals: a photo shown at 600px arrives as a multi-megabyte JPEG,
  which is what makes an email enormous.
- A photo dropped on the canvas takes the same path. Its timestamp and
  coordinates are read from EXIF **on the server** — the browser only knows when
  the file was copied, not when it was taken. The coordinates are reverse
  geocoded to a place name — "Falcon Heights, MN"; "Barcelona, Spain" —
  through Nominatim (OpenStreetMap, keyless, one call per upload; Jamie
  changed the coordinates-only decision 2026-09-03). A failed geocode keeps
  the coordinates, and the field stays editable either way, so a wrong name
  never has to survive review.

## Draft sharing

- A draft can be shared before it sends: one static HTML page on
  `files.thingelstad.com` under `weekly-thing/drafts/`, addressed by an
  unguessable token. The page is loudly labeled DRAFT (banner and footer)
  and carries Jamie's optional note to the person it was shared with — the
  deterrent against forwarding is social, the revocation is real
  (`Cache-Control: no-store` plus deletion on unshare).
- The builder itself is never what gets shared — it has no auth layer and
  holds write credentials. Only the rendered snapshot leaves.
- Re-sharing refreshes the same URL. Stop sharing deletes the page. A
  successful website send retires the share automatically, so a published
  issue never keeps serving a page that says DRAFT.
- The share page never feeds the archive or the corpus; the send legs do
  not know it exists.

## Website

- Receives the website edition through a versioned handoff that WT Builder
  builds and commits.
- `weekly.thingelstad.com` remains a downstream render surface. It renders what
  it is given, including the audio feed, and holds no publishing logic.
- The handoff carries an audio reference, never an audio file.

## Audio

- Receives ordered spoken blocks from item renderers, each on a named boundary.
- WT Builder owns audio end to end: script, synthesis, pauses, cover,
  chapters, transcript, normalization, upload, and metadata.
- The rendered file is uploaded to `files.thingelstad.com` and lives only
  there. It is never committed to a repository.
- The website publishes the reference and renders the podcast feed from it.
  Stamp `audio_url`, `audio_duration_seconds`, `audio_voice`,
  `audio_byte_size`, `audio_chapters_url`, `audio_transcript_url`, and the
  `audio_chapters` list into the issue record at publication so the website
  edition needs no second source.
- **TTS is OpenAI** (`tts-1-hd`), one call per script block, assembled with
  placed silence, then mastered with a two-pass ffmpeg loudnorm to broadcast
  levels and tagged with ID3v2.3, chapters, and attached cover art. Studio's
  pipeline was not reused.
- Files are named by content (`weekly-thing-<N>-<hash>.mp3`) because the CDN
  serves them immutable; the website leg must re-send after a regeneration.
- Every spoken piece is stored on the CDN bucket under
  `weekly-thing/tts/<key>.mp3`, its key naming model, voice, speed and text
  (`TTS_STORE_PREFIX`, `speakCached` in `src/server/integrations/audio.ts`).
  `WT_BUILDER_TTS_CACHE` places the local cache of that store (default
  `data/tts-cache/`). Deleting it costs downloads, not synthesis: a piece
  missing locally is read back from the store, and only a piece never said
  is synthesized (2026-09-22, see `decisions.md`).
- There are no bumpers. The opener and the close are script (2026-09-21).

## Secrets

All credentials are server-side managed secrets. They never appear in browser
code, fixtures, logs, Shortcut exports, or this public repository.
