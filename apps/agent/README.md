# @squad/agent: one privacy-preserving agent per student

Each student gets one Node process (`AGENT_ID=s_ana PORT=4101`) holding that student's private profile (calendar, budget,
hard no's, topics, trip ranking) and speaking A2A-shaped JSON over HTTP. The protocol and crypto live in `@squad/mesh`
(`docs/mesh-api.md`, `packages/mesh/src/flows/PROTOCOL.md`); this app is the server, the fixtures, the confirm bridge and
the scripts.

## Run

```bash
pnpm --filter @squad/agent mesh                       # all four agents in one process on 4101-4104
pnpm --filter @squad/agent demo:study                 # or demo:trip: starts the mesh, kicks a flow, prints the outcome
pnpm --filter @squad/agent demo:trip --scripted --out ../hub/sim/replays/mesh-trip.json   # deterministic replay JSON
AGENT_ID=s_ana PORT=4101 pnpm --filter @squad/agent dev   # one real process (repeat per student, other ports)
pnpm test:smoke agent && pnpm test:smoke mesh         # end-to-end, leak, failure-path and replay tests
pnpm --filter @squad/mesh scripted --flow all --out replay.json   # same export without the app
```

Start a flow on a running agent: `POST /internal/start/study|trip` with header `X-Nook-Internal: $INTERNAL_EVENTS_SECRET`
(bodies in `fixtures/study.json`, `fixtures/trips.json` plus `taskId` and `members`).

## Env

| Var                                      | Meaning                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `AGENT_ID`, `PORT`                       | which student, which port (default from `fixtures/peers.json`)                               |
| `PEERS`                                  | `s_ben=http://localhost:4102,...` overrides `fixtures/peers.json`                            |
| `HUB_BASE_URL`, `INTERNAL_EVENTS_SECRET` | where `postEvent` sends VillageEvents; also guards `/internal/*`                             |
| `CONFIRM_ANSWERS`                        | scripted DM answers, e.g. `s_ben=no,s_chi=timeout` (default yes)                             |
| `BOT_URL`                                | route DM confirms to the spine bot (see below); without it and without answers, a CLI prompt |
| `FAKE_LLM=0`                             | use Gemini for student-facing wording (the mesh itself never needs an LLM)                   |
| `AGENT_SEED`                             | fixed rng seed (tests/scripted); unset = secure randomness                                   |

Private state: `data/agent-<id>.sqlite` (git-ignored) holds the disclosure ledger. Fixtures are regenerated from the shared
demo profiles with `pnpm --filter @squad/agent exec tsx scripts/gen-fixtures.ts`. Calendars are mock `.ics` files first
(`src/ics.ts`); Google `freeBusy` is `src/google.ts` (interface only, needs `GOOGLE_ACCESS_TOKEN`).

## Endpoints

`GET /.well-known/agent.json` (Agent Card), `POST /a2a` (one `AgentMessage` in, one `WireReply {taskId,state,message?}` out;
states `submitted|working|input-required|completed|failed|canceled`, `input-required` = waiting for the student's DM),
`GET /healthz`, `POST /internal/start/{study,trip}`, `POST /internal/query` (token guarded).
Errors are fixed codes (`schema`, `replay`, `not_member`, ...), never values.

## DM confirm bridge (request to spine)

Inside the bot, pass `ctx.askConfirm` straight in (it emits `confirm.pending/done` and `agent.state` itself). Standalone, `src/confirm.ts`
emits those events itself and, when `BOT_URL` is set, calls `POST ${BOT_URL}/internal/confirm {student, question, options, taskId}`
with `X-Nook-Internal`, expecting `{answer}` (the exact option string, or `"timeout"`). That endpoint does not exist in the spine yet;
it is a request, and without it the CLI or `CONFIRM_ANSWERS` is used. Timeouts count as no.

## Events

Everything goes through core `postEvent`: `agent.state`, `agent.message` (labels such as "48 blinded tokens (padded)"), `ledger.entry`
(`withheld` is always `'hidden'`; `blocked: true` for refusals), `option_dropped` / `conflict` / `query_denied` from `'mediator'`,
`confirm.*`, and `trip.confirmed` exactly once, only after every student answered yes.

## Hub private channel

Besides VillageEvents, each agent posts two owner-only envelopes through core `postHubEnvelope` (`src/hub.ts`): `x.ledger.private`
(its own student's ledger rows with the raw withheld value) and, from the coordinator, `x.trip.upsert` (public trip state: options,
dates, vetoed labels from `'mediator'`, confirmations; `votes` is always `[]` because the ballot is secret; `limits` holds only the
coordinator's own limits since no agent knows another's). `trip.confirmed` is emitted only after an upsert in which every member is confirmed.

## Trust table (say it exactly like this)

| Truly cryptographic (semi-honest model)                                                       | Data minimization (trust our code)                                      |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Common free slots and dates: ring DH-PSI on ristretto255, padded to a fixed size and shuffled | The privacy gate and its strict zod schemas (no free-text field exists) |
| Budget, veto, ranked-vote and topic counts: additive secret sharing mod 2^127-1               | Each agent computing its own bits honestly                              |
|                                                                                               | Students' DMs, the disclosure ledger, the mediator being code           |

Limits: semi-honest only (an agent that lies about its own budget is not caught); intersection size is revealed; a coordinator
colluding with every other agent can reconstruct an input. Squads under 3 get no counts. This is "privacy-preserving"
(PSI plus secure aggregation), not "zero-knowledge": nothing here is a proof.

## Known gaps

Topic "can teach" tags are not shared yet (coverage reports counts without a named lead); the Venmo link format is unverified
against the live app (one line in `mediator/split.ts`); weak-topic names are not gate-scanned because topic names are public task data.
