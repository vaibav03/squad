# Council API ("ask the council"), v1

A student asks a question; three members (Skeptic, Teacher, Practitioner) answer independently, rank each other's answers by order only, and a Chair writes a verdict with a confidence word and the dissent kept. Wire types live only in `@squad/core` (`packages/core/src/council.ts`). The service is `createCouncilService` in `@squad/brain` (`packages/brain/src/councils`). The routes are `apps/hub/src/routes/council.ts`.

All routes need a viewer (`Authorization: Bearer <token>`; the SSE route also accepts `?st=<stream token>` from `POST /v1/squad/stream-token`). Errors are `{ "error": { "code": string } }`.

## 1. Routes

### `POST /v1/council/ask`

Body (`CouncilAskBodySchema`, strict): `{ "question": string (3..600, trimmed), "chatId"?: "group:<squadId>" | "dm:<studentId>" }`. Bodies over 4 KB are refused.

| Status | Body | When |
|---|---|---|
| 202 | `CouncilAskResponse` | run started (the run continues in the background) |
| 400 | `invalid_request` | body fails the schema or is not JSON |
| 401 | `unauthorized` | no or bad token |
| 403 | `forbidden` | `chatId` is not `group:<viewer.squadId>` or `dm:<viewer.studentId>` |
| 413 | `too_large` | body over 4 KB |
| 429 | `busy` or `rate_limited` | `CouncilBusyError` from the service (section 5) |

A `dm:` chat makes the run `visibility: "private"`; a group chat or no chat id makes it `"squad"`.

```
POST /v1/council/ask   { "question": "Does a higher yield mean a lower bond price?", "chatId": "group:sq_demo" }
202 { "id": "cn_k3j9x0a1b2c3", "status": "running",
      "streamUrl": "/v1/council/cn_k3j9x0a1b2c3/stream",
      "resultUrl": "/v1/council/cn_k3j9x0a1b2c3" }
```

### `GET /v1/council/:id`

The `CouncilResult` snapshot (also the final result card). `cache-control: no-store`. The output is re-validated with `CouncilResultSchema`; a result that fails answers `500 internal` with no content.

It is `404 not_found` (never 403, so existence is not revealed) when the id is malformed or unknown, when the viewer is in another squad than the asker, or when `visibility` is `private` and the viewer is not `askedBy`.

```
200 { "id": "cn_k3j9x0a1b2c3", "question": "...", "status": "done", "phase": "done",
      "grounding": "course", "notes": [], "members": [ { "id": "skeptic", "name": "Skeptic", ... } ],
      "rankings": [ { "member": "Skeptic", "order": ["Teacher", "Practitioner"] } ],
      "verdict": { "chair": "Chair", "text": "...", "confidence": "fairly_sure", "uncertain": false, ... },
      "visibility": "squad", "askedBy": "s_ana", "demo": false, "startedAt": 1700000000000, "finishedAt": 1700000012000 }
```

`status`: `running | done | failed | refused`. `phase`: `opinions | rankings | verdict | done`. `grounding`: `course` (verified `[file p.N]` citations), `general` (materials do not cover it, said plainly), `none` (refused or failed before any member spoke). `message` is set for `failed` and `refused`.

### `GET /v1/council/:id/stream?st=<token>`

Server-sent events, same framing and auth as `/v1/squad/stream`: first bytes `retry: 2000` and `: connected`, then `: ping` every `sse.pingMs` (15 s). Visibility rules and 404s are the same as the GET (checked before the stream opens, and for every snapshot).

- `event: council.step`, `id: <n>` (a per-stream counter from 1), `data: <CouncilResult JSON>`: the current snapshot immediately on connect, then after every change.
- When `status` is `done`, `failed` or `refused`: `event: council.done` with the same data, then the server closes the stream.
- When the client aborts, the subscription is removed.

## 2. Village events

A run also drives the village through the normal pipeline (`deps.ingest.village`, so everything goes out on `/v1/squad/stream` with the usual per-viewer filter). There is no parallel path. Event shapes are `CouncilEvent` in `@squad/core`.

- `councilId` is always `council:ask` (the agent id of the ask council). Events carry no run id, so a client correlates by order: one run is opinion x3 (or x2 after a failed member), rank xN, then verdict.
- `council.opinion` x3: `member` is `Skeptic`, `Teacher` or `Practitioner`, `text` is the member's answer (struck claims removed).
- `council.rank` x3: `member`, `order` (the other members' names, best first). Order only.
- `council.verdict`: `member` is the chair, `Chair`; `text` is the verdict; `dissent: true` and `dissenter` when a member disagreed; `outcome` is a `RoomOutcome`:
  - `title`: the verdict in one line
  - `summary`: the verdict text
  - `facts`: `Confidence` (the word, never a number) and `Sources`
  - `dissent` line when there is one
  - `why`: one entry per member (`who`, `text`)
  - `notes`: what to do next, then any run notes

The hub filter passes `council.*` to every squad member. Private runs emit the same events with no `text` and no `outcome` (members still animate in the village, but the content never leaves the asker's own GET and stream); `council.rank` still carries `order` (member names only) and `dissent`/`dissenter` are kept.

## 3. Privacy and scoping

1. A run asked from `dm:<me>` is `private`: only `askedBy` can GET or stream it. Teammates and other squads get `404 not_found`.
2. A `squad` run is readable by members of the asker's squad only (squad = `directory.squadOf(askedBy)`); other squads get 404.
3. The `chatId` must be the viewer's own squad group or own dm; anything else is 403.
4. Responses never contain the private text for anyone else; the 404 body is the same as for an unknown id.
5. Covered by the sentinel tests in `apps/hub/src/routes/council.test.ts` and `apps/hub/test/smoke/council.smoke.test.ts` (`SENTINELS`: `$180`, `therapy`).

## 4. Chat integration

- `ChatCard` has a `council` variant: `{ "type": "council", "runId": "cn_xxxxxxxxxxxx", "question"?: string }`. The client renders it by fetching `GET /v1/council/:id` (and may watch the stream while `running`).
- The web transport turns a bot text reply whose last line is the footer `(council run cn_xxxxxxxxxxxx)` into that card.
- Bot skill triggers: `@cubbie council <question>` and `ask the council ...`. In a DM the run is private; in the squad chat it is a squad run. The bot replies with the verdict text (`councilVerdictText`) plus the footer line.
- `councilVerdictText(result)` renders the public fields as plain text for iMessage, Discord and clipboard.

## 5. Budgets, limits, degradation

| Limit | Value |
|---|---|
| per LLM call timeout | 25 s |
| whole run | 90 s |
| unfinished runs per asker | 1 (`429 busy`) |
| runs per asker per hour | 12 (`429 rate_limited`) |
| request body | 4 KB (`413`) |
| question | 3..600 characters |

Degradation: a member that fails or times out is dropped, the run continues with two members and adds a note ("... did not answer, two members voted"). With fewer than two members the run ends with `status: "failed"` and an honest `message`. A run over 90 s ends the same way.

## 6. Demo mode

Without `GEMINI_API_KEY` there is no real model. The first council request builds a service with `createDemoCouncilLlm()` (a deterministic fake model) on the fixture course, with `demo: true`, cached on `deps.council`. Every result of such a service carries `demo: true`; clients must show that these are canned answers. With a key, `createRealPorts` builds the service with Gemini and `demo: false`.

| Env | Meaning |
|---|---|
| `GEMINI_API_KEY` | enables the real model and real course grounding |

## 7. Run and test

```
pnpm --filter @squad/hub dev
curl -s -X POST localhost:8788/v1/auth/dev-login -H 'content-type: application/json' -d '{"studentId":"s_ana"}'
curl -s -X POST localhost:8788/v1/council/ask -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"question":"Does a higher yield mean a lower bond price?"}'

pnpm --filter @squad/hub test         # route tests with a fake service
pnpm --filter @squad/hub test:smoke   # real service + demo model end to end
```
