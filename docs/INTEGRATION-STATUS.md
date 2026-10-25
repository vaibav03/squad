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
| ElevenLabs | key set, voices blocked by the plan | Verified against the live API on 2026-10-25: the key authenticates but is restricted (no `user_read`, no `voices_read`) on a FREE plan, and a 1-character text-to-speech call with the stock voice `21m00Tcm4TlvDq8ikWAM` returns HTTP 402 `paid_plan_required` ("Free users cannot use library voices via the API"). Request shapes (convert, stream, timestamps, dialogue, voice design + create, `GET /v2/voices`) match the docs and are unit tested with an injected fetch. The hub now probes at startup (see "Status truthfulness" below) and degrades to captions only with `tts: none, ttsReason: paid_plan_required`. Owner action: use a plan that allows API voices, or give the key `text_to_speech` + `voices_read` + `voices_write` so the hub can list or design its own voice, or save a voice you own in `packages/media/src/voices/saved-voices.json` / `ELEVENLABS_VOICE_ID` |
| Study-plan skill in the bot | wired | registered in `apps/bot/src/skills/index.ts`, uses the mesh scheduler via `MESH_COORDINATOR_URL` |
| Calendar import | wired | hub parses the .ics (shared `parseIcsBusy` in core), stores busy blocks per student in `hub_busy_blocks` (never streamed), pushes them to the owner's agent at `POST /internal/calendar` (replaces its live profile calendar, so the next study/trip flow schedules around them). `AGENT_PEERS` env tells the hub where agents listen (`dev:all` sets it). Google freeBusy is still not implemented |
| Generic confirm | wired | `POST /v1/confirms/:taskId {yes, optionId?}`: trip tasks (optionId required) and any open `confirm.pending` card, answered through that student's agent (`CONFIRM_MODE=web` agents wait on `/internal/confirm/answer`). Unknown task or another student's card: 404; a card with no agent wired: 422 `unsupported_kind`; agent down: 502. Default agents auto-confirm (`CONFIRM_MODE=scripted`) so demos never block. The village confirm sheet (`packages/web/src/pages/village/hub.ts`) now answers through this route (QA had not touched that file on qa/web) |
| Quiz | wired, public prompt on the stream | `quiz.question` carries `text` (prompt only; sentinel tests prove no key, choices or explanation). `demo:live` now runs generation with FakeLlm, the hub answer route and mastery |
| Chapter ids | consistent in backend | hub seed and brain fixture agree: course `demo`, chapters ch6/ch12 (ch2, ch3 also exist in the fixture). Remaining `ch5` strings are only in web/village mock fixtures and tests (QA scope) |
| Web host serves `assets/` | yes | dev and `vite preview` (preview support added) |
| Hub persistence | sqlite | events, trips, ledger, directory, busy blocks. Sign-in is still a dev stub, single process |
| Mesh | green | PSI, secret share, gate, study + trip flows; `x.trip.limits` posted per agent and verified in `demo:live` |
| Not done | | iMessage on macOS 27 unverified; real-phone m4a/PNG/GIF delivery; Venmo link format unverified; GIFs/recordings; brain real eval (needs credits); Canvas ingest; the confirm sheet's preview still reads the trip, so non-trip cards need a generic preview endpoint |

## Status truthfulness (branch fix/honest-status)

Bug: a fresh hub reported `llm: gemini` and `tts: elevenlabs` as soon as a key existed, then served fake answers after the first call failed (Gemini 402) or could never speak (ElevenLabs free plan 402). Fixed: both providers are probed once at startup, in the background (the hub listens at once; a probe is bounded at 8 s and the live probes finish in about 0.3 s), cached, and re-probed lazily on `GET /v1/status` (LLM 60 s for credits and rate limits, 10 min for a bad key; speech 10 min).

`GET /v1/status` shape (no secrets):

```json
{ "llm": "gemini|fake", "tts": "elevenlabs|none", "ttsReason": "ok|no_key|key_restricted|paid_plan_required|rate_limited|unavailable",
  "demo": true, "probing": false, "reason": "no_key|forced_fake|credits_depleted|invalid_key|rate_limited|probing",
  "notice": "...", "ttsNotice": "...", "since": 0, "lastProbeAt": 0, "nextProbeAt": 0, "ports": "real|stub" }
```

While the first probe is in flight: `llm: fake`, `reason: probing`, `probing: true`, `demo: true` and `notice`/`ttsNotice` are `Checking services...`; requests are served by the demo model and nothing claims a real one. The web chat banner and the personas page read these fields (and poll every 1.5 s while `probing`). `ttsReason: unavailable` (not in the original list) means ElevenLabs could not be reached or timed out.

Speech strategy (`packages/media/src/tts/health.ts`, 1 character per candidate, never a library voice that needs a paid plan unless it proves it works): (1) a voice id saved in `saved-voices.json` or named in `ELEVENLABS_VOICE_ID` / `ELEVENLABS_FALLBACK_VOICE_ID`, (2) voice design `POST /v1/text-to-voice/design` then `POST /v1/text-to-voice` (needs `voices_write`; the id is saved as `squad-default`), (3) the account's own voices from `GET /v2/voices` (needs `voices_read`), (4) the stock voice, which proves `paid_plan_required` on a free plan. A 401/403 on synthesis stops the probe after one character (`key_restricted`), a 429 or quota error stops it (`rate_limited`). When nothing works every audio feature says "Voices need an ElevenLabs plan that allows API voices" instead of failing: voice previews return 503 `voices_unavailable` with that message, a call's websocket sends `{type:'notice', code:'voices_unavailable', message}` after `ready` and carries on with captions, and the bot's podcast skill replies with the message. The explainer makes images, not audio, so it is unaffected.

`pnpm run doctor` runs the same probe (voice design off, read-only) plus a 1-token Gemini call by default (`SQUAD_LIVE=0` skips them) and prints what works, what fails and the exact fix. Real startup on the current keys, redacted: first status `{"llm":"fake","tts":"none","ttsReason":"unavailable","demo":true,"probing":true,"reason":"probing","notice":"Checking services..."}`, about 0.3 s later `{"llm":"fake","reason":"credits_depleted","probing":false,...}` and speech `paid_plan_required`. Known unrelated flake: `packages/web` `Chat.test.tsx` "shows grouped messages, day separators" fails when the suite runs between midnight and about 02:30 local time (fixture messages 62 minutes old fall on the previous day); it fails identically on main.

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
