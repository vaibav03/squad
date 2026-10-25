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

## Motion (from the motion handoff)
- `apps/web-host/package.json` needs `"@squad/village": "workspace:*"`; then change `apps/web-host/src/lab/motion/prims.ts` to `export * from '@squad/village/motion'`.
- village-world must call `rt.update(delta)` from `Scene.update`, use `pauseWhenHidden`, and call `rt.cancelAll()` on scene shutdown (ambient loops run until cancelled).
- web-shell's `useCalmMode` should wrap motion's `calmModeStore` / `createUseCalmMode` so the DOM and canvas share one Calm value.
- Post-merge pass (needs react and vite installed): typecheck and run the Motion Lab (`/__motion`), capture frame strips for every row into `docs/design/shots/motion/`, run the art-director critique and the second review round.
- Owner feel-checks (judge on a real phone, play at 2-5x): walk speed 48 px/s and 80 ms stop; envelope pop/glide/stagger; council stagger and rank slide; bubble hold 1.2 s per 20 characters; conflict pop; waiting ring; 400 ms camera pan; trip cutscene pacing; day/night tween; dissent lantern; speaking bob and glow; Calm mode feel; drawer slide and button press.

## Media audio (from the media-audio handoff)
- Needs `ffmpeg` and `ffprobe` on PATH.
- Run `pnpm --filter @squad/media design-voices` once with `ELEVENLABS_API_KEY`, then commit `saved-voices.json` (currently empty).
- Hub wires `createAudioServices().mediaPort(personas)` and `.callPort({answer})` in `apps/hub/src/index.ts`; add the `audio.end` frame and call `replyToAudio()` on `mute:true` or `audio.end`.
- Spine registers `podcastSkill` and `explainerSkill` around `makePodcast` / `makeExplainer`; use `ctx.dm` when `result.dm` is set. Brain supplies `AnswerFn` and the podcast/explainer material providers.
- No extension events: media emits only VillageEvents (decision). Clip URLs travel on the call socket.
- Run `SQUAD_LIVE=1 pnpm --filter @squad/media smoke:live` first; unverified until then: ElevenLabs `/stream` path and `mp3_44100_64`, the stock fallback voice id `21m00Tcm4TlvDq8ikWAM` and whether `GET /v1/voices` lists premade voices, Gemini `models.generateContent` vs the newer Interactions API, image generation with `responseModalities: ['IMAGE']` on `gemini-nano-banana-2.1`, and real-speech loudness.
- Do the real-phone m4a, PNG and GIF delivery check.

## Spine (from the spine handoff)
- Register skills in `apps/bot/src/skills/index.ts`: `buildRegistry([chatSkill], brainSkills, meshSkills, mediaSkills)`. Media or the integrator calls `registerPersonas(...)` at startup. `ctx.llm` tiers are `fast | main | chair` (core), not the spec's fast/strong/vision.
- Owner gate for iMessage (needs no secrets): sign Messages.app into the spare Apple ID; Full Disk Access for the exact terminal app, then restart it; allow the Messages Automation prompt; make an iPhone group named exactly `Cubbie Test` with the bot ID plus 1-2 friends; fill real handles in `apps/bot/fixtures/students.json`; rehearse with `pnpm exec tsx scripts/verify-imessage.ts --dry-run --yes`, then run `pnpm exec tsx scripts/verify-imessage.ts --group "Cubbie Test" --to <your number>`. Exit 0 = `TRANSPORT=imessage`; FAIL on check 2 "text is empty" = macOS 27 attributedBody problem, use `TRANSPORT=discord` (`apps/bot/DISCORD.md`). Run `caffeinate -dis` during the demo.
- `ctx.send` from inside a skill bypasses the unprompted cooldown (documented). Discord is tested only with a fake client. Apple may flag a spare ID with bot-like volume (sends capped at 1/s).
