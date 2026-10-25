# A2A envelope (agent-to-agent messages)

Status: contract shipped (W0); emitted by the agent runtime since W1 (see `docs/live-council.md`). Original note: emitters
land in W1/W2/W4. Source of truth: `packages/core/src/a2a.ts` (browser-safe, exported from `@squad/core`), the two new
`VillageEvent` kinds in `packages/core/src/events.ts`, and the per-viewer rules in `apps/hub/src/filter.ts`.

## Why

A council run is a tree of typed messages (the Chair delegates, specialists ask each other, rank and critique, the Chair
issues a verdict with recorded dissent). The envelope makes that tree visible to the UI without ever exposing a model's
private reasoning, and makes every line say whether it was produced live, in a degraded run, or scripted.

## Envelope (`A2aMessageSchema`, strict)

| Field | Type | Notes |
|---|---|---|
| `id` | `am_` + 12 `[a-z0-9]` | unique message id |
| `correlationId` | `cn_...` or `ld_...` | the council run or live discussion; constant for a run |
| `seq` | int >= 0 | strictly increasing per run (replay order, gap detection) |
| `from` | `AgentId` | e.g. `council:ask-chair` |
| `to` | `AgentId`, `room` or `tool:<name>` | |
| `kind` | `delegate`, `ask`, `answer`, `critique`, `rank`, `vote`, `verdict`, `status` | |
| `parentMessageId` | `am_...` (optional) | delegation tree edge; must be an earlier message |
| `stage` | `question`, `delegation`, `opinions`, `critiques`, `dissent`, `verdict`, `actions`, `done` | |
| `summary` | string, max 280 (optional) | the PUBLIC explanation; absent after redaction |
| `stance` | string, max 80 | status chip text |
| `answer` | string, max 240 | committed short answer (opinions, verdict) |
| `order` | up to 6 names, max 40 chars | `rank`: names only, best first |
| `confidence` | `confident`, `fairly_sure`, `uncertain` | verdict only; a word, never a number |
| `dissentRefs` | up to 4 message ids | verdict points at the dissenter's `answer` message |
| `citations` | up to 4 `{file,page,label}` | verified in code before they get here |
| `status` | `queued`, `working`, `done`, `failed`, `skipped`, `partial` | |
| `mode` | `live`, `degraded:<reason>`, `demo[:<reason>]` | honest status of the producer |
| `source` | `model`, `code`, `script` | `script` is illegal with `mode: live` (schema refinement) |
| `partial` | boolean | cut-off text |
| `redaction` | `public`, `asker_only` | `hub_internal` is a TS type only and is never serialised |
| `ts` | number | ms |

There is deliberately **no field** for thinking text, reasoning, raw model output or signatures.

## New VillageEvent kinds (additive)

```json
{ "t": "council.stage", "councilId": "council:ask", "correlationId": "cn_k3j9x0a1b2c3", "stage": "delegation", "mode": "live" }
```

```json
{ "t": "a2a.message", "msg": {
  "id": "am_a1b2c3d4e5f6", "correlationId": "cn_k3j9x0a1b2c3", "seq": 2,
  "from": "council:ask-chair", "to": "council:ask-skeptic", "kind": "delegate",
  "parentMessageId": "am_000000000001", "stage": "delegation",
  "summary": "Check whether a higher yield really implies a lower price in every case.",
  "status": "done", "mode": "live", "source": "model", "redaction": "public", "ts": 1760000000500 } }
```

```json
{ "t": "a2a.message", "msg": {
  "id": "am_0a0b0c0d0e0f", "correlationId": "cn_k3j9x0a1b2c3", "seq": 15,
  "from": "council:ask-chair", "to": "room", "kind": "verdict", "parentMessageId": "am_000000000001",
  "stage": "verdict", "summary": "Yes, for a fixed-coupon bond; the Practitioner's caveat on callable bonds stands.",
  "answer": "yes, for fixed-coupon bonds", "confidence": "fairly_sure", "dissentRefs": ["am_9f8e7d6c5b4a"],
  "citations": [{ "file": "ch6.pdf", "page": 3, "label": "ch6.pdf p.3" }],
  "status": "done", "mode": "live", "source": "model", "redaction": "public", "ts": 1760000011800 } }
```

```json
{ "t": "a2a.message", "msg": {
  "id": "am_1111aaaa2222", "correlationId": "cn_k3j9x0a1b2c3", "seq": 9,
  "from": "council:ask-practitioner", "to": "council:ask-chair", "kind": "status", "stage": "opinions",
  "summary": "Rate limited, retrying once.", "status": "working",
  "mode": "degraded:rate_limited", "source": "code", "redaction": "public", "ts": 1760000005200 } }
```

## Action items convention (additive, no new envelope field)

The chair's `actions` stage (Ask, Round Table and Debate alike, helper `councils/action-items.ts`) emits one envelope per action item: `kind: status`, `stage: actions`, `from` the chair,
`to: room`, `summary` = the item title (plain words, the run caps it at 120), `parentMessageId` = the verdict. Source is
`code` (derived from the verdict's next step, no extra model call) unless a model wrote it. At most 4 per run. The
run result mirrors them as `CouncilResult.actions: [{ id, title, detail? }]` where `id` is the envelope id, so the hub
endpoints `POST /v1/council/:id/actions/plan` and `.../actions/chat` take `{ actionId }` and never trust client text.
Thinking-like keys are refused as everywhere else (`CouncilActionSchema` is strict).

## Mapping onto existing events

| Existing | Change |
|---|---|
| `council.opinion` / `council.rank` / `council.verdict` | unchanged; new optional `a2aId` points at the mirrored envelope |
| every event kind | new optional `mode` (same vocabulary as the envelope); `work.demo` stays and should be populated from it by emitters |
| `discussion.turn` | new optional `a2aId` and `mode` |
| `agent.message` (mesh trade) | unchanged |
| inspector | later via `registerExchangeMapper('a2a.', ...)`; until then new kinds add no exchange |

Legacy events keep flowing, so the village and chat cards never depend on the new kinds.

## Privacy rules (hub filter)

`apps/hub/src/filter.ts` stays default-deny and re-validates every output with `VillageEventSchema`.

* Both new kinds need `ctx.councils?.ownerOf(correlationId)` (type `CouncilRunRegistry`, optional on `FilterCtx`
  until the runtime wires it). **Unknown run, other squad, or no registry: dropped.**
* Squad run: `redaction: public` goes to every member with all fields; `asker_only` goes to the asker only.
* Private run (DM): every viewer except `askedBy` receives a skeleton from `a2aSkeleton()`: `id, correlationId, seq, from,
  to, kind, parentMessageId, stage, status, mode, source, redaction, ts`. No `summary`, `stance`, `answer`, `order`,
  `citations`, `dissentRefs`, and the event extras `thought`/`message`/`work` are dropped. Arrows and kinds still draw.
* `quiz-key` envelopes (`council:quiz-key*` or `council:quizkey*`) never carry `answer`, for anyone.
* `council.stage` has no text; only `councilId, correlationId, stage, mode` are forwarded.
* Withheld values stay `'hidden'` (unchanged `ledger.entry` rule).
* Thinking text and thought signatures: the schema has no such keys and is strict; `A2aMessageSchema` also refuses any
  nested key matching `/thought|reason(ing)?|scratch|raw|signature|cot/i` (`hasBannedKey`), and the filter drops an
  envelope that carries one. `PublicTurnSchema` (the only way an agent produces visible output) is held to the same rule.
  Tests: `packages/core/src/a2a.test.ts` (schema ban, sentinels), `apps/hub/src/filter-a2a.test.ts`.

## Honest status helpers

* `AgentModeSchema`, `modeKind`, `modeReason`, `worstMode` (demo beats degraded beats live).
* `scripted(text, mode = 'demo')` returns a branded `ScriptedText { text, source: 'script', mode }`. `live` is not
  assignable to its `mode` (compile error) and throws at runtime. Skills must wrap every stock/fallback string in it.
* `findUnwrappedScripted(source, helperNames)` is the lint pattern: scan a file for calls to known stock helpers
  (`stock`, `fallbackQuestion`, `pickDemo`, `defaultWhy`, `rubricUnavailableReply`) that are not directly wrapped by
  `scripted(...)`. W1 adds the repo-wide `honesty.test.ts` that runs it over `packages/brain/src/{skills,councils}`;
  it is not a repo scan here because today's call sites are unwrapped on purpose until W3 migrates them.
* `validateA2aTrace(messages)`: constant `correlationId`, strictly increasing `seq`, parents are earlier messages, no
  `script` under `live`, a verdict that differs from a committed specialist answer must carry `dissentRefs`.
* `truncatePublic(text, max)`: cap at a sentence boundary, else a word.

## Replay fixtures (build the UI on these)

All in `apps/hub/sim/replays/` (validated by `scripts/demo/replays.test.ts` and `packages/core/src/a2a-fixtures.test.ts`):

* `track4-council-a2a.json`: healthy Ask council. Chair delegates to Skeptic, Teacher, Practitioner; Skeptic asks Teacher;
  answers; critique; ranks; verdict with the Practitioner as dissenter (`dissentRefs`); all 8 stages. Legacy
  `council.opinion/rank/verdict` events carry `a2aId`.
* `track4b-council-degraded.json`: Practitioner `degraded:rate_limited`, partial verdict.
* `track4c-council-private.json`: the same run as seen by a non-asker in a private run (skeletons only).
* `track2.json`, `track3.json`: council events now carry `mode: "demo"`. `packages/core/fixtures/sample-replay.json`
  gained one `council.stage` and one `a2a.message`.

These are scripted, so every envelope says `source: "script"`, `mode: "demo"`. Real recordings replace them in W8.

## What consumers must do

1. Ship this schema before any emitter (rollout step 1). Old strict consumers reject the new kinds; they must not crash.
2. Treat `mode` as authoritative: render a visible Demo/Degraded badge whenever `mode !== 'live'` or `source === 'script'`.
3. Never invent text for a skeleton envelope; draw the arrow and kind only.
4. Exhaustive `switch (e.t)` sites need the two new cases (village adapter, inspector `describe`/`conversation` already
   return no-op/safe defaults here).

Round Table and Debate emit the same items (helper `packages/brain/src/councils/action-items.ts`); they have no `CouncilResult`, so each item is
also recorded by run id (`recordCouncilAction` / `councilRunActions` in `packages/core/src/council-registry.ts`) and the hub endpoints
resolve it from there with the same scoping.
