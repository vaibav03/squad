# Flow protocol (mesh-flows). Wire kinds/gate/ledger/PSI/shares/mediator math come from mesh-crypto (docs/mesh-api.md).

Coordinator = the agent that starts the task; it hosts the mediator logic and is also a member. Members sorted
ascending define share indices. All sends go `gate.send` -> `Net.send(to, msg)` -> emit `agent.message` + `ledger.entry`
events built with mesh's `toAgentMessageEvent/toLedgerEvent`. All receives go `gate.receive(raw)` first.
Identical canonical messages twice are rejected by the ReplayGuard: every request must differ (round/hop/purpose).

1. `task.open` coordinator -> every member (self handled locally). Reply state `working`. Agent emits agent.state studying.
2. PSI (study: hourly UTC slots `YYYY-MM-DDTHH` in window, padTo 168; trip: days `YYYY-MM-DD`, padTo 64). Owner i:
   a. coord -> i `psi.blind {round:0, points:[], origin:i, hop:0}`; reply `psi.blind {round:0, points:initial, origin:i, hop:0}`.
   b. for each other member j in ring order after i: coord -> j `psi.blind {round:1, points, origin:i, hop:h}`; reply points applied, hop h+1.
   c. coord -> i `psi.blind {round:2, points:final, origin:i, hop:N}`; reply `psi.tokens {tokens}` (i -> 'mediator').
   d. mediator `psiIntersect`, then coord -> each member `psi.common {common}`; each resolves its own common items (psiResolve). Mediator sees tokens + count only.
3. Secure sums. Contribute: coord -> i `share.vec {purpose, round, share:[]}`; i computes its private vector (flow hook),
   `splitVector`, sends `share.vec {purpose,round,share:[hex]}` i -> j directly to each peer, keeps its own share, replies completed.
   Sum: coord -> j `share.sum {purpose, round, sum:[]}`; reply `share.sum {purpose,round,sum:[hex]}` (j -> 'mediator'). Mediator `combineSums`.
   Missing/offline member => task `failed` (never guess).
4. Study: PSI -> common slots (sorted). `cost` round 0 over common slots (hourCost of each slot, 0-3) -> `chooseStudySlot`.
   No common slot: `cost` round 1 over ALL window slots where each member contributes 1 if busy -> conflictCounts -> hybrid slot; emit `conflict` from mediator ('no slot works for everyone').
   `weakTopic` round 0 over task.open.topics (1 if weak) + canTeach shared with consent via fixture flag -> `topicCoverage` (skipped < 3 members).
   Confirm: `result {stage:'proposal', slot}` -> member answers `input-required`, runs askConfirm(student, "Study <slot>? ...", ['Yes','No'], taskId), then sends `confirm.result {accept, optionId: slot}` to coordinator. Any no/timeout: next slot (max 2 rounds), else none. All yes: `result {stage:'final', slot}`.
5. Trip: PSI over days (options' `days` = run length: pick earliest run of consecutive common days per option; none => option dropped 'budget'? NO: report no_dates conflict).
   `cantAfford` round 0 over options (1 if option.perPerson > budget) -> `veto` round 0 (1 if option id or tag in hardNos) -> `filterOptions`;
   mediator sends `option_dropped {optionId, reason}` to every member and emits the event (from 'mediator'). `borda` round 0 over survivors (`bordaVector`) -> `tallyBorda` top2.
   Mediator announces `result {stage:'candidates', candidates:top2, chosen:null}` to members; `simulate` round 0 over [top1, top2] (1 = "no" under full private limits: cost with the actual picked dates incl. nights, budget, hardNo, dates free) -> `simulate`. First with zero no => proposal.
   Confirm exactly as study (askConfirm "<label>, <dates>, $<perPerson> each. Yes?"). All yes => emit `trip.confirmed {taskId, squadId}` ONCE, then `result {stage:'final', ..., venmo}` using `splitEvenly` + `venmoLink` (payee = coordinator's venmo). Any no or timeout => next candidate (max 2), else conflict 'no_plan'. Never emit trip.confirmed on a no/timeout.
6. Query: asker's agent -> target `query {about, target}`; target's gate `answerQuery` -> `query.denied`; events: agent.message kind query (from student asker to target), then from 'mediator' kind query_denied, plus blocked ledger entry.
Min group (<3): mediator publishes no counts anywhere (events, results, payload `counts:null`).
Failure: offline peer / timeout (peerMs) => flow outcome failed/no_plan, tasks `failed`, agent.state idle, no trip.confirmed.
