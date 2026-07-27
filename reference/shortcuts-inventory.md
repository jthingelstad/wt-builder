# Shortcuts inventory

The shared Shortcuts were inspected as behavioral evidence. Raw payloads are
not committed because they may contain private configuration or credentials.

## Orchestration

- Build Issue

## Section rendering

- Links
- Journal
- Photo
- Currently
- Featured
- Briefly
- Intro
- Quote
- Membership
- Haiku

## Source ingestion

- Get Links from Pinboard
- Handle Link from Pinboard
- Get Journal from Blog
- Handle Post from Blog

## Observed contracts

- Build Issue concatenates section Markdown.
- Pinboard yields structured link dictionaries and uses tags for routing.
- Briefly renders commentary/description followed by a linked title.
- Micro.blog ingestion preserves title, body, publication date, URL, and
  embedded images.
- Intro reads Markdown from a Drafts workspace and falls back to a TODO.
- Quote selects a Draft and caches it for the current issue.
- Membership obtains current campaign facts, generates separate regular and
  supporting-member copy, requests human confirmation, and emits
  Buttondown-specific conditional content.
- Haiku is generated from issue material and selected by Jamie.

## Security note

The inspected Membership shortcut included a live credential directly in the
workflow. It is intentionally excluded here. WT Builder must use managed
server-side secrets.
