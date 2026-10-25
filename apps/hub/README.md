# @squad/hub

Standalone Hono server: live events over SSE, snapshot for late joiners, replay serving, quiz and call endpoints (behind ports so brain and media plug in later), sign-in stub, per-viewer filtering. Contract for other workstreams: [`docs/hub-api.md`](../../docs/hub-api.md) (read that first; this file is how to run and test).

## Run

```bash
pnpm install
pnpm --filter @squad/hub dev      # tsx watch, http://localhost:8788, seeded demo cast
pnpm --filter @squad/hub start    # no watch
curl -s localhost:8788/health
curl -s -XPOST localhost:8788/__sim/squad/demo-run -H 'content-type: application/json' -d '{"speed":2}'   # dev only
```

Env (all optional in dev; see `.env.example` for the shared ones): `HUB_PORT`, `HUB_BASE_URL`, `INTERNAL_EVENTS_SECRET` (also `HUB_INTERNAL_SECRET`, `NOOK_INTERNAL_SECRET`), `HUB_CORS_ORIGINS` (comma list, default the two Vite ports), `HUB_AUTH_SECRET`, `HUB_REPLAY_DIR`, `HUB_SEED`, `HUB_SIM`, `HUB_LOG`. With `NODE_ENV=production` seed and `/__sim/*` default to off. Logs are JSON lines on stderr and never include event bodies, free text or secrets.

## Endpoints

| Method and path                                                                         | Auth                | Purpose                                                                 |
| --------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `GET /health`, `/v1/health`                                                             | none                | liveness, seq, subscriber count                                         |
| `GET /v1/auth/students`                                                                 | none                | seeded students for the sign-in stub picker                             |
| `POST /v1/auth/dev-login`                                                               | none                | `{studentId}` to bearer token (12 h, HMAC)                              |
| `GET /v1/me`                                                                            | bearer              | viewer, squad, projector flag                                           |
| `POST /v1/squad/stream-token`                                                           | bearer              | 5-minute SSE token                                                      |
| `POST /v1/session/projector`                                                            | bearer              | server-side projector flag (only subtracts information)                 |
| `POST /internal/events`                                                                 | `X-Nook-Internal`   | ingest a `VillageEvent` or `{type:'x.*', data}`                         |
| `GET /v1/squad/state`                                                                   | bearer              | snapshot with `seq` for `Last-Event-ID`                                 |
| `GET /v1/squad/stream?st=&taskId=`                                                      | stream token        | SSE, event name = `t`, `id` = seq, resume with `Last-Event-ID`          |
| `GET /v1/squad/replays`, `/v1/squad/replay/:name`                                       | none                | replay JSON, filtered as `cast.me`                                      |
| `GET /v1/quiz/:id`, `POST /v1/quiz/:id/answer`                                          | bearer              | quiz via `QuizPort`; correctness hidden unless the squad allows         |
| `POST /v1/call/start`, `WS /v1/call/ws/:callId?st=`                                     | bearer, call ticket | calls via `CallPort`; captions mirrored to the stream                   |
| `GET /v1/tasks`, `/v1/ledger/:taskId`                                                   | bearer              | tasks and the Glass Box ledger                                          |
| `GET /v1/trips/:id`, `POST .../vote`, `POST .../confirm`                                | bearer              | trip view (own limits only), vote, confirm; `trip.confirmed` fires once |
| `GET /v1/mastery/:courseId`                                                             | bearer              | own row; `squadAvg` null under 3 members                                |
| `GET/POST /v1/squad/courses`, `POST /v1/squad/calendar`                                 | bearer              | PDF ingest hand-off, `.ics` or demo calendar                            |
| `GET /v1/personas`, `PUT /v1/personas/:id`, `GET /v1/voices`, `POST /v1/voices/preview` | bearer              | personas and voices via `MediaPort`                                     |
| `POST /__sim/squad/{demo-run,reset,emit}`                                               | none, dev only      | scripted run, reset and reseed, emit one event                          |

## Ports

`createHub({ ports: { quiz, call, brain, media } })` (see `src/ports.ts`). Missing ports use the deterministic in-memory stubs in `src/adapters`. The integration step swaps in `@squad/brain` and `@squad/media` in `src/main.ts`; nothing else imports them.

## Layout

`src/app.ts` wires everything; `ingest.ts` (validation, gates, fan-out order), `filter.ts` (the one per-viewer filter, default deny), `broker.ts` (bounded per-client queues), `store/*` (directory, event ring buffer, state, trips, ledger), `routes/*`, `ws.ts` (call socket), `sim/*` (seed and scripted run). Replay JSON lives in `sim/replays` (owned by the demo workstream).

## Tests

```bash
pnpm --filter @squad/hub test           # unit
pnpm test:smoke hub                     # end to end over real HTTP, SSE and websockets
pnpm --filter @squad/hub load           # 50 SSE clients (5 deliberately stalled), prints a JSON report
```

Smoke covers: ingest and 401/422, every event type round-tripping, snapshot then resume without loss, too-old resync, viewer filtering, quiz policy, `trip.confirmed` once and only when complete, squads of 2, replay filtering and traversal, calls (auth, mirrored captions, `audio.end`), CORS, graceful shutdown, and the sentinel-leak test (`"$180"`, `"therapy"`) over stream, snapshot, REST, replay and logs for every viewer.

## Known gaps

- The event log is an in-memory ring (5000 events). A hub restart loses it (clients get `x.resync` and refetch the snapshot). Persisting it to the shared SQLite is a contained change in `store/eventlog.ts`.
- Trips, ledger and directory are in memory and seeded; wiring them to the spine and mesh stores is integration work (emitters already reach them through `x.trip.upsert` and `x.ledger.private`).
- Sign-in is the stub (`dev-login`). Projector mode only removes information (own raw ledger value and `myLimits`); it does not add any.
- Single process only (fan-out is in memory).

## Chat (web group chat on the same router as iMessage)

`pnpm --filter @squad/hub dev` (or `start`) now also serves chat: `src/main.ts` calls `attachChatEngine`, which mounts the bot in process (`createBot` with the `web` Transport from `@squad/bot`, the full skill registry, one db, one emit, one brain and mastery store). Contract: `docs/chat-api.md`; wire types in `@squad/core` (`chat.ts`).

| Env                  | Effect                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GEMINI_API_KEY`     | real model (and real brain/quiz/media ports). Missing: deterministic demo model over the OpenStax sample, every reply labelled demo. |
| `ELEVENLABS_API_KEY` | real TTS for podcasts. Missing: fake audio, `tts: 'none'`.                                                                           |
| `CHAT_FORCE_DEMO=1`  | ignore keys and run the demo model (e2e, screenshots).                                                                               |

Gemini errors with 402/429/RESOURCE_EXHAUSTED never loop: the reply is served by the demo model, `GET /v1/status` says `{llm:'fake', reason:'credits_depleted'}` with the banner copy, and the real model is retried at most once a minute (topped-up credits work without a restart). Files: `src/chat/` (`hub-chat.ts` store + fan-out + leak guard, `routes.ts`, `files.ts` unguessable file tokens, `engine.ts`, `llm.ts`). Tests: `test/smoke/chat*.smoke.test.ts` (real HTTP and SSE: DM isolation, sentinels, cards, uploads, credits depleted).
