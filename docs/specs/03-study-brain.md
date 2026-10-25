# 03: Study brain (draft for approval)

Workstream: `packages/brain` (in the `app/` workspace). Track 3, with some reuse in Track 1. Conforms to `00-OVERVIEW.md`, including the Village event contract.
Every feature is a `Skill` that the router (02) picks. It uses `Ctx.llm`, `Ctx.db`, `Ctx.dm` and `Ctx.askConfirm`, and every answer carries `Citation[]`.

## Summary
Tag `@cubbie` in the group and it answers from **your class's own slides**, citing file and page. When something isn't in the materials, it says "not in the materials".
Behind @cubbie sits a swarm. A **Dean** routes each question to a **chapter expert**, and each expert holds one chapter in cached context. In the Squad Village (09) each expert is a house, and students can walk in, join a voice call and take quizzes. The experts also run plain quiz rounds (question, answer, feedback) and Feynman checks. There are no scores, XP or rankings; the village looks like a game, and house glow is the only progress display.
Two features only a group can use: **Step Diff** (two photos of handwritten work, first step where they split, no verdict) and **Group study plan**. An **LLM council** (3 members answer independently, rank each other, a chairman gives a verdict) checks quiz keys and plans courses.
The edge over Meta AI or ChatGPT group chats is grounding, citations and group-native mechanics, not plain Q&A.

### Demo moments
1. `@cubbie why does MSE have a 2?` → a two-line answer with "(Ch3 slides, p.14)". Then `@cubbie what's on the final?` → "Not in the materials. Ask the TA."
2. In the village, walk into the Ch5 house, join the call, hear the expert teach with live captions that cite pages, then take the quiz. The same quiz in iMessage gives the same feedback.
3. The Council Hall lights up: three members state opinions, rank each other, and the chairman's verdict names the dissenter, if any.
4. `@cubbie diff` → Maya and Jake each DM a photo → "You agree through step 3. Step 4 splits. Defend your step."
5. `@cubbie plan midterm` → chapters split by who's weak where (privately), times come from the mesh (04), and houses glow by mastery.
6. `@cubbie am I behind?` → a private DM with your own mastery summary. `@cubbie just do HW3 Q2` → a hint plus the syllabus policy, never the answer.

## In the village
Features map to buildings (09). Each skill emits `VillageEvent`s (see 00) from the code path that does the work, never from a separate script. Withheld values never appear; only the label and "hidden".
| Feature | Building | Events it must emit |
|---|---|---|
| Chapter expert, doubt answering | Chapter house | `agent.state` (`studying` while answering, `idle` after, `waiting_for_student` in a quiz) |
| Voice call with an expert | House call panel | `agent.state` `in_call` (voice calls only); `call.start` / `call.end` come from the hub; brain's caption pipeline emits `call.caption` (with `cite`) through the hub |
| Quiz round | House quiz panel | `quiz.question`, `quiz.answer`, `quiz.result`, each with `quizId`, `chapter`, `target?`. Per-student `correct` is included only if the squad setting allows it (default hidden). Nothing is emitted to any game or score bus. |
| LLM council (quiz-key verify, course planning) | Council Hall | `council.opinion`, `council.rank` (with `order: string[]`), `council.verdict` (with `dissent?: boolean`, `dissenter?: string`); ids `council:<id>` |
| Feynman check | Feynman Porch | `agent.state`, `quiz.*` style result via the shared engine |
| Step Diff | Panic Line | `agent.state`, `agent.message` (labels only; photos stay private) |
| Study plan | Course-Planning Round Table | `agent.message`, `confirm.pending` / `confirm.done` |
| Mastery changes | House glow (progress display) | 03 is the only emitter of `mastery.changed {student, chapter, box}` (the hub filters it to the owner). It fires from the same code path that writes `mastery`. |
| "Am I behind?" | DM only | `agent.state`; nothing about the answer goes to the village |
Event shapes are defined in 00 and only cited here. Minimum group size: for squads under 3, brain hides all counts, averages, topic aggregates that could identify a person (plan stats, topic summaries).
Other buildings (Oral Exam Hut, Debate Stage, Rubric Courthouse, Exam Oracle, Devil's TA) belong to other specs; brain exposes experts, rubric scoring and citations to them.

## Scope
Everything is built. "Core" is built first, "Later" after it.
| Feature | Phase | Notes |
|---|---|---|
| Course ingest: uploaded PDFs → chapters → pages | Core | `unpdf` per-page text. Chapter = one file, or split by headings. |
| Dean router → chapter experts, with citations | Core | Haiku routes; Sonnet answers with the chapter cached. |
| @cubbie doubt answering ("not in the materials" fallback) | Core | The headline feature. |
| Quiz engine (one engine for iMessage and village) | Core | 3 questions, plain feedback per answer, no scoreboard. |
| Council (quiz-key verify) | Core | Discrete opinion, rank and verdict steps, see below. |
| Feynman check | Core | Runs in DM, group or village; a rubric gives feedback on clarity and gaps. |
| Step Diff | Core | Claude vision; LLM equivalence check (sympy skipped). |
| Group study plan | Core | Assignment is local; times come through `MeshScheduler`. |
| Mastery per student per chapter | Core | Leitner boxes ported from Exam Mode; no FSRS or BKT. |
| Village event emission (incl. `mastery.changed`) and call captions | Core | Tickets B9–B11. |
| "Am I behind?" private mastery summary | Core | `behindSkill`; DM only, own data only. Ticket B16. |
| Homework-help policy skill | Core | `hwPolicySkill`: hint plus syllabus policy, never the answer to graded work. Ticket B17. |
| Canvas API ingest (token, course files) | Later | Same output as PDF ingest. |
| Course-planning council (`council:planner`: chill / grind / advisor → chair) | Later | Single-student, so a DM or the Round Table. |
| Whisper Coach, Swiss Cheese Guide | Later | Normal tickets (B14, B15), built after Core. |
| Out of scope | No | Embeddings or a vector DB, a professor-style clone, image-model diagrams. |

## Key design
- **Ingest.** Each PDF goes through `unpdf` into `Page` rows (courseId, chapter, file, page, text) in SQLite. A chapter's pages join into one context block with `[file p.N]` markers.
- **Grounding.** Each expert's system prompt is the chapter context with `cache_control`. Citations: (a) Anthropic Citations (`page_location` → `Citation`) or (b) prompted `[file p.N]` markers with code checking the quote is on that page. Use (b) first. With no supporting page the expert replies "not in the materials".
- **Dean router.** Haiku picks 1 or 2 chapters (or "none") from titles plus 3-line summaries, falling back to BM25 over pages. With 2 chapters both experts answer and Sonnet merges, keeping all citations.
- **One quiz engine.** A state machine in the db: `asking → collecting → reveal → next`. There is a single `quizId` everywhere (events, API, db). iMessage and the village are two front ends over the same engine and db tables. A quiz answered in the village is handled exactly like one in iMessage. Plain quiz: question, answer, feedback; no confidence bets or calibration. Haiku grades free text. Answers go to `quiz_answers` and the Leitner box updates per chapter, emitting `mastery.changed`.
- **Quiz payload and endpoints.** `GET /v1/quiz/:quizId` returns `{quizId, chapter, index, kind: 'choice' | 'free', question, choices?}` (no answer key). `POST /v1/quiz/:quizId/answer {choice | text}` returns `{accepted: true}`; correctness reaches the student privately and reaches the squad only per the setting (default hidden). Both live on the hub and call `QuizEngine`.
- **Council as discrete steps.** The council runs as three separately returned phases, not one blob: (1) each member's independent `opinion`, (2) each member's `ranking` of the others (best first, emitted as `order`), (3) the chairman `verdict` with `dissent: boolean` and `dissenter` (the member whose answer the verdict overrode; the first one if several). Each phase is an awaited step that returns structured data and emits its event, so the scene can animate members one at a time. Two councils, with ids `council:<id>` and member names defined here: `council:quizkey` (members `solver-a`, `solver-b`, `solver-c`, chair `chair`) verifies quiz keys (3 blind solves; disagreement drops the question and shows "uncertain"); `council:planner` (members `chill`, `grind`, `advisor`, chair `chair`) plans courses (Later).
- **Call transcript and caption contract.** A call is a `callId` tied to one expert. The voice layer (05) speaks the expert's answer; brain supplies the text in sentence-sized chunks. Each chunk is one `call.caption` event, posted to the hub's `/internal/events` through the `packages/core` helper (the hub owns `call.start`/`call.end`), carrying `text` and, when it states a fact, a `cite: Citation`. Uncited factual chunks are not allowed: the citation check runs before the caption is emitted. The full transcript with citations is stored so the dashboard (06) can replay it. Student speech arrives as text via 05 and goes through the same grounding path as a doubt.
- **Feynman check.** The student explains a concept; a "confused freshman" asks up to 2 naive "why"s; a grader gives feedback on accuracy, completeness and plainness (no points) and lists missed points with citations.
- **Step Diff.** `@cubbie diff` opens a session; both people DM a photo; vision turns each into steps; an aligner finds the first non-equivalent pair and its concept tag. The group sees only matching steps and the split step, never a verdict. The concept goes to the mastery queue of whoever was wrong.
- **Study plan.** Mastery is read privately. Greedy assignment gives each person chapters they're strongest in with equal load. Times come from `MeshScheduler.findSlots` (04), via a stub until 04 is ready. Each person confirms by DM through `askConfirm(student, question, options, taskId)`, which returns `string | 'timeout'`.
- **"Am I behind?"** (`behindSkill`). Triggered by `@cubbie am I behind?` in the group or a DM. Reads the asker's own `mastery` and due dates and replies by DM only: weakest chapters, what is overdue, and one next step. Never reveals other students' data, and the group only sees a short "sent you a DM". No squad comparison or counts.
- **Homework-help policy** (`hwPolicySkill`). For requests like "just do HW3 Q2": detect graded work from the course's syllabus policy (ingested like other files). Reply with a hint grounded in the slides (with citation) plus the syllabus policy line, and never the answer to graded work. Ungraded practice can get fuller help. If the syllabus has no policy, say so and default to hint-only.

### Interfaces (only the ones others depend on)
```ts
interface Page { courseId: string; chapter: string; file: string; page: number; text: string }
interface ExpertAnswer { text: string; citations: Citation[]; grounded: boolean }   // grounded=false → "not in the materials"
interface Brain { ingestPdf(courseId: string, path: string): Promise<number>; ask(courseId: string, q: string): Promise<ExpertAnswer> }
interface CouncilRun { id: string /* 'council:quizkey' | 'council:planner' */; opinions(): Promise<{ member: string; text: string }[]>; rankings(): Promise<{ member: string; order: string[] }[]>; verdict(): Promise<{ text: string; dissent: boolean; dissenter?: string }> }
interface QuizEngine { start(courseId: string, chapter: string, via: 'imessage' | 'village'): Promise<string /*quizId*/>; answer(quizId: string, s: StudentId, text: string): Promise<{ correct: boolean }> }
interface MeshScheduler { findSlots(students: StudentId[], durationMin: number): Promise<{ start: number; end: number }[]> } // implemented by 04
```
Skills: `doubtSkill`, `quizSkill`, `feynmanSkill`, `stepDiffSkill`, `studyPlanSkill`, `coursePlanSkill`, `whisperCoachSkill`, `swissCheeseSkill`, `ingestSkill`, `behindSkill`, `hwPolicySkill`.
Data (SQLite): `pages`, `chapters`, `quiz_rounds`, `quiz_items`, `quiz_answers`, `mastery(student, courseId, chapter, box, nextDue)`, `diff_sessions`, `call_transcripts(callId, agent, seq, text, cite)`.
Layout: `packages/brain/src/{ingest,experts,skills,council,events}/`, `mastery.ts`, `prompts/*.md`, `fixtures/` (demo course PDFs, pre-shot solution photos).

## Build tickets (order and dependencies only)
| # | Ticket | Est. | Depends on |
|---|---|---|---|
| B1 | Ingest: PDF → pages → chapters (+ summaries), tables, fixture course | 1.5 h | 02 core db/llm |
| B2 | Dean + chapter expert + citation check + BM25 fallback, `Brain.ask` | 2 h | B1 |
| B3 | `doubtSkill` (answer formatting, "not in the materials") | 0.5 h | B2 |
| B4 | Quiz engine (one engine, two front ends) + feedback + mastery (Leitner) | 2 h | B2 |
| B5 | Council with discrete opinion / rank / verdict steps; quiz-key verify | 1.5 h | B4 (stubbed interface) |
| B6 | Feynman check skill | 1 h | B2 |
| B7 | Step Diff: vision → steps → align → group/DM flow, fixture photos | 2.5 h | 02 attachments |
| B8 | Study plan: assignment + `MeshScheduler` stub + askConfirm | 1 h | B4, 04 interface |
| B9 | Event emitter (`events/`): wrap `agent.state`, `quiz.*` (with `quizId`), `council.*` (with `order`, `dissent`, `dissenter`) and `mastery.changed` around B2–B8 using the `packages/core` helper, and unit-test the emitted sequences | 1 h | B2, B4, B5, 06 hub |
| B10 | Call text and caption pipeline: sentence chunks, citation gate, `call.caption` via the hub, stored transcript | 1.5 h | B2, 05 voice, B9 |
| B11 | Replay fixtures: record real brain runs as VillageEvent scripts for 09 | 0.5 h | B9, 09 replay format |
| B12 | Canvas API ingest | 1.5 h | B1 |
| B13 | Course-planning council (reuses B5) | 1.5 h | B5 |
| B14 | Whisper Coach | 1.5 h | B2, 05 voice |
| B15 | Swiss Cheese Guide | 1.5 h | B4, B6 |
| B16 | `behindSkill`: private mastery summary by DM (own data only, min-group rule) | 1 h | B4, B9 |
| B17 | `hwPolicySkill`: syllabus policy detection, hint with citation, never the graded answer; eval cases | 1 h | B1, B2 |

Order: B1 and B7 start together; B2 follows B1; B3–B6, B8, B16 and B17 run in parallel; B9–B11 after those; B12–B15 (Later) after Core passes its smoke tests.

## Smoke tests (vitest, real API key, fixture course)
- In-material question → `grounded=true`, at least 1 citation, and the cited page contains the quoted words. Off-material → `grounded=false`, "not in the materials".
- A quiz run through iMessage and through the village with the same fake students gives identical feedback; mastery boxes move after right and wrong answers.
- A council run returns opinions, rankings and a verdict as separate steps, in order, each emitting its event; a deliberately wrong key is dropped and `dissent` and `dissenter` are set.
- A call yields `call.start`, captions each with a valid `cite` whose quote is on the page, then `call.end`; the stored transcript matches.
- Step Diff on the fixture pair → split index equals the known index (4).
- Study plan with 3 students → every chapter assigned once, load differs by at most 1, stub slots appear.
- `mastery.changed` fires on every box move, for the owner only.
- `GET /v1/quiz/:quizId` never contains the key; answering via the endpoint matches iMessage feedback; the answer payload has no `confidence` field and nothing is sent to any game bus.
- `@cubbie am I behind?` replies by DM with only the asker's data; in a squad under 3 the group sees no counts.
- `@cubbie just do HW3 Q2` on a graded item returns a hint plus the policy, and no final answer.
- Emitted events never contain withheld values (`'hidden'` only).

## Risks
- **Citation drift:** the code checks the quote is on the page; otherwise drop the claim or answer ungrounded. Captions are gated the same way.
- **Handwriting OCR** on messy photos: use clean fixtures, and fall back to asking the student to type the split step.
- **Latency:** cached chapters with Haiku routing; send a "thinking…" tapback if iMessage replies are slow. Captions stream by sentence so calls feel live. The council runs before a round starts.
- **Event drift:** if a skill's behavior changes but its events don't, the village shows something false. B9 tests lock the event sequences; Live and Replay must match.
- **Two quiz front ends diverging:** keep all rules in `QuizEngine`; front ends only render.
- **Council stage cost:** three phases means more calls; run members in parallel inside each phase, and keep phase boundaries so the scene can animate.
- **iMessage photo handling** depends on 02: Step Diff photos arrive by DM, so the group never sees full solutions.
- **Context size:** if a chapter is over about 60k tokens, split it into sub-experts by heading.

## Decisions for you
1. **Citations method:** (b) prompted `[file p.N]` markers checked by code, or (a) Anthropic Citations. **Recommend (b)** first (works with caching and our JSON); move to (a) later if wanted.
2. **Demo course:** which PDFs as fixtures? **Recommend** one real course with 3–4 chapters (physics or ML, which suits Step Diff).
3. **Canvas ingest:** now a normal ticket (B12) built after Core. Confirm.
4. **Spaced repetition:** Leitner or FSRS? **Recommend Leitner** (already proven in Track 1).
5. **Council shape:** two councils with defined ids and members (`council:quizkey`: solver-a/b/c; `council:planner`: chill/grind/advisor), each with a chair and discrete steps for animation. Confirm.
6. **Step Diff math check:** LLM-only or add sympy? **Recommend LLM-only** (no Python dependency).
7. **Course-planning council, Whisper Coach, Swiss Cheese Guide:** now normal tickets (B13–B15) after Core. Confirm.
8. **Caption granularity:** one `call.caption` per sentence. **Recommend** sentence level; word level adds event volume without value.
9. **No gamification (decided):** no XP, levels, streaks, confidence bets, calibration, leaderboards or mastery points; mastery is Leitner boxes shown only as house glow. Confirmed.
