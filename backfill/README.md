# backfill — the audio back catalogue

Every Weekly Thing issue gets an audio edition. Issues 350 onward are
synthesized from their IssueDoc by the audio renderer. Issues 1–349 were never
authored here, so their spoken scripts are kept in this directory instead.

## What is here

- `scripts/<N>.txt` — the spoken script for issues 1–348 and `140-special`,
  exactly as the retired Studio pipeline generated them from the archive
  Markdown (`librarian-thing` at `de83efde^`, `data/audio/scripts/`). Validated
  2026-05-08 with zero errors (`script_status.json`). **These are the source**
  for the back catalogue: what is said is what is in these files.
- `transform/` — the Python that produced them (`legacy.py` for issues ≤130,
  `modern.py` after; `common.py` shared). Kept for provenance and as the
  reference for the cue vocabulary. It is not run here.
- `script_status.json` — the validator's record per script (hash, errors, warnings).
- `old-manifest.json` — the retired pipeline's record of the 84 episodes it
  published (266–349): urls, durations, hashes. Those files are still live.

## Why frozen text and not a port

The archive is frozen, the transform was tuned over 349 issues, and 85 of its
outputs were published and listened to. Re-deriving the scripts in TypeScript
would re-solve a solved problem. Fixes for how these scripts *sound* (literal
`* ` bullets, the two pipe tables, the `---`-delimited sections of issues
32–38) belong in the block adapter that reads them, so the scripts stay what
they are.

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
