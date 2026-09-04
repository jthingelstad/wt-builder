# Integration boundaries

## Pinboard

- Imports candidate links and tags.
- The sweep requests the window's true Central instants in UTC, padded an
  hour each side, and then filters on `inWindow` — the same authority the
  Micro.blog sweep and the renderers use. The window is never approximated
  as midnight UTC.
- WT Builder can author and edit commentary directly.
- Supported edits sync automatically using last-writer-wins.
- Local edits survive transient API failures.
- The `__brief` tag is Jamie's convention for a Briefly link (Shortcuts
  era). The sweep routes it to Briefly, and moving a link between Notable
  and Briefly in the builder adds or removes it on the bookmark through the
  normal write-back path. A `gone` bookmark moves locally only.

## Micro.blog

- Reads through the Micropub **`q=source`** endpoint, which returns the exact
  Markdown a post is stored as. The blog's JSON Feed returns *rendered* content
  and cannot be handed back in an update, so it is not used.
- `/posts/all` is the **timeline** — everyone Jamie follows — and must never be
  swept into an issue.
- Writes back through the Micropub `update` action, last-writer-wins. Editing a
  post's title or body in WT Builder edits the post.
- Original posts remain canonical for the blog. Inclusion, exclusion, ordering,
  promotion, and WT-specific presentation are owned by WT Builder.
- Post bodies carry raw `<img>` tags. Trailing images are split off for display
  and rejoined on commit, so Jamie edits the words and the picture stays a
  picture.

## Thingy / Librarian

Thingy is a generation service WT Builder calls during assembly.

- Membership: generates an attributed CTA from supplied campaign facts.
- Echoes: retrieves archive context per anchor item of the current issue
  (plus a deterministic same-week-last-year lens) and writes an attributed
  closing note connecting this issue to the archive — primarily Weekly Thing
  issues; blog and podcast citations are welcome when the echo lives there.
  See `service-contracts.md`, "Echoes retrieval".
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
- Buttondown-specific Liquid and components belong only in the email renderer.

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

- Receives ordered spoken blocks from item renderers.
- WT Builder owns audio end to end: script, synthesis, bumpers, cover,
  validation, normalization, upload, and metadata.
- The rendered file is uploaded to `files.thingelstad.com` and lives only
  there. It is never committed to a repository.
- The website publishes the reference and renders the podcast feed from it.
  Stamp `audio_url`, `audio_duration_seconds`, `audio_voice`, and
  `audio_byte_size` into the issue record at publication so the website edition
  needs no second source.
- **TTS is OpenAI** (`tts-1-hd`), chunked, then mastered with a two-pass ffmpeg
  loudnorm to broadcast levels and tagged with ID3v2.3 and attached cover art.
  Studio's pipeline was not reused.
- `WT_BUILDER_BUMPERS_DIR` supplies the intro and outro bumpers. **Unset means
  audio renders without them** rather than failing.

## Secrets

All credentials are server-side managed secrets. They never appear in browser
code, fixtures, logs, Shortcut exports, or this public repository.
