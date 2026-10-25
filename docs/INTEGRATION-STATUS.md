# Integration status (branch integration/final)

Everything from the ws/* workstreams plus the wiring passes, rebased on one branch. Chat (bot web transport, hub chat routes, web chat page) and QA (web UI, village HUD/boot/camera) land from their own branches (chat/web, qa/web) and are not part of this table's claims.

Last full verification: `pnpm install`, `pnpm typecheck`, `pnpm lint` (0 errors, 2 pre-existing eslint-disable warnings in apps/web-host/scripts), `pnpm check` exit 0, every smoke suite, `pnpm demo:live` in both modes, `pnpm demo:preflight` (16 pass, 4 warn: no `.env` in a worktree, replay mode needs no keys).

## Honest status table

| Area | State | Evidence / what is missing |
|---|---|---|
| Typecheck, lint, unit tests | green | core 40, brain 155+36 evals, mesh 61, media 79, hub 17, agent 8, bot 147, web 73, village 445, interior 62, web-host 31, demo-scripts 37 |
| Smoke suites | green | bot 8, agent 4, hub 45, web-host 1, core 2, brain 4, mesh 47, media 1, village 7, web 1 |
| Flaky tests | stable | bot, mesh run 3x in parallel under load: 0 failures. Mesh PSI/scheduler timeouts are already 30 s (CPU-bound bigint work under `pnpm test` parallelism); no further raise needed |
| `atlas.test.ts` "expert-ada/walk_r_2 is empty" | not reproducible here | No frame named `walk_r_2` exists on this branch (frames are `walk/N`); all 29 sprite tests pass; regenerating the sprites (`build_cast.py`) reproduces the committed atlas byte for byte, so the atlas is not stale. The failure came from a checkout with older sprite assets. Real bug found and fixed on the way: `pnpm --filter @squad/media build:sprites` crashed in the portrait step (`swap_img` import removed by the art merge); it is defined in `build_portraits.py` again. Regenerated portraits differ from the committed ones, so they were NOT committed (art owner's call) |
| One-command dev | works | `pnpm dev:all` (scripts/dev/all.ts): hub 8788, agents 4101-4104, web host 5180; health-waits each, prints URLs, Ctrl-C reaps every child. Verified on alternate ports with `DEV_ALL_HUB_PORT`/`DEV_ALL_WEB_PORT` (other leads hold the default ports). The bot is not started: the chat lead mounts it in the hub |
| Real vs stub switch | explicit | `GET /v1/status` (hub), `pnpm run doctor`, startup log lines, `demo:live` prints the mode. Without a key: stubs and FakeLlm, `reason: no_key` |
| Gemini | key present, calls blocked | Live API returns HTTP 402 RESOURCE_EXHAUSTED "prepayment credits are depleted" (AI Studio prepay). Recoverable fallback: on 402 (`credits_depleted`), 429 after bounded retries (`rate_limited`) or 401/403 (`invalid_key`) the hub, bot and agents answer from FakeLlm and re-probe the real model with one tiny request, off the user's path, at most once per 60 s (10 min for an invalid key), and switch back automatically on the first success, so topping up needs no restart (an invalid key needs a restart after fixing it, since the key is read at boot). `/v1/status` shows `{llm, reason, since, lastProbeAt, nextProbeAt}`. Owner action: top up at https://ai.studio/projects. Real answer quality, cache hits and vision ingest are unverified until a call succeeds |
| Gemini adapter vs current docs | verified by reading docs, not by calls | generateContent kept on purpose (explicit caching is not in the Interactions API); `responseJsonSchema` ok; fixed: thought signatures are echoed back in tool loops, cache floor raised to the documented 4096 tokens, expiry taken from the API. See packages/core tests |
| ElevenLabs | no key | convert, stream, timestamps, dialogue, voice design/create request shapes match the docs and are unit tested with an injected fetch. Fixed: voice listing uses `GET /v2/voices` (paged). Premade voice `21m00Tcm4TlvDq8ikWAM` still resolves via the API. Without a key calls are caption-only and podcast/explainer skills are not registered |
| Study-plan skill in the bot | wired | registered in `apps/bot/src/skills/index.ts`, uses the mesh scheduler via `MESH_COORDINATOR_URL` |
| Calendar import | wired | hub parses the .ics (shared `parseIcsBusy` in core), stores busy blocks per student in `hub_busy_blocks` (never streamed), pushes them to the owner's agent at `POST /internal/calendar` (replaces its live profile calendar, so the next study/trip flow schedules around them). `AGENT_PEERS` env tells the hub where agents listen (`dev:all` sets it). Google freeBusy is still not implemented |
| Generic confirm | wired | `POST /v1/confirms/:taskId {yes, optionId?}`: trip tasks (optionId required) and any open `confirm.pending` card, answered through that student's agent (`CONFIRM_MODE=web` agents wait on `/internal/confirm/answer`). Unknown task or another student's card: 404; a card with no agent wired: 422 `unsupported_kind`; agent down: 502. Default agents auto-confirm (`CONFIRM_MODE=scripted`) so demos never block. The village confirm sheet (`packages/web/src/pages/village/hub.ts`) now answers through this route (QA had not touched that file on qa/web) |
| Quiz | wired, public prompt on the stream | `quiz.question` carries `text` (prompt only; sentinel tests prove no key, choices or explanation). `demo:live` now runs generation with FakeLlm, the hub answer route and mastery |
| Chapter ids | consistent in backend | hub seed and brain fixture agree: course `demo`, chapters ch6/ch12 (ch2, ch3 also exist in the fixture). Remaining `ch5` strings are only in web/village mock fixtures and tests (QA scope) |
| Web host serves `assets/` | yes | dev and `vite preview` (preview support added) |
| Hub persistence | sqlite | events, trips, ledger, directory, busy blocks. Sign-in is still a dev stub, single process |
| Mesh | green | PSI, secret share, gate, study + trip flows; `x.trip.limits` posted per agent and verified in `demo:live` |
| Not done | | iMessage on macOS 27 unverified; real-phone m4a/PNG/GIF delivery; Venmo link format unverified; GIFs/recordings; brain real eval (needs credits); Canvas ingest; the confirm sheet's preview still reads the trip, so non-trip cards need a generic preview endpoint |

## Commands

```
pnpm install
pnpm typecheck && pnpm lint && pnpm test          # = pnpm check
pnpm test:smoke <bot|agent|hub|web-host|core|brain|mesh|media|village|web|all>
pnpm --filter @squad/<pkg> test                    # one package

pnpm dev:all                                       # hub 8788 + agents 4101-4104 + web host 5180, Ctrl-C stops all
pnpm run doctor                                    # keys, tools, ports, next steps (never prints values); use `pnpm run`: bare `pnpm doctor` is pnpm's built-in
SQUAD_LIVE=1 pnpm run doctor                       # plus one Gemini output token and one ElevenLabs character
curl localhost:8788/v1/status                      # llm, tts, demo, reason, notice

pnpm demo:live                                     # no keys: hub + 4 agents + fake chat, quiz, calendar, study, trip, leak checks
DEMO_LIVE_LLM=real node --env-file=/path/to/.env --import tsx scripts/demo/live.ts   # real Gemini with automatic fake fallback
pnpm demo:preflight
pnpm demo:replay track2
pnpm --filter @squad/media build:sprites           # regenerate sprites (writes assets/; review the diff before committing)
```

Worktrees do not contain `.env`; copy it (`cp ../squad/.env .env`, never commit it) or export the variables. `doctor` says so when it is missing.

Env contract: `INTERNAL_EVENTS_SECRET` (dev default in `dev:all`), `HUB_BASE_URL`, `HUB_CORS_ORIGINS`, `VITE_HUB_URL`, `AGENT_PEERS`, `FORCE_FAKE_LLM=1` (pin the fake), `CONFIRM_MODE=scripted|web`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `SQUAD_LIVE=1`.

## Merge notes for the other leads
- Chat lead: `GET /v1/status` already exists here (apps/hub/src/routes/status.ts) with `{llm:'gemini'|'fake', tts:'elevenlabs'|'none', demo, ports, reason?, since?, notice?}`, a superset of `HubStatus` in chat/web's core contract (it adds `ports`, `reason`, `since`, `lastProbeAt`, `nextProbeAt`; add them to the schema as optional). Hub runtime flags live in `deps.runtime`. If both branches add the route, keep this one. The bot's LLM is already wrapped with `createResilientLlm` in `apps/bot/src/main.ts`.
- UX lead: core `QuizEvent.text` and `CouncilEvent.outcome` are on this branch (copied from ux/rooms 0030faa, core files only); brain populates `text` on every `quiz.question`.
