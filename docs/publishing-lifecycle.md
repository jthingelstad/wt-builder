# Publishing lifecycle

## States

```text
assembling
reviewing
ready
rendering
drafted
scheduled-or-sent
verified
closed
```

State is derived from explicit evidence rather than a single mutable status.

## Readiness

An issue is ready when:

- required direct-content items are complete or explicitly omitted,
- included syndicated items have valid titles, URLs, and presentation,
- all three output previews validate,
- Thingy-authored content is reviewed and attributed,
- Echoes has been generated from the final-enough issue and is last,
- the audio script contains only applicable items, and
- package metadata is complete.

## Publication evidence

Each leg records its own attempts, timestamps, result, external identifier, and
recovery action:

- audio render/upload,
- Buttondown draft,
- website archive handoff,
- Buttondown scheduled/sent confirmation,
- website feed confirmation,
- podcast feed confirmation.

## Archive feed

Sending the issue text to the archive so Thingy can retrieve it is a separate
leg with the same evidence shape as the legs above. It differs in three ways:

- it runs after `verified`, not as part of reaching it,
- it is never a readiness or `closed` gate, and
- its failure is reported but does not degrade the issue's published state.

An issue can sit `closed` with an unsent archive feed. That is a Thingy
staleness problem, not a publishing problem, and it is retried independently.

This contract documents the intended production phase. The design prototype
must simulate these states and must not call external publishing services.
