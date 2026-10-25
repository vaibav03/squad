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

## Brain answers (from the brain-answers handoff)
- Register `answerSkills(createBrain({llm, db}))` in the spine registry (skills: `doubt`, `behind`, `hwpolicy`). Media calls `brain.captions.run({callId, courseId, chapter, question, student?}, onLine)` and speaks the returned lines.
- The mastery writer (brain-quiz) must go through `emitMasteryChanged(emit, student, chapter, box)` exported from `@squad/brain` (one code path).
- The OpenStax fixture (Introductory Statistics 2e, CC BY 4.0: ch2, ch3, ch6, ch12) needs a visible attribution in the root README and credits; cited page numbers are page indexes inside the excerpt PDF, not printed book pages.
- Unverified until a real run: Gemini explicit cache creation and hits, answer quality, vision-page ingest. Real eval: `BRAIN_REAL_EVAL=1 pnpm --filter @squad/brain eval:real` (capped by `BRAIN_EVAL_MAX_CALLS`, default 14). Citation strictness knobs: `MIN_QUOTE_CHARS`, `MIN_QUOTE_WORDS` in `citations/check.ts`.
- Dean BM25 fallback gets the right chapter 88% (14/16); it cannot say "none" for off-topic questions with rare shared words, so the quote check refuses them.
- Model ids: main now defaults to the verified gemini-3.x ids (the brain notes still mention 2.5 from before the fix).
- Canvas ingest (B12) and replay-fixture recording (B11) were not in this slice and remain open.

## Hub (from the hub handoff)
- Replace the stub ports in `apps/hub/src/main.ts` via `createHub({ports})`: `createAudioServices().mediaPort(personas)` and `.callPort({answer})` from media; brain supplies `QuizPort` and `BrainPort`.
- Mesh sends hub-only envelopes with core's `postHubEnvelope`: `x.trip.upsert` (full TripRecord incl. private limits) and `x.ledger.private` (raw withheld for the owner view). VillageEvents still go through `postEvent`. The hub drops a `trip.confirmed` unless every member confirmed; seeded squad id is `sq_demo`.
- Clients: fetch the snapshot, open the stream with `Last-Event-ID=seq`, refetch the snapshot on `x.resync`; trip changes arrive as `x.trip.updated` (already per-viewer filtered). Dev login: `POST /v1/auth/dev-login`, `GET /v1/auth/students`. Port 8788; `HUB_CORS_ORIGINS` for other hosts.
- Gaps: the event log, trips, ledger and directory are in memory (a restart loses them; clients get `x.resync`; spec wants the shared SQLite, a contained change in `store/eventlog.ts` and the stores). Sign-in is a stub, single process. No real-key smoke script.

## Design foundation (from its handoff)
- `pnpm dlx playwright install chromium` before using `docs/design/tools/capture.mjs`.
- Still missing art: interiors for debate stage, courthouse, oracle and devil's TA cave; animals, birds, fireflies; rain/snow; left/back-facing frames (engine flips right-facing); a 4-frame idle. Building anchors in provenance.json are stale (pre-trim); anchor is bottom-centre.
- Weak spots to polish later: lit-window spill, interior lamp dithering, sofa/stalls/bunting crispness, dawn bands, tree highlights, tiny faces at 1x. The last dusk background revision was regenerated but not re-viewed. The Playwright capture script and the walk cycle were never run or watched.
- Walk speed decision: 36 px/s at 12 fps (3 px planted-foot per frame), with Left/Mid/Right presets and tap-to-walk for distance.
- Chapter-house row uses only the hut and smaller landmarks; larger Autumn Town houses are one-per-screen or backdrop.

## Demo (from the demo handoff)
- After merging hub and web-shell: run `pnpm demo:preflight` and `pnpm demo:replay track2`, then check visuals against the beat tables in `docs/demo/track2/README.md` and `track3/README.md`. `demo:replay` on bare main stops with a "merge ws/hub" error until the hub lands.
- Chapter ids disagree: the hub seed uses `cse310`, `expert:ch5`, `qz_ch5_*`; the brain fixture chapters are `ch2`, `ch3`, `ch6`, `ch12`; the replays use `ch6`, `ch12` and demo course id `demo`. Make the hub seed and brain agree at integration.
- Web host dev port is 5180 (web-shell), the launcher passes `HUB_CORS_ORIGINS` and `VITE_HUB_BASE_URL` (variable name is a guess: check the host's actual name).
- If the village adapter treats `agent.message.kind` strings differently, adjust the replays. Kinds used: task.open, psi.blind, psi.tokens, psi.common, share.vec, share.sum, conflict, option_dropped, query, query_denied, result.
- The doubt answer panel and Step Diff are hub-endpoint panels with no VillageEvent, so the replay only shows agent states around them (the presenter narrates).
- Owner must sign in to `hackathon.py` to produce the submission previews (`docs/submission/PREVIEWS.md`); `--yes` only after review. Not done yet: GIFs (`docs/demo/media/trackN.gif`), screen recordings and dry runs (need the integrated village and real phones). Cost per question is unmeasured.

## Web-live (from the web-live handoff)
- The trip page navigates to `/squad/village?cutscene=trip&task=<id>` 3 s after `trip.confirmed`; the web host must pass that query to `mountVillage` (village-mesh supports a direct `playCutscene('trip', {taskId})`, once per taskId, skippable).
- Add a one-line adapter from `useSquadConfig()` to `LiveConfig {mode, hubUrl, token, userId}` so pages leave mock mode.
- web-live uses its own `--lv-*` aliases of `docs/design/tokens.css` (`src/overlays/kit/bridge.css`) and page parts in `overlays/kit`, because web-shell primitives had not landed: swap page headers for `Page` and buttons for primitives, or keep. AppShell may double the padding of `.lv-page`. `packages/web/package.json` (react, react-dom, react-router-dom, zod, test/dev deps) will conflict with web-shell's: union them.
- Route registry should discover `pages/{ledger,trip,mastery}/index.tsx` default exports. Overlays mount inside a relative stage (they render `sq-scene` on their own root).
- Hub response shapes for `/v1/ledger`, `/v1/trips`, `/v1/mastery` and the `trip.updated` shape are parsed defensively but unverified against the real hub; the projector toggle is client-side until the hub exposes its flag.
- Ledger is paper cards in columns, not a wood notice board (DESIGN.md forbids fantasy chrome). Not covered: the call panel has no "agent offline" state or group variant; `useMedia` first-paint flash at 1280; keyboard-only flow only unit-tested; confirm-sheet, quiz-done, error and offline screenshots were never read.
- Personas page and HUD chips still use the Fluent 3D avatars / single letters: switch them to the pixel portraits from the design foundation cast.

## Village scenes (from the village-scenes handoff)
- Merge ws/village-world first; `scenes/module.ts` is picked up by the world's glob. Only a `capture` script was added to package.json (trivial conflict). `packages/village/.scratch/` is gitignored.
- apps/web-host must serve repo `assets/` at `/assets` (the scenes module also loads manifest images itself under `sc:<path>` texture keys).
- Id conventions: council ids `council:quizkey|planner|debate`; experts `expert:feynman|stepdiff|panic|oral|examiner|rubric|oracle|devil|devils-ta`; chapter houses claim `ch<N>` by digit (N<=4), else the next free slot; landmark quiz chapters use tokens like `oracle:ch5`, `rubric`, `devil`.
- The world's HUD and a11y list should show each building's `describe()` text (the module only feeds the `announce` live region and interactable labels).
- Canvas uses a 3x5 pixel font for signs, chalk and bubbles, not Jersey 10 (DESIGN.md asks for Jersey): deviation to resolve.
- Open polish: oral-hut and Feynman chimney smoke are two large circles (should be single 2 px puffs); phone check showed the Enter prompt overlapping feet, HUD dock chips cropped, a doubled moon and cloud edge bands; call captions on one building replace each other before the 1.2 s/20 chars hold (single bubble key); `AssetLib.frame` cannot reach atlas portrait keys (landmark A cut portraits from frames); squad size defaults to 0 and viewer to '' until the world sets `ctx.me` and registry `squadSize` (fail-closed: no mastery or per-student marks until then).
- No unit test for `scenes/module.ts` (needs a Phaser/DOM fake); verified through a live world run only. The layout/phone, type, colour and motion reviewers did not run.

## Wire-bot (from the wire-bot handoff, branch wire/bot at c10cf72)
- `pnpm check` exits 0 from the root on wire/bot; per-package unit and smoke results: core 30/2, bot 140/8, agent 6/4, hub 15/36, web-host 31/1, web 32/1, village 201/2, brain 152/4, mesh 55/46, media 65/1, demo-scripts 37/none.
- All ten skills registered (chat, doubt, behind, hwpolicy, quiz, feynman, stepDiff, studyPlan, podcast, explainer) on one shared emit/db/MasteryStore; the 50-line banter suite passes with all registered. Without `ELEVENLABS_API_KEY` the podcast and explainer skills are not registered (the bot says so at startup).
- Mesh exports no chat skill; the study plan uses brain's stub scheduler until wire-hub's `findSlots` is merged.
- One mesh test (ring PSI) timed out at the 5 s default under parallel load: now 30 s, no behavior change. REPL exits with "readline closed" on piped stdin (cosmetic, pre-existing).
- Multi-skill scripted session: `cd apps/bot && pnpm chat`, then `/script fixtures/scripts/multi-skill.json` (needs ffmpeg/ffprobe).
