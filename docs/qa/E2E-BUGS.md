# E2E product defects

Filed by the e2e acceptance suite (branch e2e/acceptance). Product code is not touched from here; the orchestrator dispatches. Severity: P0 demo-stopping, P1 a headline journey cannot complete, P2 visible defect with a workaround, P3 polish or doc. Reproduce with `pnpm e2e <journey>` (see E2E-README.md); evidence under `docs/design/shots/e2e/<journey>/`.

| Id | Sev | Journey | Status |
|---|---|---|---|
| E2E-001 | P1 | J1 | open: Setup courses step never completes in live mode |
| E2E-002 | P2 | J1 | open: uploaded .ics never reaches hub/agent |
| E2E-003 | P1 | J8 | open: Chi is s_chi in hub and s_cam in agents |
| E2E-004 | P1 | J10 | fixed on main by batch 3 (RoomLayer mounted); kept for the record |
| E2E-005 | P2 | J10 | open: four landmarks stay LOCKED (needs owner triage, see below) |
| E2E-006 | P2 | J10 | open: Esc does not leave a room; transcript panel covers the next Enter prompt |
| E2E-007 | n/a | J7 | withdrawn (Rubric works when the rubric is pasted after `rubric:`) |
| E2E-008 | n/a | J7 | withdrawn (Step Diff needs two different students, each DMing one photo; passes) |
| E2E-009 | P2 | J11 | open: Personas voice picker is empty with no explanation when TTS is off |
| E2E-010 | P3 | J1 | open: Home checklist shows phone and PDFs done before anything is done; phone code accepts any 6 digits and is not stored |

## E2E-001 (P1) Setup: course upload never finishes in live mode, Continue stays disabled
Journey J1. Steps: sign in as Ana against a live hub, /squad/setup/courses, add the OpenStax PDFs with "Browse files". Expected: each file reaches Ready and Continue enables. Actual: every file sits at "Reading 5%" forever although `POST /v1/squad/courses` returned 202 and `GET /v1/squad/courses` lists the course as `ready` within seconds. Cause (read from code): in `SetupPage` the ingest effect dispatches `courses/progress` (status `reading`) before `uploadCourse(...)` resolves; that state change re-runs the effect, whose cleanup sets `cancelled = true`, so the `.then` that would dispatch `ready` is dropped. Evidence: `docs/design/shots/e2e/j1-setup/courses-uploaded.png`. Owner/files: web, `packages/web/src/pages/setup/index.tsx` (effect around `uploadCourse`), `packages/web/src/pages/setup/model.ts` reducer.

## E2E-002 (P2) Setup: an uploaded .ics never reaches the hub or the agent
Journey J1. Steps: Setup step 3, "Upload .ics", pick `apps/agent/fixtures/ics/s_ana.ics`. Expected: the file (or its busy blocks) is POSTed to `/v1/squad/calendar` so the hub stores it and pushes it to the student's agent; later study and trip flows schedule around it. Actual: the page parses the file locally, shows "We found N busy blocks" and makes no request (only "Use the demo calendar" posts `{demo:true}`). The hub route accepts multipart `.ics` already. Owner/files: web, `packages/web/src/pages/setup/index.tsx` `CalendarStep.onPick`, `packages/web/src/pages/setup/api.ts` (`postCalendar` only supports demo).

## E2E-003 (P1) The fourth student is s_chi in the hub but s_cam in the agents
Journey J8. Steps: `pnpm dev:all`, start a trip with members s_ana, s_ben, s_chi, s_dev (the hub's squad) via `POST :4101/internal/start/trip`. Expected: confirmed. Actual: `no_plan` / `offline`, because no agent exists for `s_chi` (dev:all, `apps/agent/fixtures/peers.json` and the profile fixtures use `s_cam`; hub seed, sign-in screen and web use `s_chi`). Running with `s_cam` works but then `s_chi` never receives `trip.confirmed` or any flow event. Evidence: `docs/qa/E2E-REPORT.md` J8 rows. Owner/files: integration, `scripts/dev/all.ts` (STUDENTS, AGENT_PORTS), `apps/agent/fixtures/*` (s_cam.json, peers.json, ics/s_cam.ics) or the hub seed `apps/hub/src/sim/seed.ts`.

## E2E-004 (P1, fixed on main) Room info panel, transcript and outcome were not mounted in the village
Journey J10. Before batch 3, `RoomLayer` was never rendered by `packages/web/src/pages/village`, so entering any room showed the interior only. After batch 3 the "What they are saying" transcript panel, the room "?" and the Run it button are present (see E2E-006 for a side effect).

## E2E-005 (P2) Oracle, Oral Exam, Rubric and Devil's TA landmarks stay LOCKED
Journey J10. Steps: run `POST /__sim/squad/demo-run`, send `@cubbie exam oracle`, `@cubbie devil's TA ch2`, a rubric check and `@cubbie oral exam` in the group chat (all four skills answer in chat), open /squad/village as Ana, click each room chip and wait for the walk to finish. Expected: each room offers "Open ..." and can be entered. Actual: Exam Oracle, Oral Exam Hut, Rubric Courthouse and Devil's TA never offer an Enter prompt (tower shows a LOCKED sign); the other five rooms (Council Hall, Debate Stage, Round Table, Feynman Porch, Panic Line) enter fine. Landmarks unlock on the first relevant event ("events can only unlock"), and the village probably only sees live events, so using a skill before opening the village leaves its room locked; also none of the four events appear to unlock them while the village is open in this stack. Evidence: `docs/design/shots/e2e/j10-village/no-prompt-*.png`. Owner/files: rooms/village, `packages/village/src/scenes/landmarks/*` (unlock mapping for `oracle:`, `rubric:`, `devil:`, `expert:oral` ids), `apps/hub` event replay on connect.

## E2E-006 (P2) With a room open, Esc does not leave it and the transcript panel covers the next room's Enter prompt
Journey J10. Steps: walk into Council Hall, press Esc, click the Debate Stage chip, wait for the walk. Expected: Esc leaves the interior; the "Open Debate Stage" prompt is clickable. Actual: Esc leaves the interior drawn; the prompt sits behind the "What they are saying" panel (`elementFromPoint` returns the panel), so a mouse user cannot enter the next room (keyboard Enter works only after blurring the chip). Evidence: `j10-village/prompt-behind-transcript.png`, `after-esc-*.png`. Owner/files: web, `packages/web/src/overlays/room-info/RoomLayer.tsx` (panel position / z-index, Esc handling), village input in `packages/village/src/world/interact.ts`.

## E2E-009 (P2) Personas page: empty Voice picker with no explanation
Journey J11. Steps: no ElevenLabs key, open /squad/personas. Expected: a notice such as "Voice previews are unavailable without an ElevenLabs key" or a labelled fallback voice. Actual: the Voice section renders no options and no text. Evidence: `j11-media/personas-voice-empty.png`. Owner/files: web `packages/web/src/pages/personas/index.tsx` (voices.length === 0 branch), `GET /v1/voices` returns an empty list.

## E2E-010 (P3) Home checklist and phone step are not backed by real state
Journey J1. The Home "Get set up" card says "2 of 4 done" (phone, PDFs) for a fresh student before any setup, while the Setup stepper starts at step 1. The phone step accepts any 6-digit code and nothing is stored by the hub. Owner/files: web `packages/web/src/pages/home/fixtures.ts`, `packages/web/src/pages/setup/index.tsx`.

## Harness notes (not product bugs)
- `pnpm dev:all` uses the fixed agent ports 4101-4104, so two stacks (or another lead's teardown) kill each other; the e2e stack therefore boots hub, agents and web itself on its own ports (hub 8851, web 5251, agents 4151-4154).
- After batch 4 the web signs in through the accounts layer; journeys sign in through the real sign-in screen instead of injecting `squad.session`.
- J13 "hub killed" briefly looked like data loss and token rejection; it was a stale hub from an aborted run being adopted by the test. Fixed in the spec.
- J13 "credits depleted" is `blocked`: the Gemini endpoint cannot be stubbed and no model call happens without a real key; run it with a key via `LIVE=1`.
