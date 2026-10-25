# E2E bugs: rooms, trip, mastery (branch e2e/rooms)

Run on `e2e/rooms` (origin/main + qa/web merged; chat/web NOT merged, see D6), demo mode
(`FORCE_FAKE_LLM=1`), hub 8871, web 5271, Ana (`s_ana`) unless noted. Happy paths only.
Screenshots: `docs/design/shots/e2e/rooms/`.

## D1: /squad/trips loads the fixture trip id and jumps to the cutscene

- Severity: medium. Confidence: high on the symptoms, medium on the root cause.
- Steps: sign in as Ana (live hub, no trip created yet), open `/squad/trips`.
- Expected: the trip planner shows the squad's real trip, or an empty or error state. A trip-confirmed
  cutscene plays only for a trip this squad confirmed.
- Actual: the page calls `GET /v1/trips/trip_cabo` (404). The hub's trip id is `task_trip_cabo`. The
  SSE stream then replays a historical `trip.confirmed` for `task_trip_cabo`, and the page navigates to
  `/squad/village?cutscene=trip&task=trip_cabo`. The trip page id is the route param, not the event's
  `taskId`.
- File guess: `packages/web/src/pages/trip/fixtures.ts:5` (`TRIP_ID = 'trip_cabo'`);
  `packages/web/src/pages/trip/index.tsx` (`onTripConfirmed` builds the URL from the route id, not the event).
- Evidence: probe `GET /v1/trips/trip_cabo` plus `/v1/squad/stream?...&lastEventId=38` (not a screenshot).

## D2: Chapter house room panel is clipped on a phone (390x844)

- Severity: low. Confidence: high (seen in screenshot).
- Steps: sign in as Ana at 390x844, open `/squad/village`, walk into Chapter 1 (after `quiz.question` seed).
- Expected: the room panel fits the viewport. Its body, including the "Say this in chat" phrase, scrolls
  above the bottom nav. The "?" help button and the panel close button do not overlap.
- Actual: the panel body runs under the bottom nav. The "Say this in chat" phrase is cut off. The
  "?" help button sits under the panel's top-right close button.
- File guess: `packages/web/src/overlays/room-info/room-info.css`; the shared frame in
  `packages/web/src/overlays/kit` (OverlayFrame, dock placement on narrow screens).
- Evidence: `docs/design/shots/e2e/rooms/chapter-1-390-panel.png`

## D3: Council verdict leaves a blank band under the dock at 1280x800

- Severity: low. Confidence: medium.
- Steps: walk into the Council Hall at 1280x800, ask "B or C?" (sample chip), submit, wait for the verdict.
- Expected: the verdict card scrolls inside the dock. The stage stays full height behind it.
- Actual: after the verdict auto-focus the page scrolls. The dock ends at about y=575 and the lower
  part of the viewport (about y=590 to 800) is an empty dark band. The "Copy verdict" button sits at
  the dock's bottom edge.
- File guess: `packages/web/src/council/CouncilPanel.tsx` (verdict focus and scroll, around the
  `useEffect` on `view.verdict`); `packages/web/src/council/council.css` (dock height).
- Evidence: `docs/design/shots/e2e/rooms/council-verdict.png`

## D4: Council Hall entry skips the room's own info panel and names the dialog "Ask the council"

- Severity: low (a11y and copy). Confidence: high.
- Steps: walk into the Council Hall for the first time in a browser session.
- Expected: the room-info panel ("Council Hall", purpose, how to use it) opens once, as in other rooms.
  The dialog name matches the room.
- Actual: only the council dialog opens, named "Ask the council". The room-info panel never shows on
  the first entry. The "What does this room do?" button is still there.
- File guess: `packages/web/src/council/CouncilHall.tsx` (`useInCouncilHall`, dialog `aria-label`) against
  `packages/web/src/overlays/room-info/RoomLayer.tsx` (first-entry `open` logic).
- Evidence: `docs/design/shots/e2e/rooms/council-hall-1280-panel.png`

## D5: Mastery course card shows column headers with no rows

- Severity: low. Confidence: high.
- Steps: sign in as Ana (demo hub, no concepts for `cse310`), open `/squad/mastery` at 390x844.
- Expected: an empty course shows one clear empty line, not an empty table.
- Actual: the card "CSE310 / NOT STARTED" shows the `CONCEPT` and `YOU` headers with no rows under them.
  The legend and the "Nothing started yet" note are fine.
- File guess: `packages/web/src/pages/mastery/MasteryView.tsx` (`ChapterCard`, the table renders before
  the empty check).
- Evidence: `docs/design/shots/e2e/rooms/mastery-390.png`

## D6: chat/web does not merge into qa/web; J8 cannot run

- Severity: high for integration. Not a runtime bug.
- Steps: `git merge --no-ff origin/chat/web` onto `origin/qa/web`.
- Expected: clean merge.
- Actual: conflicts in five files. Two are real forks of the same feature.
  - `packages/core/src/llm/resilient.ts`: qa/web has `reprobeMs`; chat/web has `probeEveryMs` and
    `invalidKeyProbeEveryMs` with a `lastProbeAt`/`nextProbeAt` status.
  - `apps/hub/src/routes/status.ts` and `apps/hub/test/smoke/squad.smoke.test.ts`: notice keys `auth` vs
    `invalid_key` and `rate_limited`, and different status fields.
  - `packages/web/src/pages/village/index.tsx`: qa/web mounts `RoomLayer` and `CouncilHall`; chat/web
    mounts `ChatDock`.
  - `assets/pixel/composed/scripts/__pycache__/palette.cpython-314.pyc` (a committed bytecode file).
- Effect: the chat UI (and so J8 podcast/explainer cards) is not on e2e/rooms. J8 is a skipped stub.
- File guess: pick one `resilient.ts` design, then re-merge; drop the committed `__pycache__` file.

## Not defects (checked and cleared)

- Chapter 4 and 1 houses enter normally once a quiz event exists. Chapter 1 is locked until its first
  `quiz.question`. The spec seeds one through `POST /internal/events`.
- The trip replay (`?replay=track2`) carries `task.open`, `confirm.pending`, `confirm.done` and
  `trip.confirmed` in that order.
- Walking across the village to the far houses takes about 40 s. This is slow, not broken.
