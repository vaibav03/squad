# Brief: brain (spec 03), branch ws/brain

**Mission:** the study intelligence: grounded answers with citations, quizzes, the council, Feynman, Step Diff, study plan, and the call caption pipeline, all emitting village events.

**Build:** PDF ingest to chapters (Gemini vision/PDF or unpdf) with an OpenStax sample course fixture of 3 to 4 chapters committed under packages/brain/fixtures with attribution; Dean router; chapter experts using the cached chapter context, answering only from the chapter with [file p.N] markers verified in code (a claim without a verified quote is struck, 'not in the materials' otherwise); QuizEngine (asking → collecting → reveal → next, one engine for iMessage and village, plain feedback, no scores); the two councils (quiz-key solvers; planner chill/grind/advisor) as discrete awaited opinion → rank → verdict steps with dissenter; Feynman check; Step Diff (two students' photos in, first divergent step out, never a verdict or the correct line); studyPlanSkill via the mesh scheduler interface; behindSkill (private DM) and hwPolicySkill (hint, citation, never the answer to graded work); mastery.changed with Leitner boxes; call.caption pipeline gated by the citation check; all event emission through the core helper.

**Quality bar:** golden-set evals (questions with known pages; unanswerable questions must be refused; planted wrong pages must be rejected), property tests on the citation checker, fake-Llm determinism, a real-key eval script behind a flag with a tiny budget, latency and quota degradation paths, prompts versioned in files and reviewed like code.

**Sub-agent ideas:** ingest, experts+citations, quiz engine, councils, Step Diff, skills, captions, eval suite.
