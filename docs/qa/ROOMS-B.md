# Rooms B: Exam Oracle, Rubric Courthouse, Oral Exam Hut

Branch `rooms/b`. All three work with FakeLlm in tests. With a real key that returns HTTP 402 (credits depleted) every skill degrades to a deterministic "demo mode" with no retry loops (oral live script run once: fell back to chapter-title questions and a template summary).

## Exam Oracle (`packages/brain/src/skills/oracle`)
- Triggers (anchored, needs a mention): `exam oracle`, `what should I study next`, `predict my exam`. Score 0.95.
- Ranking is code only (`rankChapters`): due bonus + low Leitner box + weight of chapter keywords in past-exam/syllabus pages. The LLM writes one mock question and a why line per top topic; failure uses a template question.
- Events: `agent.state expert:oracle`, `quiz.question` (chapter `oracle:<ch>`, `text`), `council.opinion` + `council.verdict` on `council:oracle` carrying `RoomOutcome`. Never grades. Group replies use words only (no box numbers); DMs may show boxes.

## Rubric Courthouse (`packages/brain/src/skills/rubric`)
- Trigger: `rubric check` (or "check my answer against the rubric") with a mention. Answer from text, image (vision transcription) or PDF; rubric pasted or extracted from the syllabus/assignment pages.
- Feedback only: tick/cross per Clarity, Accuracy, Gaps; evidence quotes must be verbatim substrings of the student's text (verified in code); grade tokens and model-answer sentences scrubbed; hwpolicy line quoted verbatim.
- Events: three `quiz.result` (chapter `rubric:<name>`), `council:rubric` opinions and verdict with outcome.

## Oral Exam Hut
- Chat: `@cubbie oral exam` rings the hut (`agent.state expert:oral waiting_for_student`) and explains. Exam: call `expert:oral` or `expert:examiner` through the existing call route. `createOralExaminer` asks 3 questions, at most one follow-up each, then a feedback-only summary; `ScriptedAgent` hook in the media call port; the websocket ends the call (`call.end`) when `session.finished()`.
- Typed text works with no mic; captions-only without TTS or ElevenLabs key.

## Village and web
- `council:oracle|rubric` routed to their rooms (`routing.ts`); the Landmark B kit handles council opinion/verdict so the room transcript and OUTCOME card work; oracle chalk label strips the `oracle:` namespace. `roomInfo.ts` copy and phrases updated. "Plan is ready" in the transcript is now "Outcome ready".

## Verify
`pnpm --filter @squad/{brain,bot,village,web,hub,media} test` all green; bot banter suite (50 lines) green with the new skills plus near-miss tests. Shots: `docs/design/shots/rooms-b/{before,after,after-scenes}`; regenerate with `scripts` in `packages/brain/src/skills/rooms-b.record.script.ts` and `packages/web/src/overlays/room-info/dev/shoot-rooms-b.mjs`.

## Not verified
Browser call UI to `expert:oral` end to end, live mic transcription, ElevenLabs voice, live Gemini output (402).
