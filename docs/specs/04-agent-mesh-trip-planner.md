# 04 · Agent mesh: private study scheduling + trip planner (draft for approval)

Track 2. Workstream for `app/apps/agent` and `app/packages/mesh`. Conforms to `00-OVERVIEW.md` (`AgentMessage`, `LedgerEntry`, `Ctx.askConfirm(student, question, options, taskId)`, "Village event contract", "Build order"). The village that visualizes this mesh is spec 09. Paths are relative to the `app/` workspace. Not built yet; nothing here starts until you approve.

## Summary
Each student gets their own agent (one process, one port). The agents plan things together while sharing as little as possible:
1. **Study together:** find a time everyone is free and see which topics the group can cover, without anyone showing their calendar or admitting what they're weak at.
2. **Plan a trip:** pick dates, an option everyone can afford, and a winner by secret vote. Nobody is outed as broke, under 21, or the one who killed the plan.

Agents talk in A2A-shaped JSON over HTTP. Every outbound message passes a **code** privacy gate (zod), lands in a **disclosure ledger**, and decisions are made by a **mediator in code**, not by LLMs haggling. Students are asked to confirm by DM only at the moments that matter.

**Demo moments (what judges see, mostly in the Squad Village)**
- Each agent sits in its own house on the hill behind a locked door (= private data). To negotiate, agents walk to the campfire commons carrying envelopes; speech bubbles show only shared fields.
- "Cabo is out: at least one person can't afford it." A red "!" and a counter-offer; nobody, including the mediator, knows who.
- An anonymous veto kills the bar crawl; the group sees "1 veto", never whose.
- An agent waits at its door with a pulsing ring until its student answers the DM ("Flagstaff, Nov 27–29, $142 each. Yes?"). Then Venmo links, and the village plays its trip cutscene.
- The notice board at the commons is the disclosure ledger: each row shows what was shared and "hidden" for what wasn't.
- Later ticket: a poisoned message from a stranger's agent is quarantined by the Bouncer.

## Scope
Time is not a constraint (see 00 "Build order"). "Core" is built first, "Later" is built after the core flows pass smoke tests. Everything gets built.
| Core (first) | Later (normal tickets, after core) |
|---|---|
| 3–4 seeded agents on ports 4101+, Agent Card at `/.well-known/agent.json` | Real Google Calendar `freeBusy` or `.ics` upload |
| Privacy gate + ledger (SQLite) + village event stream for 06/09 | Bouncer: quarantine reader for foreign agents' text |
| Study scheduling: free-slot PSI, soft-cost sum, topic coverage counts | Private subsidy pool ("someone chips in" without names) |
| Trip: dates PSI, budget/veto counts, secret Borda vote, simulate, DM confirm, split + Venmo links | Anonymous-veto network (Hao–Zieliński) instead of secret-sharing |
| Mock calendars/budgets as JSON fixtures; deterministic scripted run | Budget range proof (snarkjs) over a committed budget, only if it still proves something (see Decisions) |

## Key design
**Agents.** `apps/agent` runs one Node process per student (`AGENT_ID=s_ana PORT=4101`). Private state = a JSON fixture (calendar, budget, hard no's, topics, preferences). The LLM (Gemini, `fast` role through `Ctx.llm`, see 02) does two jobs only: talk to its own student (via `ctx.dm` / `ctx.askConfirm` from 02) and explain results. It never writes agent-to-agent text.

**Protocol (A2A-shaped, not the full SDK).** `POST /a2a` with `AgentMessage`. Tasks move through A2A states `submitted → working → input-required → completed | failed | canceled`. `input-required` is exactly "waiting for my student to confirm", so the wire view and the village show it.

**Message kinds** (each is a zod schema; no free-text fields anywhere):
| kind | payload (sketch) |
|---|---|
| `task.open` | `{ flow: 'study'\|'trip', window: {from,to}, options?: TripOption[], members: StudentId[] }` |
| `psi.blind` | `{ round: number, points: string[] /* hex, padded to fixed size, shuffled */ }` |
| `share.vec` | `{ purpose: 'cost'\|'cantAfford'\|'veto'\|'borda'\|'weakTopic', share: string[] /* mod-p numbers */ }` |
| `share.sum` | `{ purpose, sum: string[] }` |
| `confirm.result` | `{ accept: boolean }` |
| `result` | `{ chosen, perPerson?, counts }` |
| `query` | `{ about: 'budget'\|'calendar'\|'hardNo'\|'weakTopic', target: StudentId }` (a friend's agent asks another agent for something; the target's gate answers or refuses) |
| `query.denied` | `{ about, reason: 'private' }` (the gate's refusal; no value, no explanation of the data) |

Village-facing `agent.message.kind` values (00): the kinds above plus `conflict` (counter-offer, e.g. "no slot works for everyone"), `option_dropped` (budget or veto) and `query_denied` (a refused query). 07's wording maps as: "0-3 busy scores" = `share.vec` `purpose:'cost'` (soft cost, 0-3 per candidate slot); "query budget" = the per-task cap on `query`/`psi.blind` rounds (default 8 per task; exceeding it is refused like any gated send and emits `query_denied`); "Ben asks for Ana's budget" = `query {about:'budget', target:'s_ana'}`, see the flow below.

**Privacy gate.** One function on every outbound send: validate against the kind's zod schema with `.strict()` (unknown keys rejected), then scan string values against the agent's private fields (budget number, event titles, hard-no reasons). Fail = message dropped + red ledger row. This is the answer to MAGPIE / topology-leakage research: prompts leak, schemas don't. Village events are built from the already-gated message and ledger row, never from raw private state.

**Query denied flow.** A friend's agent (e.g. Ben asks his own agent "what's Ana's budget?") sends `query {about:'budget', target:'s_ana'}`. Ana's gate has no allowlist entry for raw private values to a peer, so it refuses: no value leaves and the agent replies `query.denied`. Events: `agent.message {from:'student:s_ben', to:'student:s_ana', taskId, kind:'query', shared:['asks: budget']}`, then `agent.message {from:'mediator', to:'student:s_ben', kind:'query_denied', shared:['request denied: budget']}`, and a red ledger row `ledger.entry {taskId, student:'s_ana', field:'budget', shared:'nothing', withheld:'hidden', blocked:true}` on the notice board.

**Ledger.** Every send writes `LedgerEntry` rows. Examples:
- `{field:'calendar', shared:'48 blinded tokens (padded)', withheld:'event titles, 31 busy hours'}`
- `{field:'budget', shared:'secret share of 1 bit per option', withheld:'$180 cap'}`
- `{field:'hardNo', shared:'secret share of veto bit', withheld:'reason: under 21'}`
- `{field:'budget', shared:'nothing', withheld:'$180 cap', blocked:true}` (a send the gate stopped, including a refused query)

The full `withheld` text stays in the student's private ledger view. The village event version carries only `withheld:'hidden'`.

**Two crypto primitives cover everything:**
1. **DH-PSI for free slots/dates.** Slots are hourly (study) or days (trip). Each agent hashes its free slots to ristretto255 points (`@noble/curves`, `hashToCurve`), multiplies by its secret key, and the sets go round the ring so every point ends up blinded by every key. Equal tokens = slot free for everyone. Sets are padded with random points to a fixed size and shuffled so nobody learns how busy you are. Each agent learns which of *its own* slots are common; the mediator only sees tokens and the count.
2. **Additive secret sharing for counts.** Any private number (0/1 "can't afford option k", 0/1 veto, Borda points, soft cost 0–3, "weak at topic t") is split into N random shares mod p, one per peer. Each peer sums what it got and publishes the sum. The total is revealed, never the inputs. Used for budget, veto, vote, soft cost and topic coverage.

**Mediator (`packages/mesh/mediator.ts`) — deterministic code.**
- *Study:* candidates = PSI common slots in the window. Soft-cost totals via secret sharing. Pick lowest total; tie → earliest; need ≥1 hr before the exam. If no common slot: report "no slot works for everyone" and offer the slot with the fewest hard conflicts as a hybrid (in-person + Zoom), counts only. Topic coverage: union of "can teach" tags (shared with consent) + secret-shared weak-topic counts → "3 of 4 are shaky on DP; Ben's agent can lead it".
- *Trip:* dates = PSI over days. Drop options where `cantAfford ≥ 1` or `veto ≥ 1` (group sees only "option dropped: budget" / "dropped: veto").
- *Min group size (00 rule):* for squads under 3, the mediator publishes no counts, averages or topic aggregates that could identify a person (a "1 veto" or "3 of 4 shaky on DP" would name someone); it reports only the outcome ("option dropped", "plan found") and skips topic coverage. Borda sum over survivors → top 2. **Simulate:** each agent checks the top 2 against full private limits locally and returns yes/no by secret share. First option with zero "no" → DM confirm.
- *Confirm:* `askConfirm` to each student ("Flagstaff, Nov 27–29, $142 each. Yes?"). All yes → `completed` and `trip.confirmed {taskId, squadId}` is emitted; any no → next option (max 2 rounds, then report "no plan"). Nothing is booked without every yes.
- *Split:* per-person = total / N (or by nights stayed); Venmo links `https://venmo.com/<payer>?txn=charge&amount=..&note=..` (format to verify in T6). All offers are collected before deciding, which avoids first-proposal bias.

**Trust story for judges (say it honestly).**
| Truly cryptographic (semi-honest model) | Data minimization (trust our code) |
|---|---|
| Common free slots/dates (DH-PSI) | The privacy gate and its zod schemas |
| Budget, veto, vote and topic counts (secret sharing) | Each agent truthfully computing its own bits |
| | Students' DMs and the ledger itself |

Limits we state: semi-honest only (an agent that lies about its own budget isn't caught; a range proof would need a committed, attested budget, which we don't have); a coordinator colluding with an agent can test small slot spaces; intersection size is revealed. **Name:** call it "privacy-preserving" with "PSI + secure aggregation", not "zero-knowledge". ZK has a precise meaning (a proof), and judges with crypto background will notice.

## In the village
The mesh emits `VillageEvent`s (00 contract) to the hub as it runs; 09 only consumes them and invents nothing.
| Mesh step | VillageEvent |
|---|---|
| Agent starts/finishes a task, waits on its student | `agent.state` (`idle` / `studying` / `waiting_for_student`). Mesh agents never use `in_call` (voice calls only, hub-owned); negotiation shows as `agent.message` traffic plus `studying`. |
| Any gated outbound message (`task.open`, `psi.blind`, `share.*`, `result`) | `agent.message {from, to:'commons'\|AgentId, taskId, kind, shared:[labels]}` (labels like "48 blinded tokens", never values) |
| Every ledger row | `ledger.entry {taskId, student, field, shared?, withheld:'hidden'}` (notice board) |
| `askConfirm` sent / answered | `confirm.pending` / `confirm.done {student, taskId, question}` (door ring on/off) |
| Every student has confirmed the trip by DM | `trip.confirmed {taskId, squadId}` (VillageEvent; the village plays its cutscene, see 08/09). Emitted once, only after every confirm is yes. |
| Option dropped, veto | `agent.message {from:'mediator', kind:'option_dropped', shared:['option dropped: budget'\|'dropped: veto']}` (red "!"); `from` is always `'mediator'`, never the vetoer |
| No slot / counter-offer | `agent.message {from:'mediator', kind:'conflict', shared:['no slot works for everyone']}` |
| Gate refusal of a private query | `agent.message {from:'mediator', kind:'query_denied'}` plus `ledger.entry {..., blocked:true}` |

`AgentId` mapping (00): student agents are `student:<id>` (e.g. `student:s_ana`), the mediator is `mediator`. The `AgentMessage` wire type keeps bare `StudentId`; `events.ts` converts. 04 is the only emitter of `trip.confirmed`. The trip planner has no gate: nothing unlocks through study goals or a boss, and there are no scores.

Emission: every event is POSTed to the hub at `/internal/events` (header `X-Nook-Internal`) through the single helper in `packages/core` (where the VillageEvent zod schema lives). `events.ts` builds the event from the gated message and calls that helper; there is no local SSE server.

Rules:
- **No leaks:** no withheld value (budget, event title, hard-no reason, who vetoed or couldn't afford) ever appears in an event. Events are produced after the gate and carry labels and counts only; a unit test enforces it.
- **Scripted run:** `demo-*` scripts accept `--scripted`: fixed seeds, fixed fixtures, fixed ordering, no LLM text. Same input produces the identical event sequence, written to a JSON replay file that 09 plays as `VillageSource` (Live and Replay look the same).

## File layout
```
app/packages/mesh/src/  protocol.ts (zod kinds)  gate.ts  ledger.ts  psi.ts  shares.ts
                        mediator/{study,trip}.ts  split.ts  events.ts (builds VillageEvents, posts via core's /internal/events helper, writes replay file)
app/apps/agent/src/     server.ts (POST /a2a, agent card)  state.ts  flows/{study,trip}.ts  confirm.ts
app/apps/agent/fixtures/ s_ana.json s_ben.json s_cam.json s_dev.json  trips.json
app/apps/agent/scripts/  dev-mesh.ts (spawn 4 agents)  demo-study.ts  demo-trip.ts  (both take --scripted)
```

## Build tickets (parallel agents; sizes only order the work)
| # | Ticket | Size | Depends on |
|---|---|---|---|
| T1 | `protocol.ts` zod kinds + `gate.ts` + `ledger.ts` (SQLite) + `events.ts` emitting VillageEvents via the `/internal/events` helper (labels only), `query`/`query.denied` kinds | M | 00 core types |
| T2 | `psi.ts`: ring DH-PSI on ristretto255, padding/shuffle, unit test | M | — |
| T3 | `shares.ts`: split/sum mod p, unit test | S | — |
| T4 | Agent server, Agent Card, fixtures, `dev-mesh.ts`, task state machine, `agent.state` events | M | T1 |
| T5 | Study flow + study mediator + topic coverage | M | T2–T4 |
| T6 | Trip flow + trip mediator + simulate + split/Venmo + `trip.confirmed` emit (after all confirms) | L | T2–T4 |
| T7 | `confirm.ts`: bridge to 02's `askConfirm`, emits `confirm.pending/done`; CLI stub if 02 isn't ready | S | 02 |
| T8 | `--scripted` deterministic run + replay JSON export for 09 | S | T5, T6 |
| T9 | Bouncer: quarantine reader (`fast` role via `Llm.json`, JSON-schema output only, zod-validated, no tools) on inbound foreign text | M | T4 |
| T10 | Google `freeBusy` / `node-ical` import → slot set | M | T4 |
| T11 | snarkjs budget range proof over a committed budget (only if Decision 2 flips to yes) | L | T6 |
T1, T2, T3 start together; T5 and T6 run in parallel after T4. T9–T11 are built after the core smoke tests pass.

## Smoke tests
All tests run with `FakeLlm` (02); only the Bouncer eval and the explain-results wording also run once against the real Gemini key. The mesh itself uses no LLM, so Live and Replay stay deterministic.
- `demo-study`: 4 agents → one slot chosen; ledger has no event titles; the gate drops a message with an injected `"reason"` key.
- `demo-trip`: Cabo dropped (budget), bar crawl dropped (veto), Flagstaff wins; no ledger row contains a dollar cap or a reason; all 4 confirms → Venmo links.
- **Events never leak:** run both flows with sentinel private values (e.g. `$187`, "therapy Tue 2pm", "under 21") and assert none appear in any emitted `VillageEvent`, any `withheld` is exactly `'hidden'`, and no event names who vetoed or couldn't afford.
- **Replay determinism:** two `--scripted` runs produce byte-identical event JSON; 09's replay of the file matches Live.
- **Door ring:** `confirm.pending` is emitted before the DM and `confirm.done` after the answer, with `agent.state: waiting_for_student` in between.
- `trip.confirmed {taskId, squadId}` is emitted exactly once, only after all students confirm; with any "no" or a timeout it is never emitted. `task.open` (trip) proceeds with no gating.
- Query denied: `query {about:'budget'}` yields `query.denied`, a `query_denied` event from `mediator` and one `blocked:true` ledger row; no value in any event.
- Min group size: with 2 members, no count appears in any event.
- PSI: two agents with known overlap get the right common set; padding hides set size.
- Shares: 4 random inputs sum correctly; any single share looks uniform.

## Risks
- Ring PSI ordering bugs → fall back to mediator-run hashed intersection (labelled "data minimization", not crypto).
- 02 not ready → confirm via CLI prompt; the flows still work.
- Live flakiness → seeded fixtures, temperature 0, scripted replay as backup.
- Gemini quota or latency: the mesh needs no LLM calls (the model only talks to a student and explains results), so a 429 or outage degrades to templated text, never to a stalled negotiation. Four agents sharing one API key share one project quota (limits are per project), so `fast` calls go through the `Llm` limiter.
- Structured output only checks part of a JSON schema server-side (no `minLength`, `maxLength`, `uniqueItems`), so the Bouncer's zod check is the real gate.
- Over-claiming → use the trust table above verbatim in the pitch.

## Decisions for you
1. **Name:** "privacy-preserving trip planner" instead of "ZK". *Recommend yes.*
2. **Range proof (circom/snarkjs, T11):** now a normal ticket, but without an attested budget it proves nothing. Build it only if you want it and we add a committed budget. *Recommend still skip unless we add a commitment.*
3. **A2A SDK vs A2A-shaped JSON:** shaped JSON with the same states and Agent Card. *Recommend shaped.*
4. **Calendars:** mock fixtures first, `freeBusy` (T10) after core. *Recommend this order.*
5. **Bouncer (T9):** built after both flows pass smoke tests. *Recommend yes.*
6. **No gating (decided):** the trip planner just proceeds; when everyone confirms, 04 emits `trip.confirmed` and the village plays its cutscene. No boss, study goals, XP or scores. *Confirmed.*
7. **Village events:** labels and counts only, `withheld:'hidden'`, plus a `--scripted` replay. *Recommend yes.*

## Sources
- Track 2 research and architecture: research-track2-agents.md (ideas notes, not exported) (MAGPIE arXiv 2510.15186, CalBench 2605.09823, Magentic Marketplace 2510.25779); Bouncer/Threshold: round3-track2.md.
- @noble/curves (ristretto255 `hashToCurve`): https://github.com/paulmillr/noble-curves · https://jsr.io/@enjikaka/noble-curves
- DH-PSI explained: https://openmined.org/?p=2149 · semi-honest leakage of DH-PSI: https://eprint.iacr.org/2020/901
- A2A task states (`input-required`): https://a2a-protocol.org/latest/specification/ · https://docs.praison.ai/docs/features/a2a-tasks.md
- circom/snarkjs: https://iden3.readthedocs.io/en/latest/_downloads/a765838f66c398a1a753401feb3310f9/circom_and_snarkJS.pdf · https://remix-ide.readthedocs.io/en/latest/circom.html
- Google Calendar freeBusy: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query · node-ical: https://npmjs.com/package/node-ical
- Anonymous veto network: Hao & Zieliński, 2006.
