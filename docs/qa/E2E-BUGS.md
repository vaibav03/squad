# E2E product defects

Filed by the e2e acceptance suite (branch e2e/acceptance). Product code is not touched from here; the orchestrator dispatches. Severity: P0 demo-stopping, P1 a headline journey cannot complete, P2 visible defect with a workaround, P3 polish or doc. Reproduce with `pnpm e2e <journey>` (see E2E-README.md); evidence under `docs/design/shots/e2e/<journey>/`.

| Id | Sev | Journey | Status |
|---|---|---|---|
| E2E-001 | P1 | J1 | open |
| E2E-002 | P2 | J1 | open |
| E2E-003 | P1 | J8 | open |
| E2E-004 | P1 | J10 | check (RoomLayer mounted by batch 3) |
| E2E-005 | P2 | J10 | open |

## E2E-001 (P1) Setup: course upload never finishes in live mode, Continue stays disabled
Journey J1. Steps: sign in as Ana against a live hub, /squad/setup/courses, add the OpenStax PDFs with "Browse files". Expected: each file reaches Ready and Continue enables. Actual: every file sits at "Reading 5%" forever although `POST /v1/squad/courses` returned 202 and `GET /v1/squad/courses` lists the course as `ready` within seconds. Cause (read from code): in `SetupPage` the ingest effect dispatches `courses/progress` (status `reading`) before `uploadCourse(...)` resolves; that state change re-runs the effect, whose cleanup sets `cancelled = true`, so the `.then` that would dispatch `ready` is dropped. Evidence: `docs/design/shots/e2e/j1-setup/courses-uploaded.png`. Owner/files: web, `packages/web/src/pages/setup/index.tsx` (effect around `uploadCourse`), `packages/web/src/pages/setup/model.ts` reducer.

## E2E-002 (P2) Setup: an uploaded .ics never reaches the hub or the agent
Journey J1. Steps: Setup step 3, "Upload .ics", pick `apps/agent/fixtures/ics/s_ana.ics`. Expected: the file (or its busy blocks) is POSTed to `/v1/squad/calendar` so the hub stores it and pushes it to the student's agent; later study and trip flows schedule around it. Actual: the page parses the file locally, shows "We found N busy blocks" and makes no request (only "Use the demo calendar" posts `{demo:true}`). The hub route accepts multipart `.ics` already. Owner/files: web, `packages/web/src/pages/setup/index.tsx` `CalendarStep.onPick`, `packages/web/src/pages/setup/api.ts` (`postCalendar` only supports demo).

## E2E-003 (P1) The fourth student is s_chi in the hub but s_cam in the agents
Journey J8. Steps: `pnpm dev:all`, start a trip with members s_ana, s_ben, s_chi, s_dev (the hub's squad) via `POST :4101/internal/start/trip`. Expected: confirmed. Actual: `no_plan` / `offline`, because no agent exists for `s_chi` (dev:all, `apps/agent/fixtures/peers.json` and the profile fixtures use `s_cam`; hub seed, sign-in screen and web use `s_chi`). Running with `s_cam` works but then `s_chi` never receives `trip.confirmed` or any flow event. Evidence: `docs/qa/E2E-REPORT.md` J8 rows. Owner/files: integration, `scripts/dev/all.ts` (STUDENTS, AGENT_PORTS), `apps/agent/fixtures/*` (s_cam.json, peers.json, ics/s_cam.ics) or the hub seed `apps/hub/src/sim/seed.ts`.
