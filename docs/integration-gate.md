# Canvas + Google Workspace integration gate

Scope for this round (product owner): the labelled Demo Canvas + Google context working end to end. Live OAuth and a live
Canvas session are BLOCKED here (no `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`, no signed-in Canvas tab or `.ics` feed).
Nothing below claims live. Reference: `cubbie-re/app` (Nook); detail of Nook's behaviour is in `docs/nook-parity.md`.

## Gap table

| # | Item | Nook (cubbie-re/app) | Squad today | Gap / status |
|---|---|---|---|---|
| 1 | Canvas connection | Extension reads Canvas with the student's session (`apps/extension/src/canvas.ts`, `background.ts`), authorize and sync into the hub (`apps/mock/src/routes/canvas.ts`) | Same pattern ported: `apps/extension`, `packages/brain/src/context/connectors/canvas-rest.ts`, `apps/hub/src/routes/connections.ts` (pair, register, sync), labelled Demo workspace (`connectors/demo.ts`) | Live: BLOCKED (no session). Verified against fake Canvas server only (`context/parity`). Demo: done |
| 2 | Google Workspace | PKCE OAuth, broad scopes, **probe only** (`bridge/google-workspace.ts probeGoogleWorkspace`: Gmail/Drive/Calendar/Tasks reachability, no ingestion) | PKCE OAuth + ingestion of Calendar, picked Drive/Docs (title + text) and Classroom (`connectors/google-live.ts`), minimal read-only scopes | Squad already exceeds Nook for ingestion. **Not built: Gmail and Tasks ingestion** (Nook only probes them). Live: BLOCKED; fake-Google tests only. Demo Drive/Docs fixtures extended this round |
| 3 | One retrieval service | Nook answers from synced metadata (`bridge/canvas-answers.ts`) only | `context/retrieve.ts`, `answers.ts`, `answers-rich.ts`; chat skill `skills/canvas`; council retrieve tool (`hub/context/council.ts`); plan seeds (`study-seeds.ts`, `hub/plans/context.ts`) | Combined due + Google files answer added (`combinedDueStudyReply`). Tutor/doubt, council and study-plan already read the store through the viewer gate; not re-audited further this round |
| 4 | @cubbie web == iMessage | n/a (Nook has separate paths) | Web group chat and the iMessage/Demo bridge feed the same bot skills (`apps/bot/src/skills/index.ts`) | The combined skill branch is shared, so both get the same text and citations. The j40 spec drives the web path; a bridge-specific assertion for the combined question was NOT added |
| 5 | Visible states | `needs_reauth` only | shared `integrationState` (`packages/core/src/integration-state.ts`), Connections/Home/health already render it | Unchanged this round |
| 6 | Judge flow | n/a | `e2e/specs/j40-judge-flow.spec.ts` | Done (Demo mode) |

## What this round added

* Demo Google Drive/Docs fixtures for STAT 101, HIST 140 and BIO 120 (`connectors/demo.ts`; 6 Drive docs now).
* Combined-intent answer `combinedDueStudyReply` (`answers-rich.ts`), routed from the canvas skill when a message asks for
  due items AND Google files to study. Due part is `dueReply` (this-week window, "Next after this week"); files are matched
  by course code to the due items and shown with a short reason (`for <assignment> (due <day>); covers <topics>`). Every item
  has a citation chip; fixture sources are labelled Fixture/Demo, footer Demo.
* "Plan from this answer" on a bot answer that cites due items (`packages/web/src/plans/seed.ts`, `Bubble.tsx`, `Thread.tsx`,
  `StudyFlow.tsx`): opens the study wizard in the same chat with the cited items as context chips; the plan deadline is the
  latest cited due date. `POST /v1/plans` accepts `contextSourceIds`; the hub resolves them through the viewer read gate
  (`plans/context.ts contextRefs`) so the draft's prep items carry the assignment and course ("Prep: Assignment 1: ... (STAT 101: ...)").
  Drive files are chips only: they do not create plan items. The answer already showed these titles to the squad.

## Tests

* `packages/brain/src/context/combined.test.ts` (new), existing brain, hub and web suites green.
* `e2e/specs/j40-judge-flow.spec.ts`: Demo Canvas + Google, combined question, plan from the answer, plan card in `/squad/chat`.
