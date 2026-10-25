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
* **Caps**: delegation depth 2, fan-out 3, one `ask_peer` per specialist, cycle check, per-agent 6 model calls (tool rounds <= 2). Run budget
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

## Reliability (council integration, 2026-10-25)

How a participant now ends with a valid `submit_turn` (runtime `runTurn`, `agents/runtime.ts`):

* **Forced function calling.** Every step is sent with Gemini mode ANY (`LlmRequest.toolChoice`, `StepResult` untouched):
  the first step may call any of the agent's tools OR `submit_turn`; after 2 tool rounds, after a nudge, or when only two model
  calls are left, ONLY `submit_turn` is offered and forced. A turn can no longer end as free text or as one more lookup, and a
  retrieval loop cannot eat the call budget.
* **Bounded retries.** An empty or text-only reply is nudged (twice at most, escalating wording, submit-only from the first nudge);
  a bad `submit_turn` is re-asked once; a `timeout` or `model_error` is retried ONCE (the transport rolls the failed input back so
  the conversation is clean) with thinking dropped to `minimal`. A second failure is an honest `degraded:<reason>`, never scripted.
* **Thinking effort.** Council calls use `thinkingLevel: low` by default (`COUNCIL_THINKING=off|minimal|low|medium|high`). Thinking
  time, not output tokens, was most of the latency (`high` took 79 s for the same tiny run that takes about 20 s on `low`).
* **Course lookup once, by code, in parallel.** `prefetchQuery`: the verified retrieval (2 model calls inside `brain.ask`) starts
  with the chair's first call; specialists get the verified pages in their prompt (so no model round just to ask for them) and a
  `retrieve_course` call by anyone reuses the same result. A code envelope `Looked up the course pages.` (to `tool:retrieve`) shows it.
* **Chair plan closed in code.** After the delegations the chair's plan summary is a code envelope (`Delegated to ...`, `source: code`)
  instead of a model call (`CallOptions.endAfterTools`). Ask and Round Table.
* **Parallelism** already held (delegations and rankings run in parallel, `COUNCIL_MAX_CONCURRENCY=3`); live status now flows: an
  agent is `working` in the snapshot the moment its turn starts and `done` in the snapshot of its own envelope.
* **Finished snapshot.** `CouncilResult.status` flips to `done` only after stage `done` (a stream that closes on the first
  non-running snapshot used to freeze the board at step 7 of 7). The board store never moves a run to an earlier stage.

Root cause of the merge captain's `(Degraded: no turn)` run: **not reproduced** in 6 real baseline runs (5 two-specialist smoke runs and
1 three-specialist run, all `mode=live`, all answered, but slow: 43-80 s, median 54 s, 11 model calls each). The code allowed exactly
the failure the captain saw: tool choice was AUTO (an empty reply or prose counted against a single nudge), a specialist that kept
calling `retrieve_course` used its whole 5-call budget without submitting, a transient timeout or empty candidate had no retry, and
every extra sequential model call (plan summary, retrieval round, 2 internal retrieval calls) pushed the run toward the 30 s
per-call and 120 s wall limits. The fixes above remove each of those paths; I cannot prove which one hit that run.

### Before / after on real Gemini (`LIVE=1 pnpm live:council-smoke`, committed OpenStax fixture)

| Config | Runs | `mode=live`, everyone answered | Wall per run | Median | Model calls | Est. cost per run |
|---|---|---|---|---|---|---|
| Before, Chair + Skeptic + Teacher | 5 | 5 of 5 | 43, 43, 54, 55, 80 s | **54 s** | 11 | $0.009 to 0.011 |
| Before, Chair + 3 specialists | 1 | 1 of 1 | 57 s | 57 s | 11 | $0.012 |
| After, Chair + Skeptic + Teacher | 5 | **5 of 5** | 17, 20, 23, 36, 50 s | **23 s** | 6 | $0.004 to 0.007 |
| After, Chair + 3 specialists (hub default) | 5 | **5 of 5** | 19, 23, 27, 31, 39 s | **27 s** | 10 | $0.008 to 0.017 |

All 10 "after" runs were `status=done mode=live` with all stages (question, delegation, opinions, critiques where 3 answered,
dissent, verdict, actions, done) and every participant answering. Latency has a long tail from Gemini itself (one 50 s run with the
same 6 calls). Cost is an ESTIMATE from placeholder prices (0.5/3 USD per M tokens), pessimistic.

## Thinking-text scan on the real stream

`LIVE=1 pnpm live:council-scan` (`scripts/live/council-stream-scan.ts`, pure scanner `scripts/live/lib/thinking-scan.ts` with unit
tests): boots an in-process hub, runs one real Ask council through `POST /v1/council/ask`, and captures what viewers actually
receive: the squad SSE stream `/v1/squad/stream` (stream token from `/v1/squad/stream-token`) for the asker AND a squadmate, the
council SSE `/v1/council/:id/stream`, and `GET /v1/council/:id`. A DEBUG-ONLY Gemini client wrapper (never used by hub or bot) asks the
model for its thought parts (`includeThoughts`) and records thought text, thought signatures and everything the model was legitimately
given or said publicly (prompts, tool results, its own function-call arguments). The scan then asserts: (1) no key in any payload is
named thought/reasoning/scratch/chain-of-thought/signature (the one allowed exception is the public `thought` summary, <= 240 chars);
(2) no 8-word window of raw thinking that is not also authorized public text appears in any payload; (3) no raw thought signature
appears anywhere.

| Run | Thinking | Frames scanned | Raw thought parts / signatures captured | Result |
|---|---|---|---|---|
| 1 | low (default) | 71 (22 a2a.message frames across two viewers) | 1 / 6 | clean |
| 2 | high | 69 | 5 / 6 | clean |

Limits, said plainly: with `low` thinking Gemini returns few thought parts, so the text diff is thin; the `high` run stresses it.
A model that copy-pastes its thinking into its own `submit_turn` text is indistinguishable from a deliberate answer and is allowed.

## Other councils on real agents

`LIVE=1 pnpm live:council-others` (`scripts/live/council-others.ts`, hard cap 40 calls / $0.15 estimate, one run each):

| Council | Result | Wall | Calls | Tokens in/out | Est. cost |
|---|---|---|---|---|---|
| Round Table (course planning, Chairman + Chill, Grind, Advisor, fall term, mock completed courses) | `mode=live`, plan CSL 240, 310, 320, 331, 370 (15 cr), all 3 members answered and ranked, 0 repairs, 13 envelopes (`code`+`model`) | 22 s | 10 | 13,076 / 1,026 | ~$0.010 |
| Debate (Judge + Pro, Con, ungrounded) | `mode=live`, winner `pro`, framed positions by the Judge (no fallback labels), 5 envelopes | 13 s | 4 | 3,307 / 347 | ~$0.002 |

Quiz-key: the quiz engine now passes the first student of the round as the run owner (`KeyVerifier.verify(..., { askedBy })`), the runtime
registers it, and the hub's per-viewer A2A filter keeps the quiz-key envelopes for that student's squad (test:
`apps/hub/src/routes/council-a2a.test.ts`). Without a student the run stays unowned and its envelopes are still dropped (default deny),
legacy events flow either way. A real quiz-key run was not made (budget: the quiz generation needs a larger real flow).

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

* The Council Hall, Round Table panels, chat card and the board header are wired to `CouncilResult.mode|stage|agents|messages`
  (`packages/web/src/council/RunStrip.tsx`, `docs/council-board.md`); only the Round Table room panel is covered by component tests
  rather than a live e2e.
* `calendar_summary` / `mastery_summary` ports exist and are tested, but the hub does not supply the viewer ports in
  production yet (needs the nook-parity context retrieval); the tools are only offered to agents when a port exists.
* Round Table and Debate do not emit action items yet (Ask does); the Debate chair plan still costs one model call (it frames the positions).
* A real quiz-key run was not made; its owner registration is covered by tests only.
* ~~Live transport is probe-only~~ Superseded: the Gemini Live council transport exists and ran for real, see "Gemini Live council transport (council-live-ux)" below. Tool calling over Live is still unverified (the Live transport uses none).
* Gemini latency has a long tail (one of ten runs took 50 s with the same 6 calls); the median target holds, the maximum does not.

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

## Gemini Live council transport (council-live-ux)

Status: built on `feature/council-live-ux` (docs/council-live-ux.md for the UX side). The streaming transport stays the default
and the real provider path; Live is opt-in per run.

### How it works

* **Selection**: `POST /v1/council/ask { transport: 'stream' | 'live' }`, default from env `COUNCIL_TRANSPORT` (`stream`).
  `COUNCIL_TRANSPORT_LIVE=0` is the feature flag that switches Live off hub-wide (a `live` request then falls back, labelled).
  The decision is in `runAskV2`: demo runs stay demo (label `Demo (scripted, not Gemini)`); a `live` request on a live run builds a
  per-run Live council (`apps/hub/src/council/live/factory.ts`), PRE-FLIGHTS every participant's session
  (`transport.prepare`: connect all, then a short grace window because a bad key or credits close the socket right after
  open), and only then starts the run on it. If the pre-flight fails the run uses the streaming transport and its label reads
  `Gemini streaming (Live unavailable: <reason in words>)` with `transport.why` set (`credits_depleted`, `invalid_key`,
  `rate_limited`, `live_unavailable`, `timeout`, `live_disabled`). `CouncilResult.transport` carries `{ kind, label, requested, why, models }`.
* **Participants**: each seat is its OWN Gemini Live session (`apps/hub/src/council/live/transport.ts`, an `AgentTransport` of kind
  `live-audio`): own system instruction (the seat's persona plus a speech contract) and own voice (Chair Fenrir, Skeptic Puck,
  Teacher Kore, Practitioner Aoede), `responseModalities: AUDIO` with `outputAudioTranscription` (the Live Discussion client,
  `apps/hub/src/live/gemini-client.ts`, is reused unchanged). No tools over Live (unverified): retrieval is done by code (`prefetchQuery`)
  and the verified pages arrive inside each specialist's prompt as untrusted DATA.
* **Turn-taking**: a floor lock allows ONE speaker at a time. The Chair opens (one or two sentences naming who it asks), the
  specialists speak in the order the Chair delegated (a gate per seat, whatever order the parallel runtime calls arrive in), the
  Chair closes with the verdict (answer, why, `Confidence:`, `Dissent: <Name> | none`, `Next step:`). Those tag sentences are parsed by
  code into the envelope's `confidence`, the dissenter (so `dissentRefs` and the board's dissent link work) and the next step; they
  are removed from the public summary. Spoken Live councils have no anonymous ranking stage (ranks need structured output).
* **Same envelopes**: each finished turn becomes the same `submit_turn` the streaming runtime gets, so the runtime publishes the SAME
  `a2a.message` / `council.stage` / `council.opinion` / `council.verdict` events and `CouncilResult` (events and results now also carry
  `transport`). The public text of a turn is the output transcription, never anything else; there are no thinking parts on this path.
* **Captions and audio**: `GET /v1/council/:id/live[?audio=1]` (SSE of `CouncilLiveEvent`: `speaker`, `caption` (cumulative text of the
  turn), `audio` (base64 24 kHz PCM, only with `audio=1`, never replayed), `turn_end`, `interrupted`, `transcript`). Same visibility as the run.
  The browser plays the chunks with the Live Discussion Web Audio player (muted until the user clicks).
* **Interruption**: `POST /v1/council/:id/say { text }` (the asker only; typed text or a push-to-talk transcript). The current speaker is cut
  off (`interrupted`, the turn is partial) and the student's words are prefixed to the next speaker's input. Gap: the Ask orchestration
  is a fixed sequence, so the Chair does not get an extra reply turn just for the interjection (the next speaker does).
* **Degradation during a run** (never scripted): the participant's turn fails with `reason:<why>`, so the runtime marks that seat
  `degraded:credits_depleted | rate_limited | invalid_key | timeout | session_closed | no_turn | budget`, the run mode is the worst of its
  seats, and the Ask logic continues or fails honestly (quorum) exactly as for streaming.
* **Budget guard**: `COUNCIL_LIVE_MAX_TURNS` (8), `COUNCIL_LIVE_MAX_USD` (0.25, audio estimate at $0.018/min), `COUNCIL_LIVE_TURN_TIMEOUT_MS`
  (40 s), `COUNCIL_LIVE_CONNECT_TIMEOUT_MS` (15 s), `COUNCIL_LIVE_GRACE_MS` (1.5 s), `COUNCIL_LIVE_MAX_TURN_CHARS` (600), plus the
  council's own `COUNCIL_MAX_RUNS_HOUR`. The Live runtime gets a longer per-call limit (120 s) because speakers queue for the floor.
* **Status**: `GET /v1/council/status` reports the Live state (`untested | ok | unavailable` with `why`) from the last pre-flight.

### Real proof (2026-10-25, key from .env through the runtime only)

`LIVE=1 pnpm live:council-live` (`scripts/live/council-live-proof.ts`; refuses without `LIVE=1`; caps 4 spoken turns and $0.10 of audio;
Chair + Skeptic + Teacher over the committed OpenStax statistics fixture; model `gemini-3.8-live` for all three; the course lookup used
the normal Gemini text models).

| Item | Result |
|---|---|
| Outcome | `status=done mode=live`, transport `live-audio`, label `Gemini Live (audio + transcript)` |
| Connection setup | all three sessions open + grace window: 1,704 ms |
| Turn 1 Chair (opening) | 180 chars, 32 audio chunks, 10.3 s of audio, 11.2 s latency |
| Turn 2 Skeptic | 140 chars, 23 chunks, 7.2 s, 8.3 s latency |
| Turn 3 Teacher | 204 chars, 31 chunks, 11.4 s, 12.6 s latency |
| Turn 4 Chair (verdict) | 342 chars, 59 chunks, 20.0 s, 21.2 s latency, `Confidence: confident`, `Dissent: none`, next step parsed |
| Whole run | 61.1 s wall, 48.9 s of audio in 145 chunks |
| A2A envelopes | 9 (3 status, 2 delegate, 1 ask (course lookup by code), 2 answer, 1 verdict), sources `code` + `model`, all `live`, none `script` |
| Stages | question > delegation > opinions > verdict > actions > done (no critiques: no ranks in a spoken council; no dissent stage: none was spoken) |
| Per participant | Chair, Skeptic, Teacher: `live-audio / live / done` |
| Cost | audio ~ $0.015 (estimate at the documented $0.018/min output) plus the course lookup's text calls (about 2 small Gemini text calls); well under $0.05 for the run, under $0.10 for everything done while building |
| No thinking text | result JSON scan clean |
| Not verified | citations: the specialists got verified pages but speak free text, so the run shows "gave no verified citation" notes (spoken `[file p.N]` markers are not quote-verified); tool calling over Live; GoAway after 10 min (runs are about 1 minute) |

The transcript of each participant is what the envelopes carry; the proof script prints the exact text per turn.
