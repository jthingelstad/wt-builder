# backfill — the audio back catalogue

Every Weekly Thing issue gets an audio edition. Issues 350 onward are
synthesized from their IssueDoc by the audio renderer. Issues 1–349 were never
authored here, so their spoken scripts are kept in this directory instead.

## What is here

- `scripts/<N>.txt` — the spoken script for issues 1–349 and `140-special`,
  generated from the archive Markdown by `transform/`. **These are the source
  for the back catalogue**: what is said is what is in these files. They are
  committed so a transform change is reviewed as a diff of what will be said.
- `transform/` — the era transforms (`legacy.py` for issues ≤130, `modern.py`
  after; `common.py` shared), lifted from the retired Studio pipeline
  (`librarian-thing` at `de83efde^`), plus `regenerate.py`, which runs them:

  ```sh
  python3 backfill/transform/regenerate.py            # every issue, into scripts/
  python3 backfill/transform/regenerate.py 32 35      # just these
  python3 backfill/transform/regenerate.py --out /tmp/x 250   # somewhere else, to diff
  ```

  It reads the sibling website checkout (`../weekly.thingelstad.com/apps/site/archive/`)
  by relative path and needs nothing beyond Python 3. Issues from 350 on are
  authored in WT Builder and are never regenerated here.
- `script_status.json` — the retired validator's record per script as of
  2026-05-08 (zero errors). `old-manifest.json` — the retired pipeline's record
  of the 84 episodes it published (266–349). Both are history, kept for reference.

## What was changed on 2026-09-22

Regenerating from the transform as lifted reproduced issues 1–130 byte for
byte and gave 131–349 the "There are seven links this week. Link one of
seven." cue the transform gained after those scripts were last built. Two
fixes on top:

- issues 32–38 drew their sections as `---` rules with no headings, which the
  transform deleted before it looked; each rule now becomes the heading it
  stood for (`sections_from_rules` in `legacy.py`);
- `140-special` is spoken as "Special Thing 140", not "issue 140-special".

Fixes for how a script *sounds* (lists with ordinals, tables read by row,
signatures not read as hex) live in the block adapter,
`src/shared/render/legacy-blocks.ts`, so the scripts stay what the transform
says.

## The cue vocabulary the adapter reads

The transform emits a regular grammar the adapter turns into `ScriptBlock`s:

- `Now, the <Name> section.` / `Now, more links.` / `Now, for your information.`
  — a section boundary and a title-only chapter
- `That's the end of <Name>.` — the section closes
- `Link one.` … `Link twelve.` — an item boundary
- `Quote.` … `End quote.` — a framed blockquote
- everything else is a paragraph

See the plan in memory (`wt-audio-backfill-plan-2026-09`) and
`docs/decisions.md` for what was decided and why.
