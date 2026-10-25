# brain-quiz API (quiz half), published by ws/brain-quiz

Import everything below from `packages/brain/src/quiz/index.ts` (main wires one line into `@squad/brain`). Contracts only come from `@squad/core`.

## Quiz payloads (hub endpoints call `QuizEngine`)
```ts
// GET /v1/quiz/:quizId  -> engine.payload(quizId). NEVER contains the key or explanation.
QuizPayload = { quizId; chapter; index; kind: 'choice' | 'free'; question; choices?: string[] }
// POST /v1/quiz/:quizId/answer body (strict; no confidence/bet fields): { choice: number } | { text: string }
AnswerPayloadSchema.parse(body)           // 400 on failure
const r = await engine.answer(quizId, student, body)   // -> { accepted: true, graded, correct, feedback, phase }
// respond to the HTTP caller with { accepted: true } only; deliver r.feedback privately (DM / the answering student's own panel).
```
`choice` is a 0-based index. iMessage letters/digits map to it in `quizSkill` (A/1 = 0).

## Engine
`new QuizEngine({ db, llm, emit, mastery, chapters, verifier?, questionCount=3, squadSettings?, autoAdvance=true, now?, newId? })`
- `start(courseId, chapter, via, { students, target? }) -> quizId`; `payload`, `phase`, `answer`, `reveal` (timeout hook), `advance`.
- State machine in sqlite: `asking -> collecting -> reveal -> next -> asking | done` (`nextPhase` is pure). Tables `quiz_rounds`, `quiz_items`, `quiz_answers` (`ensureQuizSchema`, idempotent).
- Events (all through `emit`): `quiz.question`, `agent.state` (`expert:<chapter>` waiting_for_student, idle at the end), `mastery.changed` (before `quiz.answer`, same code path as the write), `quiz.answer` (student), `quiz.result`. Per-student `correct` appears in events only when `squadSettings().revealCorrectness` is true (default hidden). No scores, XP, streaks; nothing goes to a game bus.
- `chapters`: `ChapterProvider`; `chapterProviderFromStore(courseStore)` adapts brain-answers' `CourseStore` (chapter ids are slugs, same as `expert:<chapter>`).
- A grader outage never breaks a round: answer is accepted with `graded: false`, mastery untouched, student may resend.

## Councils (discrete awaited steps)
`createCouncilRun(cfg)` -> `{ id: 'council:<id>', opinions(), rankings(), verdict() }` (must be called in order; memoised; members parallel, events emitted in member order).
`createQuizKeyVerifier({ llm, emit })` implements `KeyVerifier` (`council:quizkey`: solver-a/b/c blind, chair `chair`; any disagreement with the key drops the question; key never in solver requests or events). `planCourse({ llm, emit, input })` runs `council:planner` (chill/grind/advisor). Events: `council.opinion`, `council.rank` (`order`), `council.verdict` (`dissent`, `dissenter`).

## Other skills (factories; register in apps/bot)
`createQuizSkill({ engine })`, `new FeynmanEngine(...)` + `createFeynmanSkill({ engine })`, `new StepDiffEngine(...)` + `createStepDiffSkill({ engine })`, `createStudyPlanSkill({ mastery, scheduler, emit, chaptersFor })`. Mesh implements `MeshScheduler.findSlots(students, durationMin)`; `createStubScheduler()` until then.

## Mastery
`createMasteryStore({ db, emit })` owns table `mastery(student, courseId, chapter, box, nextDue, updatedAt)` and emits `mastery.changed {student, chapter, box}` exactly when the box moves. brain-answers' `emitMasteryChanged` helper is equivalent (same strict event); both emit only through the supplied `emit`.
Helpers: `masterySummary(rows, now)`, `chapterHouseGlow(rows)`, `squadAggregate(rows, memberCount)` (null under 3).

## Run / test
`pnpm --dir packages/brain test`; smoke: `pnpm test:smoke brain`; real key (tiny budget, 14 calls max, needs `SQUAD_LIVE=1` and `GEMINI_API_KEY`): `SQUAD_LIVE=1 pnpm --dir packages/brain exec tsx src/quiz/realkey.script.ts`.
