# Session log (project history to date)

Hand-written once from `git log --all`, `docs/DECISIONS.md`, `docs/PHASE0-NOTES.md`, `docs/WORKFLOW.md`, `docs/INTEGRATION.md`, `docs/INTEGRATION-STATUS.md` (on `integration/final`), `docs/agents/*.md`, `docs/specs/*.md`, `docs/qa/*.md` (on `ux/rooms` and `rooms/a`), `docs/demo/QA.md` (on `qa/web`) and the commit messages of every remote branch. Everything below happened on one calendar day, Saturday 2026-10-24, between 20:03 and about 23:15 (author time, UTC-7). Unlike `BRANCHES.md`, `CHANGELOG.md` and `AGENTS.md` this file is not regenerated; new phases should be appended by hand, and the generated files are the source of truth for exact counts.

How to read the evidence tags. Nothing in this log was re-run by the tracker; the tags only record what the branches themselves say.

- **[V] verified**: the branch states that tests, lint or screenshots passed AND the artefact is in git (tests, committed screenshots under `docs/design/shots/**`, scripted e2e under `apps/web-host/e2e/`).
- **[C] claimed**: stated in a doc or commit message with no committed evidence the tracker could find.
- **[U] unverified / not done**: the docs themselves say it was not exercised or is missing.

Also: the remote is `https://github.com/vaibav03/squad.git` (private). Every commit is authored by the owner's git identity (three spellings of it: `Vaibav Venkatapathy`, `Vaibav`, `vaibav03`); the `Co-Authored-By: Claude Sonnet 5.5` trailer is on most commits but not all. Authorship therefore says nothing about which lead did the work; the branch name does.

## Phase 1. Ideas research, specs and decisions (before 20:03)

- Pre-history is not in git. The only artefact is the first commit `16c882d` (20:03, "Initial commit: specs, decisions, assets"): `README.md`, `.env.example`, `.gitignore`, `docs/DECISIONS.md`, the spec set, and an `assets/fluent-characters/` bundle (Fluent UI Emoji, MIT, with licence files) used as early avatar candidates.
- Specs `00` to `09` (`docs/specs/`): 00 overview and shared contracts (the `VillageEvent` union, repo layout, ids); 01 Exam Mode update (Picture It, Recap Radio; Track 1); 02 iMessage bot spine; 03 study brain (ingest, chapter experts, doubts with citations, Step Diff, study plan, course-planning council); 04 per-student agent mesh and trip planner (Track 2); 05 personas, voice and media; 06 web dashboard and hub; 07 demo and submission; 08 village motion (tickets M-1..M-9); 09 game scenes (Phaser side-view village). `_REVIEW-FIXES.md` is the orchestrator's cross-spec consistency pass (event contract, id grammar, `Ctx.askConfirm`). Two prompt files for Claude Design (`CLAUDE-DESIGN-PROMPT*.md`) were written alongside.
- Known inconsistency [U]: `_REVIEW-FIXES.md` still lists gamification-flavoured events (`raid.started`, `boss.hit`, `champion.stage`, `streak.updated`) while `DECISIONS.md` removed those features and the Phase 0 core implemented 16 event types. The tracker did not diff the two, so which of them survive in `@squad/core` is not confirmed here.

### Key decisions (docs/DECISIONS.md, 2026-10-24)

1. One project with all features, one repo, submitted to Track 2 and Track 3 with two demo scripts.
2. Demo cast: 3 real phones for Track 3, simulated students for Track 2, Replay mode as the backup for both.
3. Course material: 3 to 4 chapters of an OpenStax textbook PDF. No Canvas in the demo.
4. Art: Autumn Town (itch.io) plus CC0 packs, recolour missing buildings, no generated art. (Later superseded in practice by procedural pixel art from the design foundation, then by the licensed Modern Interiors pack; see phases 5 and 8.)
5. Phaser 3.90. Stakes Pact and Handicap League removed. Action layer builds only calendar invites and the Lock-In Lobby.
6. "Ignore the clock and build everything in parallel; submit when done."
7. Private GitHub repo `squad`, push regularly, git worktrees to parallelize.
8. Web UI is a library (`@squad/web`) plus a small standalone host; the hub is a standalone server with a base-URL setting; later integrated into the Nook clone.
9. LLM provider is Gemini (key in `.env`, never committed); voices are ElevenLabs. Solo team; the owner signs in for submission.

## Phase 2. Workflow and Phase 0 scaffold (20:07 to 20:18)

- 20:07 `8926f5d`: specs updated for the standalone repo, Gemini and village motion; `docs/WORKFLOW.md` added (Phase 0 by one agent, then worktrees under `squad-wt/`, one agent per worktree, no checking out a branch twice).
- 20:10 `a18c49d`, `43167b1`: `docs/agents/_PREAMBLE.md` and one brief per lead (`spine`, `hub`, `brain`, `mesh`, `media`, `motion`, `village`, `web`, `demo`).
- 20:10 to 20:15 Phase 0, all on `main`: `b461421` pnpm workspace and skeletons; `efbe555` `@squad/core` (contracts, `VillageEvent` and replay schemas, `postEvent`, `Llm`, db, config, sentinel util); `009d6a6` GitHub Actions check and README; `ebc2bcc` CI never cancels runs on main; `129764a` Gemini default model ids verified and the secret env name made canonical; `b53e4bf` `FakeLlm` made browser-safe.
- Recorded deviations (`docs/PHASE0-NOTES.md`): `@squad/core` is browser-safe with Node-only pieces under `@squad/core/node`; `Llm` is provider-agnostic with tiers `fast|main|chair`; `postEvent` never throws on network failure; schemas are strict (unknown keys rejected, `ledger.entry.withheld` only `'hidden'`); no tsconfig project references; `pnpm check` = typecheck + lint + test.
- **Evidence**: CI file and tests exist [V by presence]. The tag `phase0` exists on origin and points at `ebc2bcc` (the CI-never-cancels commit, 20:13).

## Phase 3. The 15 workstreams (20:12 to about 20:55)

`docs/agents/SPLITS.md` (`702cd44`, 20:12) replaced the 9-row ownership table with 15 exclusive-ownership slices, each on a branch `ws/<name>` in `squad-wt/<name>`, each publishing an API doc on its own branch first:

| # | Branch | Slice | Branch tip landed (author time) | Notes |
|---|---|---|---|---|
| 1 | `ws/spine` | iMessage bot, router, policy, confirm, memory, CLI, recorder, transports (iMessage, Discord) | 20:37 | `docs/spine-api.md`; adversarial suites; owner must verify iMessage on macOS 27 [U] |
| 2 | `ws/hub` | Hono hub: SSE, snapshot, replay, quiz, call, seed, leak and load tests | 20:37 | `docs/hub-api.md`; final commit adds `x.trip.limits` merge and secret ballot |
| 3 | `ws/web-shell` | web host, AppShell, primitives, sign-in stub, setup, personas studio, gallery | 20:35 | `docs/web-api.md` |
| 4 | `ws/web-live` | ledger page, trip, mastery, call panel, quiz card, confirm sheet | 20:42 | `docs/overlays-api.md`; screenshots committed |
| 5 | `ws/village-world` | Phaser boot, scene manager, parallax, character, camera, HUD | 20:50 | `docs/village-api.md`; shots committed |
| 6 | `ws/village-scenes` | council hall, chapter houses, 8 landmarks | 20:51 | privacy gate review fixes; in-world shots committed |
| 7 | `ws/village-mesh` | event adapter (16 events, exhaustive), sources, mesh view, cutscene, a11y | 21:42 | longest branch (43 commits); later hardened |
| 8 | `ws/motion` | motion runtime, tokens, curves, Motion Lab at `/__motion` | 20:30 | `docs/motion-api.md`; owner feel-checks listed in `docs/INTEGRATION.md` [U] |
| 9 | `ws/brain-answers` | PDF ingest, Dean, chapter experts, citations, doubt/behind/hwpolicy skills | 20:30 | OpenStax fixture with attribution; golden evals use FakeLlm |
| 10 | `ws/brain-quiz` | quiz engine, Feynman, Step Diff, study plan, mastery (Leitner), councils (quiz key, planner) | 20:26 | real-key script exists, real eval not run [U] |
| 11 | `ws/mesh-crypto` | PSI, secret sharing, privacy gate, ledger, protocol, mediator | 20:22 | `docs/mesh-api.md`; red-team tests; README trust table |
| 12 | `ws/mesh-flows` | agent server, study and trip flows, Bouncer, scripted replay export, ics import | 20:35 | hub private channel (`x.ledger.private`, `x.trip.upsert`) |
| 13 | `ws/media-art` | personas, sprite atlas, portraits, iMessage GIF builder, Persona Wall | 21:41 | rebuilt twice: 32 px side-view cast, then direction-ready v3 top-down atlas |
| 14 | `ws/media-audio` | voices, TTS, podcast, explainer, call path, delivery | 20:30 | `docs/audio-api.md`; ElevenLabs never called [U] |
| 15 | `ws/demo` | merged replays (track2, track3), seed pack, preflight, READMEs, video scripts | 20:33 | root README, `docs/demo/*` |

Design foundation (on `main`, not a workstream branch; commits 20:11 to 20:31 prefixed `design:`): 28-colour master palette, typography (Jersey 10, Silkscreen, Inter), `DESIGN.md` v1 with `tokens.css`/`tokens.ts`, parallax backgrounds and time-of-day skies, props/fx/ui sprites, van and notice board, an 11-character side-view cast with portraits and atlas, night buildings and landmarks, a review rubric and screenshot tool, an asset palette checker, and an asset manifest with a deterministic generator (`ee13e96`). Art is procedural (Python), regenerated byte for byte per a later check on `integration/final`.

Between 20:28 and 20:51 every lead wrote a handoff and the orchestrator folded them into one `docs/INTEGRATION.md` checklist on `main` (`3a2570c` and about ten `docs: <lead> items in integration checklist` commits). That checklist is the best single list of wiring that only happens at merge, plus the early known gaps (no real-key run, Venmo link format, iMessage on macOS 27, Autumn Town licence screenshot, Step Diff is syntactic).

**Evidence for the phase.** Each branch's commits say lint, typecheck or tests were green on that branch; `integration/preview` (below) re-ran the merged result, which is the first cross-check. Per-branch claims are [C] until then.

## Phase 4. Preview integration (about 20:37 to 20:53)

- `integration/preview` (tip `4c4e23e`, 20:46; worktree `squad-wt/integration`). A throwaway branch built from `main` plus all 15 `ws/*` branches. Status doc `docs/INTEGRATION-STATUS.md` on that branch, written honestly:
  - Merged all 15; conflict resolutions listed (lockfile regenerated, 3-way `package.json` union, village-mesh's older copy of village-world replaced, gate authority given to mesh-crypto so mesh-flows' own gate edits are NOT in, `VITE_HUB_URL` aligned, `assets/` served by the web host, a new village page added).
  - **[V]** `pnpm install` and `pnpm typecheck` pass for all 11 projects; core 30 and hub 15 tests pass; hub (8788) and web host (5180) start via `pnpm demo:replay track2 --no-open`; replays track2 (80 events) and track3 (50 events) validate and play in the real Phaser village, desktop and 390x844, with screenshots committed.
  - **[U]** at that point: `pnpm lint` failed (7 eslint errors in `packages/web/review-live/shoot.mjs`, 22 unformatted files), one failing bot test (discord attachment download), the rest of the test suites not collected because the run stops at the first failing package, the real overlays not yet mounted on the village page, chapter-id mismatch (hub seed `cse310`/`expert:ch5` vs brain `ch2/3/6/12`), no spine skill registry, no brain/media ports in the hub.

## Phase 5. Wiring wave (about 20:48 to 22:20)

Four leads took the preview's "not done" list, each on a `wire/*` branch built on the preview lineage:

- `wire/bot` (tip `c10cf72`, 21:42): lint fixed (node globals for `.mjs`), discord test de-flaked, skills from brain and media registered in the bot registry with personas and shared emit, an adversarial banter suite over the whole skill registry, multi-skill scripted session fixture and demo LLM (`pnpm bot:chat`), a 30 s timeout for the CPU-heavy PSI property test so `pnpm check` is stable. [V]: tests exist in git; claimed green.
- `wire/hub` (tip `da77a36`, 21:47): hub seed and fixtures aligned to brain chapter ids (course `demo`, `ch6`), persistent sqlite for events, trips, ledger, directory, a mesh `findSlots` scheduler, real brain/quiz/media ports in hub main (stubs without `GEMINI_API_KEY`), and `pnpm demo:live` (hub plus four mesh agents plus fake bot chat with stream assertions). [V by script]
- `wire/web` (tip `e811bae`, 22:20): world-agnostic village host page, overlay host (call, quiz, confirm) wired to hub and replay stub, trip cutscene, pixel portraits in Personas/setup/Avatar, trip and mastery pages moved onto shell primitives, two review rounds (a11y focus, mic race, blob leaks, tap targets, Inter for read text) with refreshed screenshots. [V]: screenshots committed.
- `integration/final` (worktree `squad-wt/final`; started 22:23, tip `984c0ee` at 23:08, `INTEGRATION-STATUS.md` honest table at 23:04): rebased everything onto one branch and added: persisted hub applied to the secret-ballot trip view, agents posting their own `x.trip.limits`, the study-plan skill using the mesh scheduler, a camera director and night-gradient loading state, quiz card closing on the viewer's `quiz.result`, quiz public prompt on the stream with sentinel tests, Gemini and ElevenLabs adapter fixes against current docs (thought-signature echo, 4096-token cache floor, `/v2/voices`), typed `LlmError` plus `createResilientLlm` real-to-fake fallback with automatic re-probe every 60 s (10 min for an invalid key), `pnpm dev:all`, `pnpm run doctor`, `GET /v1/status`, calendar import into `hub_busy_blocks` pushed to the owner's agent, and `POST /v1/confirms/:taskId`.
  - **[V]** per its own table, last full verification: `pnpm install`, `pnpm typecheck`, `pnpm lint` (0 errors, 2 pre-existing warnings), `pnpm check` exit 0, every smoke suite, `pnpm demo:live` in both modes, `pnpm demo:preflight` (16 pass, 4 warn). Test counts quoted there: core 40, brain 155 plus 36 evals, mesh 61, media 79, hub 17, agent 8, bot 147, web 73, village 445, interior 62, web-host 31, demo scripts 37. Flaky bot and mesh tests ran 3x in parallel with 0 failures.
  - **[U]** Gemini: key present but the live API returns HTTP 402 (prepaid credits depleted), so real answer quality, cache hits and vision ingest are unverified; adapters were checked against docs by reading, not by calls. ElevenLabs: no key, request shapes unit-tested with an injected fetch only. Not done: iMessage on macOS 27, real-phone m4a/PNG/GIF delivery, Venmo link format, GIFs and recordings, brain real eval, Canvas ingest, Google freeBusy, a generic confirm-sheet preview for non-trip cards, sign-in is a dev stub on a single process.
  - `atlas.test.ts` "expert-ada/walk_r_2 is empty" was reported by someone else, not reproducible on this branch (frames are `walk/N`); a real crash in `build:sprites` (missing `swap_img`) was fixed, and the regenerated portraits were deliberately not committed. [V by reproduction]

## Phase 6. Interior pivot (about 21:37 to 22:50)

- 21:37 `98b86d9` on `main`: `assets/vendor/` is git-ignored (licensed packs cannot be redistributed). Never commit it.
- 21:38 `plan/interiors` (tip `c66ec96`, one commit, also on `main` as design prompts): `docs/specs/10-interior-campus.md` (the world becomes a top-down indoor campus in the style of LimeZu's Modern Interiors, 16x16 tiles), `docs/design/INTERIORS-ART.md`, and several Claude Design prompts. Contains the research on the pack licence (full pack paid, free sample non-commercial only), Phaser Tiled workflow, EasyStar pathfinding, and the AI Town/Smallville idea of using only the movement layer. The spec is a draft awaiting approval [C].
- 21:41 `main`: campus prompt motion section gated per animation. Later on `main`: a polish-pass prompt (22:31), a full-product prompt using the Modern Interiors pack (22:49) and a 7-step split (23:04), all `design:` commits by the owner's `vaibav03` identity.
- `ws/interior-engine` (worktree `squad-wt/interior-engine`; remote tip `fbc58f9` 22:13; the local checkout is 12 commits ahead of origin, see `BRANCHES.md`): new `@squad/interior` package, Phaser top-down engine over Tiled JSON with collision and prop footprints, A* navigation, room registry, camera (follow and room snap), a director that turns `VillageEvent`s into move/lock/marker commands, placeholder tileset and demo map generated deterministically, Playwright shots across four rounds, a review-fix pass (input lock, door-lock replan, boot failure, camera clamp, a11y focus), a Modern Interiors importer with dry-run and auto-detect, and a "cool toy-room classroom" prop set (local only at last look). Docs: `docs/interior-events.md`, package README. [V]: unit tests (62 per the final status table) and committed shots; [U] real Modern Interiors art is not committed (licence) and the importer has not been run against the owner's licensed copy as far as the tracker can see.
- `ws/media-art` 21:41: v3 direction-ready (top-down, 4 directions) atlas plus a `spriteSource` registry with vendor fallback, to feed the interior engine.
- `ws/village-mesh` 21:39 to 21:42: "World-agnostic contract doc and guard test" so the event layer works for either village or campus.

## Phase 7. QA, chat, council, UX, rooms wave (about 22:47 to 23:15, still active)

All of these branch from `integration/final`'s lineage and were created within minutes of each other; they overlap in files and several already merge each other.

- `chat/web` (worktree `squad-wt/chat`): wire contract in core and `docs/chat-api.md` (22:47), bot web transport with `@squad` mention and structured confirm prompts, hub chat store, SSE fan-out, files and routes, an in-process bot engine, Gemini 402 fallback to a deterministic demo model, tests (22:49 to 23:05), and a merge of `integration/final` reusing its `/v1/status` and resilient LLM (23:09). Honest note in `integration/final`'s status doc: chat and QA are NOT part of that table's claims.
- `qa/web` (worktree `squad-wt/qa`): Trip nav 404 fix and crawl/flow e2e harness (`apps/web-host/e2e/*.mjs`: crawl, flows, personas guard, rooms, village stress, escape, band leak) (22:54), village HUD fixes, `docs/demo/QA.md` (judge Q&A sheet: short honest answers, "Show:" proof, mocked pieces named, cost per question not measured), then merged `ux/rooms` and mounted RoomLayer on the village page, Esc leaves rooms, personas `beforeunload` guard (23:10). [V by scripts and committed screenshots; the harness results themselves are not summarised in git].
- `ux/rooms` (worktree `squad-wt/ux`): room outcome and quiz text event fields plus room session contract (22:48; core pieces cherry-picked into `integration/final` as `57dfae8`), course-planning skill with a sample catalogue and the rooms audit (22:55), room info panel, transcript strip, outcome card, `RoomLayer` (22:56), scenes carrying real words with a 1.2 s per 20 characters dwell queue, plan sheet, sentinel tests (22:56), bubble layout (23:02). `docs/qa/ROOMS-AUDIT.md` audits all 13 rooms: Chapter houses OK; Round Table fixed here; Council Hall, Feynman Porch, Panic Line partial; Debate Stage, Exam Oracle, Oral Exam Hut, Rubric Courthouse, Devil's TA missing. Its "Not verified" list: `coursePlanSkill` phrase at audit time, call button for landmark agents, anything with a real LLM. [V] banter suite green and screenshots; [U] live LLM behaviour.
- `council/ask` (worktree `squad-wt/council`): shared council contract (22:51), ask-the-council service with three stances, anonymous ranking and a chair verdict plus a council skill and a hall scene hookup (22:57), web transport turning the reply into a council card (22:58), hub routes (ask, result, stream), smoke tests and `docs/council-api.md` (23:09), merges of `ux/rooms` and `chat/web`, and sharing one service between hub routes and chat skills (23:12). [V]: smoke tests committed; [U] real-LLM quality.
- `rooms/a` (worktree `squad-wt/rooms-a`): Feynman and Step Diff engines emit under `expert:feynman` / `expert:stepdiff` (23:04), `debateSkill` for the Debate Stage with `council:debate`, votes through `ctx.askConfirm` and a verdict with dissent (23:08), debate room info, event dumps and capture tools with before/after shots (23:09), replay harness and DOM shots (23:10), `devilTaSkill` wiring and `docs/qa/ROOMS-A.md` (23:12). Verified [V]: debate 16 tests, devil's TA 81 tests, adversarial banter corpus, committed shots under `docs/design/shots/rooms-a/`. [U]: Gemini not run (402); skills degrade to labelled template text, tested only with a FakeLlm that fails every call.
- `rooms/b` (worktree `squad-wt/rooms-b`; 1 local commit not pushed at last look): routes `council:oracle|rubric` to their rooms, outcome cards, room copy (23:07). Only the Oracle and Rubric rooms; Oral Exam Hut (largest, needs the voice path) is still unowned in git.
- Not on origin (see `BRANCHES.md`, "Local branches"): `merge/batch1` (worktree `squad-wt/merge1`; a merge of `origin/main` and `ux/rooms` in progress at 23:11), `int/village-scenes` (an early WIP of the village-scenes integration), `fix/phase0-followups` (same tip as `main`'s `0c69c6b`, no extra work), and a Claude agent worktree under `squad/.claude/worktrees/` carrying `integration/final`-era commits. `assets/mi-catalog` was named in the task but no ref of that name exists locally or on origin yet.

## Where things stand (as of the first tracker run)

- **`main`** carries only Phase 0, the design foundation, the integration checklist, repo hygiene and the Claude Design prompts. None of the 15 workstreams has been merged to `main`; all merged work lives on `integration/preview` (throwaway, stale) and `integration/final` (current). Merging `integration/final` plus `chat/web`, `qa/web`, `council/ask`, `ux/rooms`, `rooms/a`, `rooms/b` into `main` is the main open integration step (`merge/batch1` is someone's attempt).
- **Verified, at the strength described in each phase**: typecheck, lint, unit and smoke suites and the no-key `demo:live` / `demo:preflight` on `integration/final`; screenshots under `docs/design/shots/**`; privacy sentinel tests on events, replays and logs; PSI, secret sharing and the gate in the mesh package.
- **Not verified or not done**: any real Gemini call (HTTP 402 credits depleted; owner to top up), any real ElevenLabs call (no key), iMessage on macOS 27, real-phone media delivery, Venmo link format, the Modern Interiors importer on the licensed pack, the interior campus replacing the village in the web host (engine exists, host wiring not seen), the Oral Exam Hut, Exam Oracle, Rubric Courthouse and Devil's TA end to end with a real LLM, Canvas ingest, Google freeBusy, Autumn Town licence screenshot, recorded demo video, GIFs.
- **Process notes**: leads push often and overlap (`package.json` and `pnpm-lock.yaml` are touched on about a dozen branches, so conflicts are expected); some commits are duplicated across branches under different shas (cherry-picks and rebases); one commit message is just `m` (`int/village-scenes` tip) and one is a stash message (`86832a2`, "index on qa/web"), both harmless noise. All authorship is the owner's identity.
- **Tracker**: `scripts/track/*` and `docs/tracking/*` were added on `main` at the end of this log. The loop commits only `docs/tracking/*` from a dedicated worktree (`squad-wt/tracker`).

## Timeline at a glance (2026-10-24, UTC-7)

| Time | Event |
|---|---|
| 20:03 | Initial commit: specs, decisions, assets |
| 20:07 to 20:18 | Workflow doc, briefs, Phase 0 scaffold and core on `main` |
| 20:12 | 15-way workstream split |
| 20:14 to 20:37 | Fifteen `ws/*` branches build and publish API docs (first docs at 20:14 to 20:16) |
| 20:11 to 20:31 | Design foundation on `main` |
| 20:28 to 20:51 | Handoffs folded into `docs/INTEGRATION.md` |
| 20:37 to 20:53 | `integration/preview` merges all 15 and writes the status doc (20:46) |
| 20:48 to 22:20 | `wire/bot`, `wire/hub`, `wire/web` |
| 21:37 | `assets/vendor/` ignored; interiors plan (21:38) and `ws/interior-engine` (21:46) start |
| 22:23 to 23:08 | `integration/final` build-up and honest status (23:04) |
| 22:47 to 23:13 | `chat/web`, `ux/rooms`, `qa/web`, `council/ask`, `rooms/a`, `rooms/b` |
| 22:31 to 23:04 | Claude Design prompts (polish, full product, 7 steps) on `main` |
