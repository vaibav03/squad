# The 13 rooms

> **Update:** the separate rooms described below are scenery now. Every agent meets in one place, the Agent Hall (the former Council Hall), with one chat. The old room ids still work as links and open the hall with that agent selected. See `docs/village.md`, section Agent Hall.


Squad Village is a pixel campus. Each building is a **room**: a place where one kind of study help happens in the open, so your squad can see that it is happening without seeing your private answers. This page is the room reference. It is kept in step with `packages/village/src/scenes/roomInfo.ts` (the copy the app shows) and `docs/qa/ROOMS-AUDIT.md` (the engineering audit). Where code and audit disagree, the code on `origin/main` wins and this page says so.

For the step-by-step student view see [USER-GUIDE.md](USER-GUIDE.md).

**Mastery is in the village.** The chapter houses show your mastery on their signs, the chapter room panel and the Agent Inspector (for that chapter's expert) show the same words-plus-pips summary, and the **Mastery board** at the entrance of the study district opens the full panel. There is no separate Mastery page or tab.

![Room info panel in the village](../design/shots/ux/room-info/panel-1280.png)

> **Status box (read this first).** Verified against the merged tree on `origin/main` after batches 1 to 6 (rooms/a, rooms/b, council/ask, chat/web and qa/web are all on `main`; see `docs/tracking/MERGE-LOG.md`).
>
> - A chat phrase starts a room for all 13 slots except where the table says Partial: **chapter houses 1 to 4** (`quiz`), **Debate Stage** (`debate`), **Round Table** (`plan my next semester`), **Feynman Porch** (`feynman`), **Panic Line booth** (`diff`), **Exam Oracle**, **Oral Exam Hut**, **Rubric Courthouse**, **Devil's TA**.
> - **Council Hall** has an on-demand path: `@cubbie council <question>` (or `ask the council ...`) runs the council and posts a chat card and a web panel. The quiz answer-key check in the background is still not wired by default (`QuizEngine` is built without a verifier in `apps/bot/src/skills/index.ts`), so that part stays Partial.
> - Feynman Porch and Panic Line booth now emit under `expert:feynman` and `expert:stepdiff`, so their buildings light up (animation only: no transcript or outcome card by design).
> - What was verified: the recorded events of every room replay into the right scene, paint differently from idle and render their transcript and outcome card (`packages/village/src/scenes/roomsAll.test.ts`); the chat answers in demo mode. Not verified: a browser walk into each room, real-model output, the Oral Exam Hut microphone path.

## Table

| Room (slot) | What it is for | What to do (exact phrase) | What you get | Words and outcome shown? | Status on main | Branch / batch |
| --- | --- | --- | --- | --- | --- | --- |
| Chapter houses 1-4 (`chapter-1`..`chapter-4`) | Short chapter quiz from your own slides | `@cubbie quiz me on ch1` (also `chapter 3`, or just `quiz 3`) | Questions, whether you were right, which ideas to revisit and when. No grades. | Yes: question text, transcript strip, result mark | **Works** | none |
| Council Hall (`council-hall`) | Three blind solvers check a quiz answer key before you see it | `@cubbie council is this proof right?` (on demand). The quiz-key check also runs in the background when a quiz question is made, if a verifier is wired. | Three independent answers, the chair verdict (kept or dropped) | Yes: opinions and verdict | **Partial**: on-demand `@cubbie council <question>` works; the background quiz-key check only runs if the quiz engine gets a verifier, and `apps/bot/src/skills/index.ts` builds the engine without one by default (audit gap 2) | `council/ask` landed in batch 3 (web panel, hall, chat card) |
| Debate Stage (`debate-stage`) | Two sides argue a tricky question | `@cubbie debate should we ...?` | Both arguments and a closing summary | Yes: both arguments, vote and verdict outcome (replay-tested) | **Works** (chat phrase and scene; real-model output not verified) | landed in batch 2 |
| Course-Planning Round Table (`round-table`) | Three advisors argue out your next term | `@cubbie plan my next semester` (also `pick my classes`, `what classes should I take`, `register for next semester`) | A term plan: courses, credit total, workload in words, the one-line disagreement | Yes: advisors speak, rank, chairman plan card | **Works** (audit row updated by `ux/rooms`) | none |
| Feynman Porch (`feynman-porch`) | Explain an idea to a confused freshman | `@cubbie feynman ch3 gradient descent` | Up to two naive follow-up questions, then short written feedback | Chat yes; porch only partly (see note 1) | **Partial** | none |
| Panic Line booth (`panic-booth`) | Find the first step where two solutions split | In the group: `@cubbie diff` (add `private` to hide steps). Then two of you DM a photo of your work. | The step number where you split, not who is right | Chat yes; booth shows labels only (see note 2) | **Partial** | none |
| Exam Oracle (`exam-oracle`) | Suggest the chapter most worth studying next | `@cubbie exam oracle`, `what should I study next`, `predict my exam` | A chalk note such as "ch5 next?" | Yes: transcript and outcome (replay-tested) | **Works** (chat phrase and scene; real-model output not verified) | landed in batch 2 |
| Oral Exam Hut (`oral-exam-hut`) | Practise answering an examiner out loud | `@cubbie oral exam`, `practice an oral` | Examiner questions as live captions | Yes: transcript and outcome (replay-tested) | **Works** (chat phrase and scene; real-model output not verified) | landed in batch 2 |
| Rubric Courthouse (`rubric-courthouse`) | Check a written answer against Clarity, Accuracy, Gaps | `@cubbie rubric check`, or `check my answer against the rubric` | A tick or cross per criterion; feedback only, never a grade | Yes: transcript and outcome (replay-tested) | **Works** (chat phrase and scene; real-model output not verified) | landed in batch 2 |
| Devil's TA (`devils-ta`) | Spot the deliberate mistake hidden in a worked solution | `@cubbie devil's TA ch3 gradient descent`, or `find the mistake` | A chalk tick if you caught it, a red underline if you missed it | Yes: transcript and outcome (replay-tested) | **Works** (chat phrase and scene; real-model output not verified) | landed in batch 2 |

That is 13 slots: four chapter houses plus nine landmarks.

### Notes where code and audit differ

1. **Feynman Porch.** Since rooms/a the engine emits `expert:feynman`, so the porch animates (animation only; the chat carries the words). Written feedback still arrives in chat.
2. **Panic Line booth.** Since rooms/a the engine emits `expert:stepdiff`, so the booth animates (labels only; the step number arrives in chat).
3. **Round Table.** The audit's first table row still shows it as MISSING at audit time; its "Update (ux/rooms)" section and the code (`createCoursePlanSkill` is registered in `apps/bot/src/skills/index.ts`) show it works. This page follows the code.
4. **Phrase wording.** The study-plan skill (`study plan`, `plan the midterm`) is a different feature and does not use the Round Table. Course-planning phrases that mention study, exams, quiz or finals are deliberately left to the study plan skill.

## Room by room

### Chapter houses (4)

Practise one chapter with short questions built from your own course files. Answer with a letter or a few words. The house glows as the chapter sinks in. Your squad sees that you practised, not your answers.

![Chapter house, chalk tick](../design/shots/ux/scenes/chapter-house-interior-chalk-tick.png)

### Council Hall

Quiz answer keys are checked by three solvers who never see each other or the key. If anyone disagrees, the question is dropped. Only course questions are discussed here.

![Council Hall verdict](../design/shots/ux/scenes/council-hall-verdict-outcome.png)

### Debate Stage

Meant for two sides of a debatable idea with a moderator summing up. Debates use course topics only.

![Debate Stage verdict](../design/shots/ux/scenes/debate-stage-interior-verdict.png)

### Round Table

Chill protects your sleep, Grind packs credits, Advisor checks prerequisites, the Chairman merges them. It uses the sample catalogue and the courses you list, and nothing is shared with your squad unless you confirm.

![Round Table outcome](../design/shots/ux/scenes/round-table-interior-outcome.png)

### Feynman Porch

You explain; a curious freshman asks why. Your explanation stays between you and Cubbie.

![Feynman Porch message](../design/shots/ux/scenes/feynman-porch-interior-message.png)

### Panic Line booth

Two photos of handwritten steps are lined up. Photos stay between you and Cubbie. The group sees only the step number.

![Panic Line booth](../design/shots/ux/scenes/panic-booth-interior-message.png)

### Exam Oracle

Uses only your own study history to name the next chapter. Nothing is shared.

![Exam Oracle question](../design/shots/ux/scenes/exam-oracle-interior-question.png)

### Oral Exam Hut

Spoken practice with an examiner and live captions. It stays between you and the examiner.

![Oral Exam Hut call](../design/shots/ux/scenes/oral-hut-interior-call.png)

### Rubric Courthouse

Three criteria, ticks and crosses, never a number.

![Rubric Courthouse marks](../design/shots/ux/scenes/rubric-courthouse-rubric-marks.png)

### Devil's TA

One hidden error. Only you see whether you caught it.

![Devil's TA caught](../design/shots/ux/scenes/devils-ta-caught.png)

## Entering a room

Rooms need no phrase to visit. Walk your avatar to a door at `/squad/village`. Each room has an info strip and panel explaining who is inside, what to type, what you get and what is private. Scenes that have no live source yet are shown as an empty room, never a faked result. The Replay badge appears when the village plays a recorded run (`?replay=track2`).

## Keeping this page honest

Regenerate the table check by diffing against `packages/village/src/scenes/roomInfo.ts` (`how.phrase` per slot: chapters, council hall, round table, feynman, panic booth have phrases; the other five are `null`). When batch 2 lands, those five phrases move into `roomInfo.ts` and the status box above should be rewritten.
