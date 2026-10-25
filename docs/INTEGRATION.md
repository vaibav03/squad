# Integration checklist (collected from lead handoffs; merge phase)

Merge order suggestion: spine, hub, brain-answers, brain-quiz, mesh-crypto, mesh-flows, media-art, media-audio, motion, web-shell, web-live, village-world, village-mesh, village-scenes, demo. Expect trivial `pnpm-lock.yaml` and `package.json` conflicts; resolve by re-running `pnpm install`.

## Wiring that only happens at merge
- **brain**: add `export * from './quiz'` to `packages/brain/src/index.ts` (owned by brain-answers). Swap brain-quiz's injected mastery emitter for brain-answers' `emitMasteryChanged` so there is one code path.
- **bot (spine)**: register `createQuizSkill`, `createFeynmanSkill` (from `FeynmanEngine`), `createStepDiffSkill` (from `StepDiffEngine`), `createStudyPlanSkill` plus brain-answers' doubt/behind/hwPolicy skills. Share one `emit`, `db` and `MasteryStore`. Pass `chapterProviderFromStore(courseStore)` and `chapterIdsFromStore`.
- **hub**: call `QuizEngine.answer` and return only `{accepted: true}`; route `r.feedback` privately. Hub or spine calls `engine.reveal()` on timeout and `engine.advance()` when `autoAdvance` is false. Read `INTERNAL_EVENTS_SECRET`.
- **mesh**: implement `MeshScheduler.findSlots(students, durationMin)` for the study plan (brain uses a stub). `packages/mesh/src/index.ts` is wired by main from crypto + flows exports. mesh-flows must follow the gate rules in `docs/mesh-api.md` (mediator uses a second gate with `self:'mediator'`; `task.open` is sent by the coordinating student). `packages/mesh/README.md` holds the trust table; mesh-flows appends below the marker line.
- **village/web**: world layout slots per docs/village-api.md (homes spaced 145+ px); OverlayEvent includes `openConfirm`.

## Known gaps to close before demo day
- No real-key run yet for Gemini (vision JSON, model ids), ElevenLabs, or the brain evals: needs `.env` keys and `SQUAD_LIVE=1`.
- Venmo link format unverified (`mediator/split.ts` + regex in `protocol/schemas.ts`).
- Step Diff hash compare is syntactic (`x*x` vs `x^2`); group message shows split steps (private mode avoids it).
- `SqliteLedger` exists but the agent does not use it yet. Replay guard is in memory per gate.
- iMessage library unverified on macOS 27 (spine verification script).
- Autumn Town license is a page statement only; screenshot the page.
