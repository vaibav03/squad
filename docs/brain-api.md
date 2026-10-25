# brain API (answers half), published by ws/brain-answers

Consumers: brain-quiz (quiz, councils, feynman, stepdiff, studyplan, mastery), hub, spine, media. Import from `@squad/brain`.
Types are already on the branch: `packages/brain/src/ingest/types.ts`, `packages/brain/src/experts/types.ts`. Real implementations land behind the same signatures; code against these now.

Note on the Llm: core's real interface is `complete / json / createCache` with tiers `'fast' | 'main' | 'chair'` (not the spec 02 role names). Brain uses `fast` for the Dean and grading, `main` for experts, `chair` is left to brain-quiz councils. Images/PDFs go in `LlmPart` `{type:'image', mimeType, data}`.

## Data
```ts
interface Page    { courseId; chapter /*slug id*/; file; page /*1-based*/; text }
interface Chapter { courseId; id /*slug, valid in AgentId expert:<id>*/; title; summary; file; pageStart; pageEnd }
interface Course  { id; title; chapters: Chapter[]; policy?: string /* syllabus policy text */ }
interface CourseStore { saveCourse; saveChapter; savePages; getCourse; listChapters; getChapter; getPages; getPage; chapterContext }
```
SQLite tables (created by `createCourseStore(db)`, idempotent): `courses(id, title, policy)`, `chapters(course_id, id, title, summary, file, page_start, page_end)`, `pages(course_id, chapter, file, page, text)`, `call_transcripts(callId, agent, seq, text, cite)` (spec 03). Brain-quiz owns `mastery(student, courseId, chapter, box, nextDue)`, `quiz_*`; brain reads `mastery` read-only (behindSkill).
`Citation.chapter` is always the chapter id (slug). `Citation.file` is the cited file name, `page` 1-based, `quote` is verified to be on that page.

## Brain
```ts
createBrain(deps: { llm: Llm; db: Db; emit?: Emit; now?: () => number }): Brain
interface Brain {
  store: CourseStore;
  ingestPdf(courseId, path, opts?): Promise<number /* pages ingested */>;
  ask(courseId, question): Promise<ExpertAnswer>;      // Dean -> expert(s) -> verified answer
  expert(courseId, chapter): ChapterExpert;             // answer(question): Promise<ExpertAnswer>
  dean: { route(courseId, q): Promise<{ chapters: string[]; via: 'llm'|'bm25' }> };
  captions: CaptionPipeline;                            // see below
  emit: Emit;                                           // the event sink every skill must use
}
interface ExpertAnswer { text; citations: Citation[]; grounded: boolean; chapters: string[]; struck: number }
const NOT_IN_MATERIALS = 'Not in the materials. Ask the TA.'
```
`grounded=false` => `text === NOT_IN_MATERIALS`, `citations === []`.
Fixture course: `loadFixtureCourse(brain, 'demo')` ingests the committed OpenStax sample (3-4 chapters) and returns the `Course`; id `demo` by default. `FIXTURE_DIR` exported.

## Events (all through `Emit`, default core `postEvent`)
- Doubt/expert: `agent.state {agent:'expert:<chapter>', state:'studying'}` while answering, then `idle` (also on error; `finally`).
- Dean routing emits `agent.state` for `dean` the same way.
- Captions: one `call.caption {agent:'expert:<chapter>', callId, text, cite?}` per sentence; a sentence stating a fact without a verified cite is not emitted.
- behindSkill: `agent.state` for `student:<id>` only; nothing about the answer goes to the village.

## mastery.changed emission contract (for brain-quiz)
`mastery.changed {student, chapter, box}` is emitted by brain, from the same code path that writes `mastery`, exactly once per box move (not when the box stays the same), `chapter` = chapter id, `box` = new Leitner box (1..5). Brain-quiz's `mastery/` module owns the write and must call `emitMasteryChanged(emit, student, chapter, box)` (exported from `@squad/brain`, in `experts/emit.ts`) inside it. The hub filters it to the owner, so never put it in group text.

## Captions
```ts
interface CaptionPipeline {
  run({ callId, courseId, chapter, question, student? }, onLine?): Promise<CaptionLine[]>; // CaptionLine { seq; text; cite? }
  transcript(callId): CaptionLine[];
}
```
Media (05) calls `run` with the student's text (already transcribed) and speaks `CaptionLine.text` as lines arrive via `onLine`. The hub owns call.start/call.end.

## Skills (register in apps/bot skills registry)
`doubtSkill`, `behindSkill`, `hwPolicySkill`: factories `(brain: Brain) => Skill`, exported from `@squad/brain` as `createDoubtSkill`, `createBehindSkill`, `createHwPolicySkill`. `ingestSkill` is not in my slice.

## Citation checker (pure, no Llm)
`verifyClaims(claims: Claim[], pages: Page[]): { verified: Claim[]; struck: Claim[] }`, `quoteOnPage(quote, pageText)` (whitespace/case/punctuation-normalised substring), `parseMarkers(text)` for `[file p.N]`, `renderAnswer`. Exported from `@squad/brain`.

## Status
Types + this doc: done. Implementations in progress; see README section for run commands and the handoff report for what landed.
