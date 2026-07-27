# Claude Design brief

## Assignment

Design a clickable desktop-browser prototype for WT Builder, a purpose-built
application where Jamie assembles one Weekly Thing issue from direct and
syndicated items and previews three intentionally different editions.

Do not design a general creative studio, agent dashboard, project manager, or
multi-user CMS.

## Primary question

What is the simplest interface in which Jamie can assemble one issue item by
item, rearrange it freely, and understand its Website, Buttondown, and Audio
outputs?

## Required scenarios

1. Open the only current issue and understand its state.
2. See imported Pinboard links before their commentary is complete.
3. Edit link commentary and observe Pinboard sync state.
4. Include/exclude and manually reorder Notable and Briefly links.
5. Remove one Micro.blog post from Journal.
6. See Journal posts grouped beneath date boundaries.
7. Promote a long titled Journal post into a standalone movable section.
8. Move that promoted post among top-level sections and demote it again.
9. Create/edit Intro, Outro, Currently, Photo, and Quote items.
10. Generate/review attributed Membership copy from Thingy.
11. Generate/select/edit a Haiku.
12. Generate attributed Echoes from current issue plus archive and keep it
    fixed last.
13. Compare Website, Buttondown, and Audio previews.
14. Notice that Photo and Echoes are absent from audio.
15. Notice that Briefly speaks title before description.

## Interaction guidance

Explore an ordered issue canvas with a candidate/source tray and contextual
editing. Do not assume drag-and-drop is the only or best ordering mechanism;
provide accessible alternatives.

Keep provenance and authorship understandable without making the editor feel
like a database UI. Jamie, syndicated, and Thingy content should be
distinguishable.

The prototype may simulate synchronization and generation. It must not publish.

## Deliverables

- Working clickable prototype in `prototype/`
- Brief rationale for the chosen interaction model
- Notes on rejected alternatives
- Updated screenshots or walkthrough
- Any proposed contract changes recorded as decision documents rather than
  silently changing the fixture

## Source material

- `docs/product-brief.md`
- `docs/workflow-current.md`
- `docs/workflow-target.md`
- `docs/item-model.md`
- `docs/rendering-contracts.md`
- `fixtures/representative-issue.json`
