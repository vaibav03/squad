# Rooms audit (13 village rooms)

Evidence from the code at this branch. Status: OK = chat trigger exists and the village receives events for that room; PARTIAL = trigger exists but the room's own events are not emitted (or a precondition is off by default); MISSING = no skill, trigger or emitter.

Routing (events carry ids only): `packages/village/src/scenes/routing.ts`. Placements: `registry.ts`. Chat skills are registered in `apps/bot/src/skills/index.ts` (quiz, feynman, stepDiff, studyPlan) and `packages/brain/src/skills/*`.

## Table

| Room (slot) | What the student gets | Backing skill / engine | Chat trigger (exact, works today) | Reachable from chat? | Reachable by entering? | Words shown? | Outcome shown? | Status | Cheapest fix |
|---|---|---|---|---|---|---|---|---|---|
| Chapter houses 1-4 | Short chapter quiz from own slides, review later | `QuizEngine` `packages/brain/src/quiz/engine.ts`, skill `skills/quiz/quizSkill.ts` | `@cubbie quiz me on ch1` (regex `\bquiz(?:\s+me)?(?:\s+on)?\s+(.+?)$`, needs a chapter; `ch3`, `chapter 3`, `3`) | Yes: emits `quiz.question/answer/result` and `agent.state` for `expert:<chapter>` (engine.ts:209-367), routed to chapter house | Yes (just events) | Before: question text carried in scene; no persistent transcript | Before: result mark only | OK | none (transcript and outcome panel are the new work) |
| Council Hall | Quiz answer key is checked by three blind solvers | `createQuizKeyVerifier` `packages/brain/src/councils/quizkey.ts`, generic run `councils/council.ts` | Same as quiz: `@cubbie quiz me on ch2` (verification is a side effect of generating a question) | PARTIAL: only if the engine gets a `verifier`. `apps/bot/src/skills/index.ts:67` builds `QuizEngine` without one; hub `real.ts:48,100` passes it only if supplied | Yes | Before: opinions as bubbles, 80 ms stagger, no transcript | Before: verdict banner only | PARTIAL | pass `verifier: createQuizKeyVerifier({ llm, emit })` in `apps/bot/src/skills/index.ts` (needs a real LLM; FakeLlm cannot) |
| Debate Stage | Two sides argue a tricky question | none (scene handles `council.*` on `council:debate`) | none | No: grep finds no emitter of `council:debate` outside scene shots/sim | Only the empty stage | No | No | MISSING | Add a `councils/debate.ts` (two members + chair via `createCouncilRun`, `id: 'debate'`) and a skill with a phrase, e.g. `@cubbie debate <topic>` |
| Round Table | Term plan from three advisors | `councils/planner.ts` (chill/grind/advisor/chair). Planner is only called from tests/demo today; new `coursePlanSkill` (`packages/brain/src/skills/courseplan`, councilId `council:planner`) is being added by a parallel agent | `@cubbie plan my next semester` (provided by the new skill; NOT yet verified: dir absent at audit time) | Yes once coursePlanSkill is registered; note the old `studyplan` skill (`study plan`, `plan the midterm`) emits `agent.message` from `dean`, not `council:planner` | Yes (events only; sim `apps/hub/src/sim/demo-run.ts` also emits it) | Before: thought bubbles with opinion text, no transcript | Before: verdict banner only | **OK after ux/rooms**: `coursePlanSkill` landed and is registered in `apps/bot/src/skills/index.ts` (score 0.95, banter suite green); verdict carries `outcome`, shown as the OUTCOME card and the in-room plan sheet | done. Remaining: the room's 'Run it' button needs the host to send the phrase to chat (`<RoomLayer onRun>`) |
| Feynman Porch | Explain an idea to a confused freshman, get feedback | `FeynmanEngine` `packages/brain/src/feynman/engine.ts`, skill `skills/feynman/feynmanSkill.ts` | `@cubbie feynman ch3 gradient descent` (regex `\bfeynman\s+(?:chN\s+)?(.+)$`) | PARTIAL: the skill works in chat, but the engine emits `agent.state` for `expert:<chapter>` (engine.ts:131,153,170), not `expert:feynman`, so the chapter house animates, not the porch | Only the idle porch | No | No | PARTIAL | emit `expert:feynman` state/captions in `feynman/engine.ts` (or map `expert:chN` during a feynman session in routing) |
| Panic Line booth | Find the first step where two solutions split | `StepDiffEngine` `packages/brain/src/stepdiff/session.ts`, skill `skills/stepdiff/stepDiffSkill.ts` | `@cubbie diff` in a group (needs mention + `\bdiff\b`), then DM photos; add `private` for hashes only | PARTIAL: engine emits `agent.state`/`agent.message` for `dean` (session.ts:162-188), not `expert:stepdiff` | Only the idle booth | No (labels only by design) | No | PARTIAL | emit `expert:stepdiff` `agent.state`/`call.caption` ("your steps split at step 3") in `stepdiff/session.ts` |
| Exam Oracle | Which chapter to study next | none (scene reads `quiz.question` with chapter namespaced `oracle`, `landmarks/exam-oracle`) | none | No emitter of `expert:oracle` or `oracle` quiz ids (only an offline eval in `packages/brain/evals/oracle.ts`, unrelated) | Only the idle orb | No | No | MISSING | New skill reading mastery (`packages/brain/src/mastery`) and emitting `quiz.question` for chapter `oracle:<chN>` plus a chat phrase |
| Oral Exam Hut | Practise answering aloud | none (scene reads `call.*`/`agent.message` for `expert:oral`/`expert:examiner`) | none | The hub call route (`apps/hub/src/routes/call.ts:38`) emits `call.start` for any agent id a student calls, but answers go through `brain.captions` with chapter `oral` (`apps/hub/src/adapters/real.ts:313`), which has no such chapter; not verified end to end | Locked hut | No | No | MISSING | Examiner skill/persona in `packages/media/src/personas` and a call `answer` branch for `expert:oral` that asks questions from a chapter; chat phrase optional |
| Rubric Courthouse | Check an answer against Clarity, Accuracy, Gaps | none (scene reads `quiz.result` for chapter namespaced `rubric`) | none | No emitter | Only empty rows | No | No | MISSING | New skill grading a written answer on three criteria and emitting `quiz.result` for `rubric:<chN>` (tick/cross only) |
| Devil's TA | Find the hidden mistake in a solution | none (scene reads `quiz.result` for chapter namespaced `devil`) | none | No emitter | Blank board | No | No | MISSING | New skill that plants one error in a worked solution and emits `quiz.result` for `devil:<chN>` |

"Words shown?" and "Outcome shown?" record the BEFORE state (what the scene carried; no transcript or outcome panel existed). The `rooms.ts` / `roomSession.ts` / `roomInfo.ts` work adds the in-room transcript, outcome and explanation. The Round Table, Council Hall and Debate Stage events carry opinion/rank/verdict text; chapter houses carry question text; landmarks keyed on `quiz.*` carry labels only (tick/cross, chalk note).

Other chat skills that exist but have no room: `behind` ("am I behind", "how am I doing"), `doubt` (any question for grounded answers), `hwpolicy` ("just do my homework"), `podcast`/`explainer` (`apps/bot/src/skills/media.ts`: "podcast", "picture it").

## Update (ux/rooms)

Fixed here: Round Table (skill, sample catalogue `packages/brain/fixtures/catalog`, grounded prerequisite/credit checks, outcome); all rooms now show full public words with the 1.2 s per 20 chars dwell and a transcript strip, and room info panels exist for all 13. Gaps 1 below is done. Gaps 2 to 7 are outside the paths this workstream owns (brain engines, bot wiring of the verifier, media/hub) and are listed for the integration step.

## Gaps, ranked by cost

1. Register `coursePlanSkill` in `apps/bot/src/skills/index.ts` (one line, after the parallel agent lands it). Unlocks Round Table.
2. Wire the quiz key verifier in `apps/bot/src/skills/index.ts` (one line, needs a real LLM). Unlocks Council Hall from normal quizzes.
3. Emit room agent ids from existing engines: `expert:feynman` in `packages/brain/src/feynman/engine.ts`; `expert:stepdiff` in `packages/brain/src/stepdiff/session.ts`. Small; unlocks Feynman Porch and Panic Booth.
4. Rubric Courthouse and Devil's TA skills plus `quiz.result` emitters with namespaced chapter ids (`rubric:`, `devil:`). Medium; each needs a prompt and a chat phrase.
5. Exam Oracle skill (mastery-driven chapter suggestion, emits `quiz.question` with `oracle:` id). Medium.
6. Debate Stage council (`packages/brain/src/councils/debate.ts` + skill + phrase). Medium; the council runner is generic.
7. Oral Exam Hut: examiner persona and a call answer branch for `expert:oral` (`packages/media`, `apps/hub/src/adapters/real.ts`). Largest; needs voice path.

## Not verified

- `coursePlanSkill` and its phrase (code not present when audited; phrase taken from the brief).
- Whether the web call UI exposes a call button for landmark agents; only the hub route was read.
- Live behaviour with a real LLM; all findings are from reading code and grepping emitters (`rg "council:|expert:"`).
