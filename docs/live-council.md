# Live council (agent runtime v2)

Status: built on `feature/w1-council-runtime` (workstream W1 of `docs/plans/LIVE-COUNCIL.md`, with the W2/W3 council
migrations that rode along). Envelope contract: `docs/a2a.md`.

## Architecture as built

* **Runtime** `packages/brain/src/agents/runtime.ts`: `createCouncilRuntime({real, demo, emit, budget})` -> `startRun()`
  returns an `AgentRun`. The orchestration loop is code (Ask: `councils/ask-v2.ts`). Each participant is an `AgentSpec`
  (own system instruction, tools, tier fast/main/chair) with its own conversation session.
* **Tools** (`agents/tools.ts`): `retrieve_course` (verified retrieval via `agents/course-port.ts` over the citation-checked
  brain; every citation an agent submits is re-verified in code against exactly the pages it retrieved), `delegate` (chair
  only), `ask_peer` (specialists, once per run), `calendar_summary` / `mastery_summary` (viewer-scoped ports, results stay
  `redaction: asker_only`, denied -> failed `tool:calendar` message), and `submit_turn`, the ONLY way to produce visible
  output (summary <= 280, stance <= 80, answer <= 240, order, confidence word, citations, dissent). Text outside a tool call
  is discarded (nudged once, then the turn fails `no_turn`).
* **Caps**: delegation depth 2, fan-out 3, one `ask_peer` per specialist, cycle check, per-agent 6 model calls. Run budget
  (`agents/budget.ts`, env `COUNCIL_MAX_TURNS=30 COUNCIL_MAX_TOKENS=80000 COUNCIL_MAX_WALL_MS=120000
  COUNCIL_MAX_CONCURRENCY=3 COUNCIL_MAX_RUNS_HOUR=40 COUNCIL_CALL_TIMEOUT_MS=30000`).
* **Transport**: default `stream-text` (`agents/stream-transport.ts`) over the raw `GeminiLlm` (never the ResilientLlm, so a live
  council cannot silently swap to the hub's demo model). `agents/live-transport.ts` is an opt-in Gemini Live transport
  (see probe below). `agents/demo-transport.ts` is the scripted transport, used only for `demo*` runs.
* **Honest status**: `agents/mode.ts` `decideRunMode()` is the single decision point, called once per run
  (`CouncilAgents.decideMode()` in `agents/factory.ts`). Result: `live`, `demo:<reason>` (`no_key`, `forced`,
  `credits_depleted`, `rate_limited`, `unavailable`, ...). A live run can only worsen to `degraded:<reason>` per agent
  (`credits_depleted`, `rate_limited`, `invalid_key`, `timeout`, `budget`, `no_turn`, `session_closed`, `model_error`); the
  runtime throws if a scripted transport is used under a live mode. Scripted text exists only via `scripted()`/`demoText()`
  and every demo envelope is `source: script`, `mode: demo*` (schema-enforced).
* **No chain-of-thought**: `core/src/llm/thoughts.ts` drops thinking parts inside the Gemini adapter; thought signatures
  never leave it except as an opaque tool-call echo; the envelope schema refuses any `thought|reasoning|scratch|raw|signature`
  key. Sentinel tests: `agents/no-thinking.test.ts`.
* **Flag** `COUNCIL_AGENTS=v2` (default). `v1`/`off`/`0` keeps the legacy three-phase prompts. Without a real key every
  run is an honest demo run (`demo:no_key`) through the same runtime and envelopes.
* **Events** through the existing bus: `council.stage` (question, delegation, opinions, critiques, dissent, verdict, actions,
  done) and `a2a.message`, plus the legacy `council.opinion/rank/verdict` (now with `a2aId` and `mode`). Run ownership
  for the per-viewer hub filter: `core/src/council-registry.ts` (runtime registers on `startRun({owner})`) and
  `CouncilService.ownerOf`; `apps/hub/src/app.ts` wires `filterCtx.councils`. Unknown run = dropped.

### Councils on the runtime

| Council | Roster (distinct agents) | Files |
|---|---|---|
| Ask (`@cubbie ask the council`, `@council`, `POST /v1/council/ask`, Council Hall) | Chair; Skeptic, Teacher, Practitioner | `councils/ask-agents.ts`, `ask-v2.ts`, `ask-demo-script.ts` |
| Round Table (course planning) | Chairman; Chill, Grind, Advisor | `skills/courseplan/roundtable-agents.ts`, `roundtable-demo.ts` |
| Debate | Judge; Pro, Con | `skills/debate/debate-agents.ts` |
| Quiz-key | Solvers A/B/C (blind) + Checker | `councils/quizkey-agents.ts` |
| Oracle, Rubric, Devil's TA, Oral examiner | single agent, judged in code; unchanged, now labelled | `skills/mode-util.ts` |

Env: `COUNCIL_AGENTS`, `COUNCIL_ASK_MEMBERS` is a service option (`members`) not an env var; real smoke runs seat 2
specialists + chair.

## Verified results (real Gemini, 2026-10-25)

`LIVE=1 pnpm live:council-smoke` (`scripts/live/council-smoke.ts`; refuses without `LIVE=1`; hard caps 24 model calls and
$0.10 estimated; Chair + Skeptic + Teacher = 3 real agents; committed OpenStax statistics fixture; key through `loadEnv`
only, output redacted). Models: default tiers (`gemini-3.5-flash-lite` fast, `gemini-3.8-flash` main/chair), transport
`stream-text`.

| Run | What happened | Calls | Tokens in/out | Est. cost |
|---|---|---|---|---|
| 1 | `degraded:no_turn`: Skeptic got empty replies after a tool result (output cap 900 was eaten by hidden thinking); run honestly ended `failed` (quorum), Teacher answered live. Fix: raw output cap 3000 | 11 | 17,176 / 351 | ~$0.010 |
| 2 | Chair verdict by code, `degraded:budget` (my smoke cap of 16 turns was too tight); labelled, partial, no scripted text | 14 | 16,725 / 564 | ~$0.010 |
| 3 | **Fully live**: `status=done mode=live`, stages question > delegation > opinions > critiques > dissent > verdict > actions > done, both specialists called `retrieve_course` then `submit_turn` (verified citations 1 and 2, 0 struck), Chair delegated in parallel then gave the verdict through `submit_turn`; all envelopes `source: model`/`code`, no `script`; no-thinking scan of the result JSON clean | 11 | 14,752 / 688 | ~$0.009 |

38 s wall for run 3. Cost is an ESTIMATE from placeholder prices ($0.5/$3 per M tokens, deliberately pessimistic); the real bill
is lower or equal. Run 1 was repeated once with call tracing (same outcome, 11 calls). Total spend of all real council runs in this workstream (4 smoke runs, plus 4 failed Live probe connections at $0)
is about $0.04 by that estimate.

Observations: the two-specialist run gave `uncertain` confidence because the committed answers differed in wording
("The median, with caveats" vs "median"); the dissent check normalises text only, so a semantic-equality check by the Chair
is a possible improvement. A model reply that is empty after a tool result is the typical failure of a too-tight
`maxOutputTokens`: keep the raw cap generous (public text is capped in code, not by the model).

## Failure matrix (what the tests prove)

All FakeTransport/FakeLive, no network: `agents/*.test.ts`, `councils/ask-v2.test.ts`, `skills/courseplan/roundtable-agents.test.ts`,
`skills/debate/debate-agents.test.ts`, `councils/quizkey-agents.test.ts`, `apps/hub/src/routes/council-a2a.test.ts`.

| Failure | Result |
|---|---|
| 402 mid-council | that agent `degraded:credits_depleted`, later agents skipped (halt), partial verdict if quorum else honest `failed`; never scripted text |
| 429, timeout, Live 1011/1008 | `degraded:rate_limited` / `timeout` / `session_closed` |
| Chair fails at plan | code delegates, chair degraded |
| Chair fails at verdict | top-ranked answer published by code, `partial`, `uncertain`, TA note |
| Delegation depth / fan-out / duplicate / cycle | tool refused with a plain error |
| Budget (turns, tokens, wall), hourly cap | run stops `degraded:budget` / refused |
| Privacy sentinels `$180`, `therapy` | `[private]` in every public envelope/result/legacy event; calendar/mastery notes `asker_only`; DM runs carry no text |
| Per-viewer filtering | squadmates see summaries, other squads nothing, private runs skeleton only (`filter-a2a.test.ts`, `council-a2a.test.ts`) |
| Thinking text | sentinel never reaches any event, envelope, turn or JSON |
| Quiz-key blindness | key string never in a solver prompt or any envelope |

## Still scripted (always labelled demo)

Demo transport scripts for ask, roundtable, debate, quiz-key (only when the run mode is `demo*`: no key, forced, or health
says the model is unusable at start). Single-agent judges' fallbacks (oracle/rubric/devil/oral) are `scripted()` text with
`(Demo, scripted, not Gemini)` or `(Degraded: <reason>, scripted)` prefixes.

## Gaps

* Web UI: the board (W5) and voice (W7) are separate workstreams; existing Council Hall panel reads `CouncilResult`, which now
  carries `mode`, `stage`, `agents`, `messages`, but the panel does not yet render the badge/org chart.
* `calendar_summary` / `mastery_summary` ports exist and are tested, but the hub does not supply the viewer ports in
  production yet (needs the nook-parity context retrieval); the tools are only offered to agents when a port exists.
* Quiz-key envelopes have no registered owner, so the hub filter drops them (legacy events still flow).
* Debate/Round Table runs register the starter of the chat message as owner (squad visibility).
* Live transport is probe-only (TEXT modality unsupported on `gemini-3.8-live`, AUDIO setup gave 1011).
* Live-council smoke covers Ask only; Round Table/debate/quiz-key real runs were not made (budget).

## Transport probe

Opt-in Gemini Live transport: `packages/brain/src/agents/live-transport.ts` (`createLiveTextTransport`, kinds
`live-text` / `live-audio`, structural socket so tests use a fake; thought parts and signatures are dropped inside the
transport; close reasons map to `reason:<token>` errors that `degradedReason` understands). It is NOT the default
(`stream-text` is). Tests: `live-transport.test.ts` (tool round trip, thought sentinel, 1011/1008 close mapping, abort).

Probe: `LIVE=1 pnpm live:council-probe` (`scripts/live/council-probe.ts`; refuses without `LIVE=1`; `LIVE_PROBE_AUDIO=1`
selects AUDIO + output transcription). One trivial tool (`retrieve_course`), 20 s wall cap, at most 2 connection attempts, key
read only through `loadEnv`, output redacted. Results, 2026-10-25, model `gemini-3.8-live`:

| Run | Config | Outcome | Tokens | Cost |
|---|---|---|---|---|
| TEXT modality | `responseModalities: ['TEXT']` + 1 function declaration | Both attempts closed at setup: **close 1007 "The requested combination of response modalities (TEXT) is not supported by the model"** (~1.3 s total) | 0 / 0 | $0 |
| AUDIO + transcription | `responseModalities: ['AUDIO']`, `outputAudioTranscription`, same tool | Both attempts closed at setup: **close 1011 "Internal error encountered."** (~1.8 s total) | 0 / 0 | $0 |

Conclusions (measured, not assumed):

* (a) TEXT-only output is **not supported** on `gemini-3.8-live`: the server rejects the setup. Live agents must use AUDIO with
  transcription, so a text-only Live council is not possible; `live-audio` is the only Live shape, and stays voice opt-in.
* (b) Tool calling on Live is **unverified**. The AUDIO run failed with a generic 1011 before any turn. Not yet separated:
  the function declaration (`parametersJsonSchema` may not be accepted on Live; try `parameters`), `maxOutputTokens`, or
  a transient server fault. The run did not look like the credits close ("prepayment credits are depleted"). No further runs
  were made (budget rule: stop on failure, no retry loops).
* (c) No turn completed, so no token usage or latency per turn was observed; spend was $0 (nothing billed at setup).
  Transcription-derived text is also not guaranteed to match what was spoken, a further reason the council default stays
  `stream-text` with `submit_turn`.
* Decision: council text agents stay on streaming `generateContent` with function calling. Revisit Live only for the voice
  opt-in, after one more probe with a variant declaration format.
