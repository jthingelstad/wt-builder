# Review batches — prompts for the local instance

> Companion to `docs/history/review-2026-09-27.md`. Each batch below is a
> prompt to paste into Claude Code on otto, one batch per session. Section
> references (§1.2 etc.) point into the review, which holds the evidence,
> the repro scenario, and the verifier's corrections for every finding.
> Strike a batch here when it has landed.

## Running them

**Order.** 0 first: it makes the test suite safe to extend, and every later
batch adds tests. To run everything in one session, use the master prompt
below. After that, 1–6 in order is the risk-weighted path. D can
run at any time. F1–F5 are features; schedule them after the fixes.

**Timing.** Nothing lands between Friday afternoon and the send. On send day
the only changes are fixes for whatever breaks, as in any live session.

**Decisions, open and settled**

| Batch | Decision |
|---|---|
| 3 | **Settled 2026-09-28:** quote every string scalar with `JSON.stringify`. The one-time churn in `fixtures/expected/` and in re-sent page diffs is accepted. |
| 7 | **Settled 2026-09-28:** a published issue stays editable until it is put to bed. Once it is put to bed, nothing is editable. This changes `docs/interface-spec.md:484`. |
| 7 | **Settled 2026-09-28:** the editorial review never counts on the progress strip. It stays advisory. Correct `interface-spec.md` :337 and :609–610 to agree with :765. |
| 2 | **Settled 2026-09-28:** Jamie does not use Micro.blog drafts. Check once with a read-only GET, and add the guard anyway as insurance. |

**The preamble every batch prompt starts with.** It is included in each
block below, so every block can be pasted on its own.

---

## One session for all of it: the master prompt

Paste this into Claude Code in the live checkout on otto. It sets up a
separate worktree, so the running service's source, `dist/`, `data/` and
`.env` are never touched. It runs the batches in order with one implementer
subagent per batch and a fresh reviewer subagent after each, and it stops
short of merging and deploying, which stay with Jamie.

```text
You are the orchestrator for the WT Builder review fixes. You dispatch one subagent per batch, gate and review each batch's work, and keep the run moving. You do not write the fixes yourself.

SOURCES
- docs/history/review-2026-09-27.md: the verified review, with evidence, repro scenarios and verifier corrections per finding.
- docs/history/review-2026-09-27-batches.md: the work orders. Each "Batch N" block is one subagent's brief. Every decision in its table is settled; nothing there needs asking.
Both live on origin/claude/code-feature-review-xy80ca and are not on main yet.

SETUP (once)
1. In this checkout, run git fetch origin. Stop and ask me if local main differs from origin/main, or if this checkout has uncommitted changes.
2. Create the worktree: git worktree add -b review-fixes ../wt-builder-review main.
3. In ../wt-builder-review, run git merge origin/claude/code-feature-review-xy80ca (a fast-forward if main has not moved), then npm ci.
4. Take the baseline in the worktree: npm test, npm run typecheck and npm run test:e2e must all pass. If any fails, stop and tell me.
From here on, every command and every edit happens in ../wt-builder-review, on branch review-fixes.

HARD RULES (you and every subagent)
- Never touch this live checkout's working tree.
- Never run npm run deploy or launchctl, and never restart the service.
- Never push. I merge and deploy.
- Nothing writes to a live service: Pinboard, Micro.blog, Buttondown, GitHub, S3, OpenAI, Anthropic. The worktree has no .env; keep it that way.
- The one live call allowed in the whole run is the read-only Micro.blog check in Batch 2 step 8, and you make it, not a subagent. Before spawning Batch 2, run a one-off script in /tmp that imports fetchSource from this checkout's src/server/integrations/microblog.ts, so it reads this checkout's .env. It prints only the number of items and the distinct post-status values, never a credential. Put the result in Batch 2's brief with: "the read-only check is done; do not call Micro.blog".
- Each batch block's preamble says "Do not deploy. When the batch is green, tell me". In this run, "me" means you, the orchestrator. Subagents report to you and never wait for Jamie.
- Commits match the repo's voice (see git log): a title that states what is now true, for example "A moved link is scrolled to, not selected"; a body that says why and names the review section. One fix per commit, each with the regression test that failed before it.
- Never skip, disable or loosen a test to get green.
- Never change fixtures/expected without the commit saying why the edition changed.

ORDER
Batches 0, 1, 2, 3, 4, 5, 6, 7, 8, then D, one at a time. They share files and the e2e database, so never run two at once.
PHASE 2, features F1–F5: OFF. If I change this to ON, run F1 to F5 after D with the same loop.

THE LOOP, per batch
1. Record BASE=$(git rev-parse HEAD).
2. Implement. Spawn a general-purpose subagent with this brief. Paste the hard rules above into it, and give it the worktree's absolute path. The brief:
   "Work in <worktree> on branch review-fixes. Do Batch N from docs/history/review-2026-09-27-batches.md exactly, reading the review sections it cites. Before each fix, confirm the finding still holds and write the failing test. If an item cannot be done, or would change something docs/decisions.md or docs/interface-spec.md settles beyond the settled decisions in the batches file, skip it and say why. Leave the tree green: npm test and npm run typecheck always, and npm run test:e2e when you touched src/client or tests/e2e. Return, for every item, one of fixed / already fixed / skipped with a reason, with commit shas and titles, the tests added, the docs updated, and any question for Jamie."
3. Gate it yourself: npm test, npm run typecheck and npm run test:e2e, and git status must be clean.
4. Review. Spawn a fresh subagent, never the implementer, with this brief:
   "Review git diff BASE..HEAD in <worktree> against Batch N and the review sections it cites. For each item:
   (a) Does the change fix the root cause described, not just the symptom?
   (b) Does its test fail without the fix? Check by reverting that fix in the working tree, running the test, then restoring.
   (c) Does it keep AGENTS.md's rules? Anything that awaits the network applies its result through savedFresh. docs/status.md changes in the same commit as any route or send leg. fixtures/expected changes are explained. Thingy never appears as Jamie. Generation never writes into the issue.
   Also look for regressions the batch introduced. Return BLOCKING findings and non-blocking notes, each with path:line."
5. If anything blocks, send the findings back to the same implementer with SendMessage, so it keeps its context. Then repeat steps 3 and 4. Allow at most two rounds. If a finding still blocks after that:
   - git revert only that item's commits (never reset);
   - record it as needing Jamie;
   - leave the tree green.
6. Record the batch in docs/history/review-2026-09-27-batches.md. Strike its heading (~~…~~) and add one line under it: "Landed <date> on review-fixes: <first sha>..<last sha>. Skipped: …. Needs Jamie: …". Commit that.
7. Tell me in two lines what landed. Then go straight on to the next batch; do not wait for me.

AFTER D
Spawn one more fresh reviewer over main..review-fixes. It looks only for interactions between batches: for example Batch 4's last_sent against Batch 2's write-back changes, and Batch 1's guard against every route and test. Handle anything it finds with the same fix loop.

YOUR OWN CONTEXT
Keep it small. Do not read whole diffs yourself; rely on the gate output and the reviewer's report. The batches file and the git log on review-fixes are the record. If this session is interrupted or resumed, read them and continue from the first batch not struck through.

THE FINAL REPORT
Give me one report with:
- For each batch: what landed (the commit range), what was skipped and why, and every needs-Jamie item as a one-line question.
- Every change to an edition's output (fixtures/expected), so I know what a re-sent page will show.
- The merge and deploy steps, for me to run in this checkout:
    git merge --ff-only review-fixes
    npm ci
    npm run deploy
  npm ci is needed because Batch 3 adds js-yaml.
- The smoke test after the deploy:
  - load the app over the tailnet;
  - open the draft;
  - edit a Currently line and click away: it saves, and there is no 403 or 421 in ~/Library/Logs/wt-builder/wt-builder.log;
  - Re-scan;
  - open the Send view without sending;
  - check the log once more for refused requests.
  If a refusal shows up, WT_BUILDER_ALLOWED_HOSTS and WT_BUILDER_ALLOWED_ORIGINS in .env extend the lists without a code change.
- Cleanup, once I have merged: git worktree remove ../wt-builder-review.
- A reminder not to merge between Friday afternoon and the send.
```

---

## ~~Batch 0 — Make the test suite safe to extend (§1.7)~~

Landed 2026-09-28 on review-fixes: 4c3bc44..8290cb2. Skipped: none. Needs Jamie: none.

```text
Read docs/history/review-2026-09-27.md §1.7 and §7 first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 0: make the suites unable to touch live services or the live build.

1. The unit suite loads the real .env on this Mac. tests/routes.test.ts imports the whole server, and config.ts calls loadEnvFile unless WT_BUILDER_OFFLINE=1. Set WT_BUILDER_OFFLINE=1 for vitest by construction: `test.env` in vite.config.ts, or a setupFiles entry. Then check that every test still passes, and that none of them needed a credential. persona.test.ts and publish.test.ts compare against sibling checkouts; that is deliberate, so leave it.
2. Offline mode can still open the live database. Under WT_BUILDER_OFFLINE, refuse to start unless WT_BUILDER_DB is set to a path that is not the default live one. Boot migrations and finishStrandedWrites must never run against data/ from a test.
3. npm run test:e2e builds into the dist/ the live service serves. Let the server take its static root from WT_BUILDER_DIST (default ../../dist). Make test:e2e build with `vite build --outDir tmp/e2e/dist --emptyOutDir`, and have playwright.config.ts pass WT_BUILDER_DIST to the webServer.
4. Add a Playwright job to .github/workflows/ci.yml. It runs after the unit tests, on ubuntu-latest, with `npx playwright install --with-deps chromium webkit`. Keep the audit step last and advisory.

Acceptance: npm test passes with a deliberately broken PINBOARD_API_TOKEN in the environment. dist/ is byte-identical before and after npm run test:e2e. CI runs the browser suite.
```

## ~~Batch 1 — The edge: cross-site requests, rebinding, the Host crash (§1.6)~~

Landed 2026-09-28 on review-fixes: 44e5a0b..2972702. Skipped: none. Needs Jamie: none. (Refusals log to wt-builder.err, not wt-builder.log; the smoke test above predates that.)

```text
Read docs/history/review-2026-09-27.md §1.6 first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 1: the service has no auth and relies on the tailnet. It must refuse what a browser sends on behalf of another site.

0. The allow-lists must not lock Jamie out after the deploy. Tailscale Serve may either pass the tailnet Host through or rewrite it to loopback, so accept both. Every refusal logs the header value it refused. An env var (WT_BUILDER_ALLOWED_HOSTS, WT_BUILDER_ALLOWED_ORIGINS, comma-separated) extends either list without a code change. The smoke test after the deploy: Jamie loads the app over the tailnet, edits one line, and the service log shows no refusal.
1. Add one guard beside guardBed, before routing, for every method except GET and HEAD:
   - Refuse 403 when Sec-Fetch-Site is present and is neither same-origin nor none.
   - Refuse 403 when Origin is present and is not in the allow-list: https://otto.tail09aaf9.ts.net:10001, the Vite dev origins (http://localhost:5317 and http://127.0.0.1:5317), and the loopback origins on the configured port.
   - Requests with neither header (the scripts/, curl) pass.
   - "The configured port" means the port the server is actually listening on (server.address()), not config.port. routes.test.ts listens on port 0, and the e2e server on 4399.
2. Add a Host allow-list that answers 421, checked before routing for every method. It covers localhost and 127.0.0.1 on the configured port, otto.tail09aaf9.ts.net and otto.tail09aaf9.ts.net:10001, and the loopback Host the Vite proxy sends (it sets changeOrigin). The 421 message names the Host it refused.
3. Parse the request URL inside the try, against a fixed base: `new URL(req.url ?? '/', 'http://localhost')`. Log uncaughtException and unhandledRejection instead of exiting mid-send.
4. DELETE /api/issues/:id. The client never calls it, and it drops the document and the event log. Make it refuse anything that is not an unsent draft. Keep its revisions, because they are the only recovery path. The route tests use it for cleanup, so keep that working.
5. Add tests in tests/routes.test.ts:
   - A POST with Origin https://evil.example and a text/plain body gets 403, and nothing is saved.
   - A POST with Sec-Fetch-Site: cross-site gets 403.
   - A foreign Host gets 421.
   - `Host: a b` gets a 4xx and the server keeps answering.
   - A same-origin POST still works.

Update docs/status.md (the edge is a contract) and the README's security note in the same commits.
```

## ~~Batch 2 — The issue record and the sources stay true (§1.1, §1.2, §4, §3 drafts)~~

Landed 2026-09-28 on review-fixes: 0dad7ff..a8c50ed. Micro.blog check: 100 of 100 posts published, no drafts; guard added. Skipped: none. Needs Jamie: orphans swept in while their section was removed are already stranded on live (main never marked them), and the new awaits_section reclaim cannot see them. Migrate them once, or wait for the Held-out strip (§4)?

```text
Read docs/history/review-2026-09-27.md §1.1, §1.2, §4 and the Micro.blog drafts item in §3 first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 2: nothing Jamie wrote, and nothing already published, can be silently replaced.

1. Creating an issue overwrites a renumbered one. The id is wt<N> forever, the create route checks only the number, and saveIssue is an upsert. Add an insert-only create in db.ts, so an id conflict becomes a 409. Routes test: create 353, renumber it to 352, create 353, expect 409, and the first issue is intact.
2. A re-scan reverts a write-back that landed while it ran. In fetchForSweep, record each item's source_snapshot and sync_state as they were when its remote was read. In applySweep, skip reconcileItem and followBookmarkTags for any item whose snapshot has moved since, or that is syncing. Journal posts need the same guard, because the Micro.blog index is read before the Pinboard loop. Add a regression test beside the existing fresh-read test in tests/issue.test.ts: fetch, write-back outcome, apply. Cover a commentary edit and a Notable→Briefly move.
3. `conflict` has no way out.
   - Add "Keep mine": move the snapshot to the current remote, then write back.
   - Add "Take theirs": adopt the remote fields and snapshot.
   - Put both as Inspector actions in the existing sync area.
   - Change the error text so it stops saying "re-scan".
   - Add a readiness `sync` unit for any in-issue item from Pinboard or Micro.blog whose state is failed or conflict. Today only a failed Pinboard write counts.
4. Overlapping write-backs on one item. Serialize writeItemToSource per issue and item (a promise chain in a Map). When applying an outcome to the fresh read, mark synced and move the snapshot only if the item's mirrored fields still equal what was written. Otherwise write again.
5. If the compare-and-set read throws, write-back writes blind. Instead, do not write: return failed with "could not read the bookmark first — your edit is kept". Apply the same rule to the Micro.blog update.
6. Promoting twice creates duplicate node ids and hides the post. Make promote idempotent.
7. Restoring a removed section reclaims only its original items. In placeInto's orphan branch, stamp item.section. On restore, reclaim held items first, then every non-excluded orphan whose section matches.
8. Micro.blog drafts. Jamie does not use drafts, so this is insurance. Run one read-only q=source GET against the account, and report only how many items came back and which post-status values they carry. Never print a credential. Then, whatever it shows, skip items whose post-status is present and not "published", in both the sweep and remoteIndex, with a test.

Add tests/pinboard-writeback.test.ts. Stub fetch and assert the exact posts/add parameters for a private, unread bookmark: shared=no and toread=yes survive, fresh flags win over stale ones, and the conflict, gone and failure paths behave. This is the private-bookmark failure that has happened once, and nothing tests it today. Update docs/status.md for any route added.
```

## ~~Batch 3 — What readers receive (§1.3, §2.2, §3)~~

Landed 2026-09-28 on review-fixes: 5691d6d..e430f89. Skipped: none. fixtures/expected changes only in ce0e7ac (new fixture content). Needs Jamie: should the site transcript panel decode entities (then < could stay &lt; instead of ‹)? Exempt deliberate Liquid in email-only Markdown blocks? Spoken Quote attribution and line-per-paragraph? Strip [ ] and {{ }} from spoken titles?

```text
Read docs/history/review-2026-09-27.md §1.3, §2.2 and §3 first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 3: the editions are a contract. When an expected file changes, update fixtures/expected in the same commit and say why.

1. Front matter breaks on ordinary titles. arXiv's "[2410.12345] …", and anything starting with " @ * ` ! & | { etc., fails in js-yaml, which is what Eleventy uses; the site build fails and blocks every later deploy. Emit every string scalar through one function in publish.ts that returns JSON.stringify(value). Jamie settled on uniform quoting on 2026-09-28 and accepts the one-time churn. Apply it to every scalar, including url, domain, section, subject, and the chapter title, url and image. Teach backfill.ts's front-matter reader to JSON-unescape double-quoted values. Add js-yaml as a devDependency and a table-driven test that parses archivePage, archiveMarkdown and the audio front matter for each indicator character.
2. HTML in a link title becomes markup. "Styling the <textarea> element" swallows the rest of the issue. In website.ts, escape external fields only: item.title, media.alt, media.location, and heading_context in publish.ts. Escape the Markdown link metacharacters \ [ ] * _ ` and turn < > into entities. Never escape Jamie's commentary or body. Add render tests with <textarea>, Array<T>, and an unbalanced ].
3. The Journal lead welds structure onto the time link. Weld only when the first block is plain prose, not a quote, a list, a heading, or a lead-in line followed by a list. Otherwise emit the lead alone, then the blocks. Drop " — " when the body is empty. Demote post headings below the day headings. Add a render test for each shape. It is the same class as the WT351 fix.
4. The first website send hotlinks newly rehosted images. It renders the copy it read before rehosting. Render from `savedFresh(id, d => applyRehost(d, mapping)).issue`, mirroring the Buttondown leg, and add a warn-level "no hotlinks" check to verifyWebsite. Add a route test with the integrations mocked: the committed page carries the CDN URL.
5. Lower priority, same batch if time allows:
   - Neutralize {{ }} and {% %} in item-derived email blocks.
   - Escape < and & in WebVTT cues.
   - Frame Quote items in audio as quotes, and render their attribution.
```

## Batch 4 — Send state that survives failure (§2.1, §2.3, features #1, #5, #7)

```text
Read docs/history/review-2026-09-27.md §2.1 and §2.3, and features #1, #5 and #7 in §8, first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 4: a failed or interrupted leg never erases what the last good one did.

1. recordSend replaces a leg's whole SendState, so 'sending' and 'failed' drop the podcast's audio and Buttondown's external_id. Add last_sent to SendState and carry the last success forward through sending and failed, in recordSend, one place for all four legs. Readers fall back to it:
   - Buttondown's draft id, so a retry PATCHes and never creates a second draft.
   - The website options' audio.
   - The URLs.
   The Send card shows "Last good: …" under a failed leg.
2. Gate the website on "an audio reference is recorded", not status === 'sent'. Fix the 409 text, which says "has not run" when the leg ran and a re-render failed. Stop offering ?force=1 when audio exists.
3. Record 'sending' synchronously, straight after guardInFlight and before any await. Back it with an in-process Set of `${id}:${dest}` as the real in-flight guard. On boot, before listen, turn every persisted 'sending' into failed with "interrupted by a restart", keeping last_sent.
4. Website verify judges the old deploy on a re-send. It counts as landed only when the page is 200, carries the title, and, when audio is recorded, carries this send's audio filename. Better, if it is cheap: wait on the commit's check runs or deployment for sends.website.external_id. Past the deadline, return waiting with a recheck, not problems, like the Buttondown and archive verifiers. Add tests/verify.test.ts with a mocked fetch: old page then new page passes; a page that never updates is waiting.
5. Buttondown reads the email's status before it PATCHes:
   - about_to_send or in_flight: 409 "Buttondown is delivering it now", recording nothing.
   - sent: refuse unless ?web_copy=1, and log it when it happens. The card offers "Update web copy…" with a confirm, and "Re-send all sent" leaves Buttondown out.
   - draft or scheduled: as today.
6. Lower priority:
   - The server enforces the podcast script approval, unless the podcast is already sent.
   - Merge emails.json inside editTree, so a ref race merges against the file as it stands.
   - Derive the emails.json floor from the last published number, not 349.
   - A failed cover fetch must not overwrite the live banner with show art.

Route tests with the integrations mocked cover each state transition. Update docs/status.md and docs/publishing-lifecycle.md in the same commits: these are send-leg contracts.
```

## Batch 5 — The editor keeps what Jamie types (§1.4, §1.5)

```text
Read docs/history/review-2026-09-27.md §1.4 and §1.5 first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 5: every fix here is proven in WebKit first, because Jamie edits in Safari. Write each e2e test to fail before the fix.

1. RichEditable (Row.tsx) re-renders from the old value on blur until the PATCH returns (0.5–3 s for a mirrored field). Clicking back in edits the old text, and the next blur saves it over the edit.
   - Keep a pendingRef. Render and read the source from `pending ?? value`, and clear it when value catches up.
   - Make onCommit/updateItem return run()'s promise, resolving to success or failure.
   - On failure, keep the text on screen marked unsaved, so the next blur retries.
   - In call(), fall back to "<status> <statusText>" when an error body is not JSON.
   - absorb() must not clear an error it did not cause.
   - E2E: page.route delays and then aborts a PATCH; the typed text is visible while the save is pending and after it fails.
2. Inspector fields are controlled by the saved item. Any re-render resets what is being typed.
   - Make them uncontrolled while focused: defaultValue, plus an effect that sets el.value only when the prop changes and the field is not document.activeElement.
   - Apply this to GrowingTextarea, the inputs, PhotoFields and the MetaEditor inputs.
   - Widen the sweep's hold-until-blur from isContentEditable to `input, textarea, [contenteditable]`.
   - E2E: hold the title PATCH while typing into Commentary, then assert the saved commentary.
3. Escape in an Inspector field closes the rail without committing, and Safari fires no blur. Blur the field first, so its commit runs, then close.
4. Clicking into a block and out again commits whitespace-normalized text. Commit only when the read-back differs from the read-back of the stored value.
5. Ad hoc headings are editable but never saved.
   - Add renameNode to PageActions via runEdit(api.renameNode) and use it as the ad_hoc heading's onCommit.
   - For promoted_item, show and commit the item's title (act.updateItem), which is what the renderer prints and what writes back to Micro.blog.
   - E2E: type a heading, assert node.label saved.
   - Update docs/status.md: the rename route comes into use.
```

## Batch 6 — The Send view cannot surprise (§2.4)

```text
Read docs/history/review-2026-09-27.md §2.4 first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 6: start by writing tests/e2e/send.e2e.ts, which does not exist. Intercept /send/* with page.route, so no request reaches a real handler, and assert every case below failing before its fix.

1. A double-click on Publish lands on "Send the rest".
   - Add a confirm() naming the legs on all three bulk buttons (Send all, Send the rest, Re-send all sent).
   - Have sendAll/resendAll check a cancelled ref between legs, so "← Issue" stops the chain.
2. A failed send never shows DID NOT SEND, and a re-send's card stays a green SENT. In send()'s catch, re-read the issue (api.getIssue → onSent) so the card shows what the server recorded.
3. In-flight state lives in the component. Treat doc.sends[leg].status === 'sending' as running: disable the button, and poll getIssue every few seconds while any leg is sending. Re-read on mount.
4. A late response for another issue replaces the one on screen and loops that issue's sweep.
   - Keep the route in a ref, and drop any response whose issue id differs, in absorb and in Send's onSent.
   - Render loading while doc.issue.id !== route.id.
   - Add key={doc.issue.id} on Editor and Send.
5. Send unmounts the Editor, so every trip re-sweeps (posts/all is limited to once per five minutes) and loses the review triage. Render Send over a mounted Editor; .send-layer is already fixed. Check that the Editor's document keydown handlers are harmless under it.
6. Lower priority:
   - Send evidence (the draft link, the commit link, the mp3 link) comes from the doc, so it survives a reload.
   - Return 404 for a missing /assets/* instead of index.html.
   - Show a "WT Builder was updated — reload" bar when the server's build id differs from the client's.
```

## Batch 7 — Rules for a published issue (§2.5, §3 new-issue date)

```text
Read docs/history/review-2026-09-27.md §2.5 and the new-issue date item in §3 first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 7. Two decisions Jamie settled on 2026-09-28:
- A published issue stays editable until it is put to bed. Once it is put to bed, nothing is editable.
- The editorial review never counts on the progress strip.

1. Number, date and window save immediately on a published issue, and the next re-send publishes a different edition. A renumber forks the site, emails.json, the feed (a duplicate episode) and the archive. POST /settings refuses number, publication_date and window_days when the status is not draft, with a message saying why. POST /sweep refuses non-drafts, which the client already assumes. The MetaEditor shows those fields read-only on a published issue. Add route tests.
2. A new issue created on a Saturday defaults to the previous issue's date and window. Default to the Saturday after the latest existing issue's date. The dialog warns about, and POST /api/issues refuses, a publication_date another issue already holds.
3. Title and Dek, the email subject, have no edit path once published. Add them to the MetaEditor; the server already accepts them.
4. Editable until put to bed.
   - In Page.tsx, readOnly becomes put_to_bed_at || imported, no longer published.
   - Structural affordances (insert points, add chips, ordering wand, echoes wand) stay gated on published.
   - On a published issue that is awake, the kicker reads "WEBSITE — PUBLISHED · EDITS NEED A RE-SEND".
   - Once put to bed, nothing is editable, and the client must show that rather than let the server's 423 say it. Check every affordance: canvas text, rails (move, remove, promote), wands, outline drag, add chips, Inspector fields and buttons, Re-scan, and the MetaEditor. Each is hidden or disabled when put_to_bed_at is set. The server's guardBed stays as the backstop.
   - Update docs/interface-spec.md (the "In a published issue, everything is read-only" line). Add one sentence to the put-to-bed section of docs/decisions.md: editing stays open after publishing because fixes and re-sends follow it, and put to bed is the only freeze.
   - WebKit e2e: edit a published issue's commentary on the canvas and assert the saved text. Put it to bed, then assert the run is not contenteditable, no rail or wand is offered, and a PATCH gets 423.
5. The review never counts on the progress strip. The code already behaves this way, so this is a spec correction only. In docs/interface-spec.md, remove "one per open PROOF note. The denominator grows when a review finds new proof notes" from the strip's units (around :337). Reword "Only open notes count against the progress strip" (around :609–610) so it says open and cleared notes are tallied in the review's read bar only. Leave :765 ("Advisory only: never in the Ready checklist, never a gate") as the rule.
```

## Batch 8 — Thingy and the models (§5, features #3 and #9)

```text
Read docs/history/review-2026-09-27.md §5, and features #3 and #9 in §8, first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before fixing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch 8. The rule throughout: generation offers and never writes, so every check here flags and never drops.

1. Echo citation grounding.
   - Add a pure echoGrounding(option, anchored, seasonal) in editorial.ts. It pulls every WT number and archive URL from each echo's body and archive_references, and checks them against the retrieved passages and the seasonal issue. URLs are normalized for scheme, www, trailing slash and fragment.
   - Flag a WTn label whose link points to a different /archive/n/, and a body link missing from the echo's own references.
   - Attach the result as `grounding` on EchoOption. EchoesPicker shows each flag in the warning colour.
   - Cover the per-echo redraft path too.
   - Tests on a hand-built passage set.
2. Keep Thingy's words out of "Jamie's archive".
   - issueExcerpt skips Thingy-authored items.
   - A pure withoutThingy(passages, sentences) drops retrieved passages from issue 350 on that contain a normalized sentence (≥40 chars) from a Thingy item of a Builder issue.
   - Apply it before poolEchoPassages and in linkGrounding.
   - Leave the librarian-thing `author` field as a note in docs/service-contracts.md, for later.
3. PROOF notes on the caption, alt, place and Ask question are pruned. Move one anchorText(item) into src/shared. It covers title, body, commentary, label, media caption, alt and location, ask, and member_thanks. Use it in both pruneStale and stillAnchored. Test that a caption PROOF note survives.
4. Add one callJson helper for the six model calls. It raises readable errors on stop_reason max_tokens ("the draft ran out of room — try again") and on refusal, with caps raised to 8–16k. Use the claude-api skill for the current parameters.
5. Lower priority:
   - Fence the link wand's page text as untrusted data, cap the fetch size, and follow redirects manually, refusing private and loopback addresses.
   - Journal alts: an indexed schema {picture, alt}, and reject a count mismatch.
   - stripSignOff Markdown variants.
   - The seasonal excerpt uses plan.ts's isIncluded.
```

## Batch D — Documents that say what is true (§7)

```text
Read docs/history/review-2026-09-27.md §7, "Stale docs", first. It is a verified review taken at 06b237f. Line numbers have drifted, so find code by symbol. Before changing anything, confirm the finding still holds.

Rules for this batch:
- One commit per fix. Each commit carries a test that fails without the fix, where a test is possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy. When the batch is green, tell me and I will say when; I may be mid-issue.
- If a fix would change something docs/decisions.md or docs/interface-spec.md settles, stop and ask.

Batch D: correct each stale statement against the code as it stands. Do not rewrite documents wholesale.

- README.md:
  - Status says nothing has been sent; WT350 and WT351 were.
  - The "What talks to a real service" list says Pinboard "reads the unread queue (toread=yes)" and website/podcast are "Built, never run".
- docs/integrations.md still describes write-back marking bookmarks read.
- "Last-writer-wins" in docs and comments: the code does compare-and-set and refuses with conflict. Grep for it and fix each instance.
- docs/interface-spec.md and docs/publishing-lifecycle.md:
  - website send order is described as unenforced (the server refuses a website send until the podcast has run);
  - a Thingy "mark reviewed" gate, which decisions.md retired ("Picking is the review").
- docs/decisions.md "text edits are a known hole" predates the revisions table. Amend it, keeping "no undo".
- docs/status.md and verify.ts disagree on whether the site renders chapters and the transcript. Check the live WT351 page and fix whichever is wrong.

One commit. Its message lists each correction.
```

---

## Feature batches (after the fixes; each is one session)

```text
F1 — Scan health (review §8 #8).

Rules:
- One commit per fix, each with a test that fails without it where possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy until I say so.
- Stop and ask before changing anything decisions.md or the spec settles.

The feature:
- fetchForSweep returns per-source outcomes. The sweep route logs a sweep event whenever a source failed, even on an otherwise quiet scan.
- The Editor says "Pinboard did not answer (429) — nothing new from it" instead of "0 in".
- Record each source's last good scan with a targeted write that makes no revision. The meta card shows it, in amber when it predates the window's close.
- Reconcile in-window bookmarks from the posts/all response the sweep already has. Call posts/get only for items absent from it, or outside the window.
- Route all Pinboard calls through one queue, at least 3 s apart, with one retry on 429.
```

```text
F2 — Changed since sent (review §8 #11). Depends on Batch 4.

Rules:
- One commit per fix, each with a test that fails without it where possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy until I say so.
- Stop and ask before changing anything decisions.md or the spec settles.

The feature:
- Store content_hash on SendState when the podcast leg (scriptHash of audioScript) or the website leg (sha256 of the rendered page, excluding emails.json) succeeds.
- Derive drift on read, never stored. Legs sent before this show nothing.
- The Send cards show CHANGED SINCE SENT. The podcast card says the spoken script changed after this mp3. "Re-send all sent" names the legs that changed. The Bed card warns.
- Tests: a Notable edit drifts website and podcast; an email-only channel flip drifts neither.
- Update docs/publishing-lifecycle.md.
```

```text
F3 — The log shows was→now (review §8 #10; Jamie's open item in docs/status.md).

Rules:
- One commit per fix, each with a test that fails without it where possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy until I say so.
- Stop and ask before changing anything decisions.md or the spec settles.

The feature:
- A db migration adds events.detail. The PATCH item route stores [{field, was, now}], each side capped at about 2,000 characters.
- listEvents returns anchor and detail.
- EventLog renders was→now in the review-note idiom, with a "Go to" that jumps to the item.
- npm run watch prints the change.
- Narrative only: no restore button.
```

```text
F4 — Held out and Put back (review §4).

Rules:
- One commit per fix, each with a test that fails without it where possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy until I say so.
- Stop and ask before changing anything decisions.md or the spec settles.

docs/decisions.md names Held out and Put back as what makes no-undo tolerable. It was never built.
- Render doc.orphans as the spec's Held out group.
- Add POST /items/:id/putback. For a Pinboard link it removes _exclude and writes back through the shared path. It places the item in its section and removes it from orphans.
- WebKit e2e: remove a Journal post, then put it back.
- Update docs/status.md.
```

```text
F5 — The recovery net (review §6, §8 #12).

Rules:
- One commit per fix, each with a test that fails without it where possible.
- Run npm test and npm run typecheck green, plus npm run test:e2e for anything client-side.
- Do not deploy until I say so.
- Stop and ask before changing anything decisions.md or the spec settles.

The feature:
- `npm run backup`: better-sqlite3's db.backup() into data/backups/, then PRAGMA integrity_check on the copy, a read of the newest issue, and keep the last 14. Add a LaunchAgent plist beside wt-backfill; I will install it.
- Revisions: skip a revision when a save changes only sync bookkeeping, and keep everything from the last 14 days before trimming by count.
- npm run revisions compares every item field and the nodes, not only title, commentary and body.
- Record in docs/decisions.md that the external backup copies data/backups/, never the live db/-wal pair.
```
