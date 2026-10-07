# Share plan

> **Built 2026-10-06**, both steps of the build order, as planned here.
> `docs/status.md` (*Share*) says what exists and what has not yet been run
> against micro.blog; this stays as the plan and the reasons.

## What it is

Once an issue is **put to bed**, the editor's `Publish` button becomes
`Share`. Sharing is how an issue gets announced after it goes out, this week
or a year later, so it works on every sleeping issue, pre-Builder records
included.

An issue can have any number of shares. Each share is one row with one
destination, a little like a Currently entry, and it works like a task:
write it, do it, mark it done. Two destinations, nothing else:

- **LinkedIn** — WT Builder writes the text; Jamie copies it and posts it.
  LinkedIn is where nearly all sharing traffic comes from.
- **Blog post** — WT Builder posts it to micro.blog itself. The Weekly Thing
  reprints every blog post; this gives the blog a post pointing back at each
  issue, carrying what is only in the Weekly Thing.

## The Share view

`/{id}/share`, layered over the editor the way Send is. A list of the issue's
shares, newest first, and `New share ▾` with the two destinations.

A row shows the destination, its state (`draft` or `shared`), and its dates.
A draft can be deleted. A shared row is the record and stays. Sharing again,
later, is a new row.

## LinkedIn

Fields:

- **Text.** The link to the issue is the last line of the text, never a
  comment (Jamie, 2026-10-06: the link-in-comment workaround is "gross", and
  the research did not show it helps a personal profile). The editor marks
  where LinkedIn cuts the post at "…see more" and counts against its 3,000
  characters.
- **Link.** The issue URL with `?ref=linkedin`. The site already records
  `ref` for subscribe attribution, and Tinylytics shows it as the referrer.

Actions: **Copy text**, **Open LinkedIn** (the feed), **Mark shared**, which
asks for the post's URL and accepts none.

LinkedIn builds the preview card from the issue page's `og:image` (the cover
the podcast leg writes) and the dek. Nothing to generate.

## Blog post

Fields: an optional **title** and the **body**, which ends on the link to the
issue with `?ref=blog`. Category `Weekly Thing`, always.

**Post** shows the post as it will go up and asks once, then creates it through
Micropub `h=entry` with the credential the Micro.blog integration already
holds. The post's URL is recorded and the share becomes `shared`; a shared blog
share has no Post button, so a second post is a deliberate new share.
It is posted now, never back-dated. micro.blog cross-posts it wherever Jamie's
blog cross-posts.

**It must never appear in the next issue.** The post lands inside the current
draft's window, and the Micro.blog sweep would offer it to Journal. The sweep
skips any post whose URL a blog share recorded (`sweepMicroblog` gets the set).
Not by category: Jamie writes his own `Weekly Thing` posts, and those belong in
Journal (WT352 carried one).

## The wand

One wand per destination, both from the first build. Like every wand, it
offers three candidates and never writes; Jamie picks one and edits it, and the
words are his: no Thingy byline (`docs/decisions.md`; the byline boundary).

- **Grounding.** A builder issue: title, dek, Intro, Notable commentary,
  Currently, the photo caption (`issueExcerpt` in `editorial.ts` is the
  start). A pre-Builder record: its published text, read as text, never
  parsed into items.
- **LinkedIn: lead with the strongest Notable.** Jamie, 2026-10-06: "pick the
  strongest notable link and really lead with that", a light edit of it for
  LinkedIn, then a lead into the whole issue. Each of the three candidates
  leads with a *different* Notable item, so picking a candidate is picking
  the lead, and the candidate names which one it is. The candidate is:
  1. **Jamie's commentary on that link, lightly edited.** His sentences,
     kept: trimmed to stand on their own, the linked piece named by title and
     source in words (the post carries one link, the issue's), the opening
     lines strong enough to survive "…see more". Not rewritten into a new
     voice.
  2. **A short turn to the issue.** A sentence or two on what else this week
     holds, from the title, dek and the other sections.
  3. **The link to the issue.**

  No hashtags, no engagement bait. A pre-Builder record has no items: the
  wand takes the strongest commentary passage from its text instead.
- **Blog post.** The voice of his microposts: what this issue had that the
  blog did not, ending on the link.

## Where the code changes

- **Storage.** A `shares` table (id, issue id, destination, state, title,
  text, created, updated, shared, evidence URL), outside the issue document. Put to bed
  freezes the document and the shares are not part of it.
- **The door.** `guardBed` lets `/api/issues/{id}/shares…` through, as it does
  `/verify/`. Every other write to a sleeping issue is still a 423.
- **Names.** The pre-send draft page is already "share" in code (`share.ts`,
  `draft_share`). This is `shares` (`src/shared/shares.ts`); the two never
  meet, since a website send retires the draft page.
- **MCP.** Shares are readable through the MCP, so an agent can set them
  beside Tinylytics and say what a share brought in: `get_issue` carries the
  issue's shares, and a `list_shares` tool lists them across issues
  (destination, state, created and shared times, the issue URL and its `ref`,
  the evidence URL, and the text). Read-only through `readRoute` like every
  tool; bump `MCP_VERSION`. Tinylytics joins on the issue's path, the
  referrer (`linkedin.com`, `www.thingelstad.com`) and the shared time, so one
  `ref` per destination is enough. If two LinkedIn shares of one issue ever
  need telling apart, per-share `ref` values are the fix.
- **OmniFocus.** The "Share WT{N}" task in `taskpaper.ts` becomes one step that
  links to the issue's Share view. Its Reddit and LinkedIn Shortcut steps go;
  the Shortcuts themselves stay until Jamie retires them.
- **Docs.** `status.md`, `interface-spec.md` (the Share view), `decisions.md`
  (shares sit outside put to bed) and `service-contracts.md` (the routes), in
  the same commit as the code.

## Build order

1. Share view, `shares` table, the door, the LinkedIn share and its wand,
   shares in the MCP, the TaskPaper change.
2. Blog post share and its wand, the Micropub create, the sweep skip.

## Left out on purpose

So it stays small. Any of these can come back when there is a reason.

- Other destinations: Reddit (no engagement), Mastodon and Bluesky (no
  following; they get the blog post through micro.blog anyway). Turning off
  micro.blog's feed cross-post of the Weekly Thing is Jamie's setting.
- Link in a LinkedIn comment.
- ~~A `Share` button on the index rows~~ — added 2026-10-07 at Jamie's ask, on put-to-bed rows.
- A `dropped` state, back-dated blog posts, a cover-photo toggle, a choice of
  category.
- Per-share `ref` values, traffic shown on the row, a reminder to answer
  comments, a LinkedIn Post Inspector link.
- Sharing a single item, generated card images, LinkedIn document posts.
