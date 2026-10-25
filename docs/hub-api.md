# Hub API (apps/hub), v1

Standalone Hono server. This is the contract for web, village, spine, brain, mesh and media leads. It follows `docs/specs/06-web-dashboard.md` and `docs/specs/00-OVERVIEW.md`; where this file is more specific, this file wins until a spec is amended. Event shapes live only in `@squad/core` (`VillageEventSchema`, `ReplayScriptSchema`).

Status: everything here is implemented on `ws/hub` and covered by `apps/hub/test/smoke`. Shapes are stable; changes are additive only. A repeat quiz answer returns `409 { error: { code: 'already_answered' }, recorded: true }`. `POST /v1/call/start` returns 409 `call_in_progress` when the student already has a call; a call whose websocket never connects within 60 s is hung up by the hub. `x.trip.updated` is the stream event name for a trip change (`data` is the viewer-filtered `TripView`).

## 1. Run and config

```
pnpm --filter @squad/hub dev        # tsx watch, default http://localhost:8788
```

| Env | Default | Meaning |
|---|---|---|
| `HUB_PORT` | `8788` | listen port (falls back to the port in `HUB_BASE_URL`) |
| `HUB_BASE_URL` | `http://localhost:8788` | public base URL (used in `wsUrl`, logs) |
| `INTERNAL_EVENTS_SECRET` | `change-me` | value of `X-Nook-Internal` (fallbacks: `HUB_INTERNAL_SECRET`, `NOOK_INTERNAL_SECRET`) |
| `HUB_CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | comma list of allowed browser origins (`*` allowed in dev only) |
| `HUB_AUTH_SECRET` | derived from `INTERNAL_EVENTS_SECRET` | HMAC key for bearer and stream tokens |
| `DB_PATH` | `data/squad.db` | shared sqlite (`:memory:` in tests) |
| `HUB_REPLAY_DIR` | `apps/hub/sim/replays` | replay JSON directory |
| `HUB_SEED` | `1` in dev, `0` in prod | seed 4 students, a squad, a study task, a trip, quizzes |
| `HUB_SIM` | `1` in dev | enables `/__sim/*` routes (never in production) |
| `HUB_LOG` | `info` | `debug|info|warn|error|silent`; logs are JSON lines, never contain event bodies' free text or secrets |

Errors are always `{ "error": { "code": string, "message"?: string } }` with a meaningful HTTP status. Codes: `unauthorized` 401, `forbidden` 403, `not_found` 404, `invalid_request` 400, `invalid_event` 422, `rate_limited` 429, `internal` 500.

## 2. Auth (sign-in stub)

Bearer tokens are HMAC-signed, stateless, 12 h. The stub trusts a student id; production sign-in replaces only `POST /v1/auth/dev-login`.

- `GET  /v1/auth/students` -> `{ students: [{ id, name, avatarUrl?, personaId? }] }` (public, for the host's picker)
- `POST /v1/auth/dev-login` `{ studentId }` -> `{ token, student: Student, squadId }` (403 `forbidden` when `HUB_SEED=0` and `NODE_ENV=production`)
- `GET  /v1/me` -> `{ student, squadId, projector: boolean }`
- `POST /v1/squad/stream-token` -> `{ st, expiresAt }` (5-minute token, scope `stream`; also accepted by the call websocket)
- `POST /v1/session/projector` `{ on: boolean }` -> `{ projector }`. Projector mode is a server-side session flag per student. It only ever removes information (see section 6); the client never decides what is hidden.

All `/v1/*` browser routes except `/v1/auth/*`, `/v1/health` and `/v1/squad/replay/*` need `Authorization: Bearer <token>`. SSE and websocket take `?st=` instead because `EventSource` cannot set headers. Replay needs no auth but is filtered as the replay's `cast.me` (section 7).

## 3. Health

- `GET /health` and `GET /v1/health` -> `{ ok: true, version, uptimeS, seq, subscribers, seed: boolean }`

## 4. Inbound events (emitters only)

`POST /internal/events` with header `X-Nook-Internal: <secret>` (constant-time compare). Missing/wrong secret -> 401 `unauthorized`, body never parsed.

Body is either a `VillageEvent` (validated by `VillageEventSchema`, strict) or an extension envelope `{ "type": "x.<name>", "data": {...} }`.
Response `200 { ok: true, seq }` (the id assigned) or `{ ok: true, seq: null, dropped: 'duplicate_trip_confirmed'|'trip_not_complete' }` for a `trip.confirmed` the hub refuses to publish. Invalid body: `422 { error: { code: 'invalid_event', issues: [{ path, code }] } }`. The issue list never echoes submitted values (a rejected body may contain withheld text) and the body is never logged. Body limit 64 KB. `@squad/core`'s `postEvent` is the only client you need.

Extension envelopes (`x.*`):

| `type` | `data` | Effect |
|---|---|---|
| `x.ledger.private` | `LedgerEntry` (core, with raw `withheld`) | stored privately for the owner view of `GET /v1/ledger/:taskId`; **never streamed** |
| `x.trip.upsert` | `TripRecord` (section 9, includes every student's `limits`) | stored; hub streams `x.trip.updated` filtered per viewer |
| `x.ingest.progress` | `{ student, courseId, file, status: 'queued'|'parsing'|'embedding'|'ready'|'failed', pct?: number }` | streamed to that student only |
| `x.persona.speaking` | `{ agent: AgentId, speaking: boolean, callId?: string }` | streamed to the squad |
| `x.squad.settings` | `{ squadId, revealQuizCorrectness?: boolean }` | store; streamed as `x.squad.settings` |
| `x.trip.touch` | `{ tripId }` | re-publish the filtered trip as `x.trip.updated` after a change made through the hub |

Event order on the stream is the order the hub accepted them (single writer, monotonic integer `seq` across the whole hub).

Rules the hub enforces at ingest (not just at send): `ledger.entry.withheld` is only the literal `'hidden'` (core schema); `trip.confirmed` is published at most once per `taskId` and, when the hub knows the trip (`x.trip.upsert` or seeded), only when every member has confirmed; a quiz result's `correct` stays in the log but is stripped per viewer at send.

## 5. Stream and snapshot (late joiners)

1. `GET /v1/squad/state` -> snapshot (below) containing `seq`.
2. `GET /v1/squad/stream?st=<st>&taskId=<optional>` (SSE). Send `Last-Event-ID: <seq>` (header; on a first connect where headers are impossible use `?lastEventId=<seq>`). The hub replays everything after `seq` (filtered), then goes live. No event is lost or duplicated between snapshot and stream.

Each SSE message: `id: <seq>`, `event: <t>` (the VillageEvent `t`, or `x.*`), `data: <JSON>` where JSON is the VillageEvent itself (or the `x.*` `data`). Gaps in ids are normal (events filtered out for this viewer). A comment line `: ping` every 15 s. If the requested id is older than the retained buffer (5000 events) the hub sends `event: x.resync` `data: {"seq":<latest>}` and the client must refetch the snapshot. A client that cannot keep up (queue over 256 events) is disconnected; it reconnects with `Last-Event-ID`. `taskId` filters only events that carry a `taskId`; the others still pass.

Snapshot shape (`GET /v1/squad/state`):

```ts
{
  seq: number,                         // use as Last-Event-ID
  now: number,                         // server ms
  me: { id, name, avatarUrl?, personaId? },
  squad: { id, name, members: { id, name, avatarUrl?, personaId? }[],
           memberCount: number | null },   // null when the squad has fewer than 3 members (00 rule)
  agents: Record<AgentId, 'idle'|'studying'|'in_call'|'waiting_for_student'>,
  pendingConfirms: { taskId, question }[],        // the viewer's only
  trips: { tripId, taskId, status: 'planning'|'voting'|'confirming'|'confirmed',
           confirmations: { student, confirmed: boolean }[] }[],
  calls: { callId, agent: AgentId, mine: boolean }[],   // active
  quizzes: { quizId, chapter, target?: StudentId }[],   // open quizzes the viewer can answer
  settings: { revealQuizCorrectness: boolean },
  projector: boolean,
}
```

## 6. Per-viewer filtering (server, before every send; same function for stream, snapshot, ledger, trips and replay)

| Event / data | Who sees it | Everyone else |
|---|---|---|
| `ledger.entry` | `shared`, `field`, `blocked` to the whole squad | `withheld` is only ever the literal `'hidden'` (raw text is not in the event, see 00); the owner's raw value exists only in `GET /v1/ledger/:taskId` |
| `confirm.pending`, `confirm.done` | the `student` it names | dropped |
| `mastery.changed` | the `student` it names | dropped |
| `quiz.answer`, `quiz.result` `correct` | removed by default; kept only if `revealQuizCorrectness` and (the viewer is that student, or the squad has 3+ members) | `correct` removed |
| `call.start`, `call.end` | the squad (presence) | n/a |
| `call.caption` | the student on that call (`call.start.student`); public calls with no student go to the squad | dropped |
| `x.ingest.progress` | that student | dropped |
| `x.trip.updated` | the squad, with `myLimits` only for the owner and vote tallies removed when the squad has fewer than 3 members | |
| everything else | the squad | |

Squad routing: events naming a student (`student`, `student:<id>` agents, `target`) go to that student's squad; events with none (dean, experts, councils) go to every squad. Minimum group size: squads under 3 get `memberCount: null`, `squadAvg: null`, no vote tallies, no counts or averages anywhere. Projector mode additionally removes the viewer's own raw `withheld` from `GET /v1/ledger/:taskId`, drops `myLimits`, and blurs nothing else (it only subtracts).

## 7. Replay

- `GET /v1/squad/replay/:name` -> `ReplayScript` (core schema, `{ name, version: 1, loop, cast: { me, ... }, events: [{ at, event }], checkpoints }`). Files: `apps/hub/sim/replays/<name>.json` (owned by the demo workstream). `name` is `[a-z0-9_-]+` (no path traversal), unknown -> 404. Every file is validated on load; an invalid file is 500 `internal` with the zod paths in the log only.
- Filtered server-side with the viewer = `cast.me`, using the same filter as live (so withheld stays `'hidden'`, other students' confirms/mastery are dropped, `correct` stripped). `loop`, `cast`, `checkpoints` pass through unchanged. Cache headers: `Cache-Control: no-store`.
- `GET /v1/squad/replays` -> `{ replays: [{ name, durationMs, eventCount }] }`.
- The client plays it (`ReplaySource`); there is no other replay endpoint or format.

## 8. Quizzes (game-free, port-backed)

Same endpoints serve the village, the web pages and the bot path.

- `GET  /v1/quiz/:quizId` -> `{ quizId, chapter, question, choices?: { id, text }[] }` (free text when no `choices`). Never contains the answer key. 404 if not open to this viewer.
- `POST /v1/quiz/:quizId/answer` `{ choice?: string, text?: string }` (exactly one) -> `{ recorded: true, correct?: boolean, explanation?: string }`. `correct` and `explanation` are present only if `revealQuizCorrectness` is on for the squad (default off). The hub emits `quiz.answer` then `quiz.result` onto the stream. Idempotent per `(quizId, student)`: a second answer returns 409 `already_answered` with `{ recorded: true }`.
- Brain plugs in through `QuizPort` (section 11).

## 9. Calls (game-free, port-backed)

- `POST /v1/call/start` `{ agentId }` -> `{ callId, wsUrl, ticket }`. `wsUrl` is `ws(s)://<hub>/v1/call/ws/<callId>`; connect with `?st=<ticket>` (a 5-minute call-scoped token). The hub emits `agent.state in_call` and `call.start { student }`. 404 for an unknown agent, 409 if this student already has an open call.
- WebSocket `/v1/call/ws/:callId?st=`. Client to server (JSON text frames): `{ "type": "user.text", "text": string }`, `{ "type": "mute", "muted": boolean }`, `{ "type": "audio.end" }`, `{ "type": "end" }`; binary frames are raw audio chunks (`audio/webm;codecs=opus`) buffered by the session (never stored by the hub) if it supports audio. `audio.end` (or `mute: true`) marks the end of a mic turn: the hub calls `CallSession.replyToAudio()` (media transcribes and brain answers) and streams the returned turns as `caption` and `audio` frames; sessions without audio support answer `{ type: "error", code: "audio_unsupported" }` to `audio.end`. Server to client: `{ "type": "ready", callId, agent }`, `{ "type": "caption", seq, speaker: "agent"|"you", text, cite?: Citation }`, `{ "type": "audio", seq, mime, base64 }` (or a binary frame preceded by `{ "type": "audio.meta", seq, mime }`), `{ "type": "ended", reason: "client"|"agent"|"timeout"|"server" }`, `{ "type": "error", code }`. Agent captions are mirrored onto the stream as `call.caption` (the hub, per 00). Idle timeout 5 minutes, hard cap 20 minutes, max 8 concurrent calls (429 beyond).
- On close (any reason) the hub emits `call.end` and `agent.state idle`.
- Brain plugs in through `CallPort` and media through `MediaPort` (section 11). The stub agent answers from a canned script with citations.

## 10. Domain endpoints

All bearer-auth, viewer-scoped.

| Endpoint | Response |
|---|---|
| `GET /v1/tasks` | `{ tasks: [{ taskId, kind: 'study'|'trip'|'council', title, status, updatedAt }] }` |
| `GET /v1/ledger/:taskId` | `{ taskId, entries: LedgerEntry[] }` oldest first. Owner's own rows carry raw `withheld` (unless projector); everyone else's `withheld` is `'hidden'` or absent |
| `GET /v1/trips/:tripId` | `{ tripId, taskId, status, options: { id, label, estCost?: string }[], dates, votes: { student, ranking: string[] }[] \| null, tallies: Record<optionId, number> \| null, vetoed: { optionId, by: 'mediator', reason: string }[], confirmations: { student, confirmed }[], myLimits: Record<string, string> \| null }`. `myLimits` is the viewer's own only. Other students' ranking is omitted until `status = 'confirming'`; `votes`/`tallies` are `null` for squads under 3 |
| `POST /v1/trips/:tripId/vote` `{ ranking: string[] }` | `{ ok: true }` (hub records, emits `x.trip.updated`) |
| `POST /v1/trips/:tripId/confirm` `{ optionId, yes }` | `{ ok: true, status }`. Emits `confirm.done`; when every member said yes the hub emits `trip.confirmed` once |
| `GET /v1/mastery/:courseId` | `{ courseId, concepts: string[], mine: number[], squadAvg: number[] \| null }` (`squadAvg` null under 3 members) |
| `GET /v1/squad/courses` | `{ courses: [{ courseId, title, file, status, pct? }] }` |
| `POST /v1/squad/courses` (multipart `file`, PDF, 50 MB cap) | `202 { courseId, file, status: 'queued' }` (handed to `BrainPort.ingestCourse`) |
| `POST /v1/squad/calendar` (`.ics` multipart or `{ demo: true }`) | `{ busyBlocks: number }` (raw data goes only to the student's own agent via `BrainPort`/mesh stub, never stored in events) |
| `GET /v1/personas` | `Persona[]` |
| `PUT /v1/personas/:id` `{ voiceId?, avatarUrl? }` | `Persona` |
| `GET /v1/voices` | `{ voices: [{ id, name, label? }] }` |
| `POST /v1/voices/preview` `{ voiceId, text }` | `audio/mpeg` bytes (MediaPort, cached by `(voiceId, text)`; text max 400 chars) |

## 11. Ports and adapters (how brain and media plug in)

Defined in `apps/hub/src/ports.ts` and consumed through `createHub({ ports })`. The hub ships in-memory stubs in `apps/hub/src/adapters/stub-*.ts` (deterministic, used by seed, tests and the demo). Brain/media leads implement the same interfaces and the integration step swaps them in `apps/hub/src/index.ts`; the hub never imports `packages/brain` or `packages/media` itself except in that one wiring file.

```ts
interface QuizPort {
  get(quizId: string, viewer: StudentId): Promise<QuizPayload | null>;       // no answer key
  answer(quizId: string, viewer: StudentId, a: { choice?: string; text?: string }):
    Promise<{ recorded: boolean; correct?: boolean; explanation?: string; chapter: string } | null>;
  listOpen(viewer: StudentId): Promise<{ quizId: string; chapter: string; target?: StudentId }[]>;
}
interface CallPort {
  open(args: { callId: string; agent: AgentId; student: StudentId }): Promise<CallSession | null>; // null = unknown agent
}
interface CallSession {
  greeting(): AsyncIterable<CallTurn>;
  reply(userText: string): AsyncIterable<CallTurn>;      // text (and optional audio) turns
  audio?(chunk: Uint8Array): void;                       // mic chunks, buffered
  replyToAudio?(): AsyncIterable<CallTurn>;               // on audio.end or mute:true
  close(): Promise<void>;
}
type CallTurn = { text: string; cite?: Citation; audio?: { mime: string; data: Uint8Array } };
interface BrainPort {
  ingestCourse(student: StudentId, file: { name: string; bytes: Uint8Array }): Promise<{ courseId: string }>;
  listCourses(student: StudentId): Promise<CourseStatus[]>;
  mastery(student: StudentId, courseId: string): Promise<{ concepts: string[]; mine: number[]; squad: number[][] }>;
  loadCalendar(student: StudentId, input: { ics?: string; demo?: boolean }): Promise<{ busyBlocks: number }>;
}
interface MediaPort {
  personas(): Promise<Persona[]>;
  updatePersona(id: string, patch: { voiceId?: string; avatarUrl?: string }): Promise<Persona | null>;
  voices(): Promise<{ id: string; name: string; label?: string }[]>;
  preview(voiceId: string, text: string): Promise<{ mime: string; data: Uint8Array } | null>;
}
```

Ports never emit raw withheld values and never decide visibility; the hub applies the filter and the reveal policy on whatever a port returns.

## 12. Sim and seed (dev only, `HUB_SIM=1`)

Seed: students `s_ana`, `s_ben`, `s_chi`, `s_dev` (squad `sq_demo`, 4 members), a study task, trip `trip_cabo`, quizzes `qz_ch5_1`, `qz_ch5_2`, private ledger rows holding the sentinels `$180` and `therapy` (they must never leave through anything except the owner's `GET /v1/ledger`).

- `POST /__sim/squad/demo-run` `{ speed?: number }` -> `{ ok: true, events: n }`: plays a scripted run of every event type onto the live stream.
- `POST /__sim/squad/reset` -> clears log, state and reseeds.
- `POST /__sim/squad/emit` `{ event }` -> same as `/internal/events` without the secret (dev convenience only).

## 13. Quick examples

```bash
curl -s localhost:8788/v1/health
curl -s -XPOST localhost:8788/v1/auth/dev-login -H 'content-type: application/json' -d '{"studentId":"s_ana"}'
curl -s -XPOST localhost:8788/internal/events -H 'X-Nook-Internal: change-me' -H 'content-type: application/json' \
  -d '{"t":"agent.state","agent":"student:s_ana","state":"studying"}'
curl -N "localhost:8788/v1/squad/stream?st=$ST" -H 'Last-Event-ID: 41'
```
