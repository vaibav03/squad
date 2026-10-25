# Live discussion API

Agents hold a spoken discussion about a topic; the student listens, interrupts, and leaves with takeaways. Design and verified Gemini Live facts: `docs/live-discussion.md`. Wire contract (zod, browser-safe): `packages/core/src/live.ts`. Code: `apps/hub/src/live/**`, `apps/hub/src/routes/live.ts`.

All routes need a viewer (bearer or session cookie; the SSE stream also accepts `?st=<stream token>` like the council stream). A run is `squad` (everyone in the asker's squad can watch) or `private` (started with `chatId: "dm:<me>"`, only the asker can see it). A run the viewer may not see answers `404 not_found`, never 403. Only the asker can `say`, `stop` and use `actions/*` (403 for other squad members).

## Endpoints

| Method and path | Body | Result |
|---|---|---|
| `POST /v1/live/start` | `LiveStartBody` `{topic, chatId?, mode?: 'audio'|'captions'}` | `202 LiveStartResponse` `{id: "ld_xxxxxxxxxxxx", streamUrl, resultUrl}`. `429 busy` (one active run per viewer) or `429 rate_limited` (6 starts per hour). `403` for a chat that is not yours. |
| `GET /v1/live/:id` | | `LiveSnapshot` (re-validated before sending) |
| `GET /v1/live/:id/stream` | | SSE. `event: live`, `id: <n>`, `data: LiveStreamEvent`. First event is always `snapshot`; the last is `ended` and the stream then closes. A run that already ended replays `snapshot` then `ended`. Pings are SSE comments. |
| `POST /v1/live/:id/say` | `LiveSayBody` `{text, to?, kind?: say|lost|simpler|disagree|summarize}` | `202 {ok:true}`. `409 ended` after the run ended. |
| `POST /v1/live/:id/stop` | `{}` | `202`. The Chair gives a closing summary, then `ended` with `reason: user_left`. |
| `POST /v1/live/:id/actions/post-chat` | `{}` | Posts a `live` chat card from Cubbie to the run's chat (or the squad group; DM for private runs). `{ok, ref: messageId}` |
| `POST /v1/live/:id/actions/quiz` | `{}` | Starts a quiz round through the existing quiz port for the chapter of the first verified source (default `ch2`). `{ok, ref: quizId}`; `501 unavailable` on a stub hub. |
| `POST /v1/live/:id/actions/study-plan` | `{}` | Stores the takeaways' next steps for the viewer (table `hub_live_plan`). `{ok, count}` |

## Stream events (`k`)

`snapshot` (full state, replaces everything) · `status` · `floor` (who speaks; `thinking` is the next speaker) · `caption` (append `delta` to turn `turnId`; citation markers never appear in it) · `turn` (a finished turn, with verified `citations`; `interrupted: true` and truncated text when the user cut it) · `audio` (`pcm` base64 16-bit LE mono, `rate: 24000`, `seq` per turn; only when `mode: 'audio'`, SSE only) · `interrupted` · `takeaways` (rebuilt every 2 agent turns and at the end) · `ended` (`reason`: `wrapped|user_left|max_turns|max_time|budget|error`, plus the final snapshot).

Exactly one speaker holds the floor at a time: every `caption`/`audio` event's speaker equals the open `floor` speaker. In demo mode the fake audio is a quiet 120 ms tone per sentence; `snapshot.audio` is `false` there.

## Turn taking

One Live session per persona (3 to 5 of Tutor, Skeptic, Planner, Examiner, Chair; default all 5, the Chair is always in). The Chair opens, the others follow round robin, and the Chair steers after every 4 agent turns. Each finished transcript is relayed as text input to the next speaker (they "hear" each other). On `say`, the current speaker is cut (`interrupted` event, turn kept with its truncated text), the user's words become a `user` turn, and the Chair (or the addressed agent) answers it next, after which the rotation resumes. Sources are re-retrieved for the topic plus the user's words.

## Grounding and citations

Before the run, and after every user interruption, the hub retrieves pages for the topic through the same citation-checked retrieval the council uses (`Brain.ask`; a built-in fixture course on a stub hub) and puts them in the agents' input as SOURCES. Agents cite as `[file p.N]`. A marker becomes a citation chip only if that page was retrieved and a verbatim run of the sentence is on that page (brain `verifyClaims` / `quoteOnPage`). Every marker is removed from displayed text, verified or not. `takeaways.sources` are only verified chips; `grounding` is `course` when at least one was used.

## Takeaways

Built live with `Llm.json` (tier `fast`) when a real model is wired; a deterministic heuristic keyed on who spoke (Chair decisions, Skeptic disagreement with who/why, Planner next steps, Examiner quiz) in demo, tests and as the fallback when the call fails. Every item carries the `turnId` it came from.

## Demo fallback

The run restarts transparently on FakeLive with `snapshot.demo = true` and a `note` ("no key", "credits depleted", "Live API key rejected", "Live API rate limited", "Live service unavailable", "demo mode (forced)") when: `FORCE_FAKE_LIVE=1`, no `GEMINI_API_KEY`, connect fails, or the first turn fails. Gemini reports depleted credits as a socket close (code 1011, reason "Your prepayment credits are depleted", no HTTP 402, no error event), so close reasons are mapped: `credits|prepayment|depleted` to credits, `api key|permission|unauth` to auth, `quota|rate|exhausted` to rate_limited, anything else to unavailable; a close before the first turn completes counts as a failure. The client then sends a fresh `snapshot` event (turns reset). After the first turn, a Live failure ends the run with `reason: error`. The UI must show "Demo mode".

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | | Server-side only; never in any payload, event or log. Missing means demo mode. |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Live model id |
| `FORCE_FAKE_LIVE` | | `1` forces demo mode |
| `FAKE_LIVE_SPEED` | `25` (`0` under vitest) | ms per word of the scripted agents |
| `LIVE_MAX_TURNS` | `14` | Agent turns before the Chair wraps up (`max_turns`) |
| `LIVE_MAX_SECONDS` | `240` | Wrap up at the next turn boundary after this long (`max_time`); a hard stop timer at +10 s closes every session (`budget`) |
| `LIVE_MAX_TURN_CHARS` | `600` | Longest transcript kept per turn |
| `LIVE_MAX_ACTIVE_PER_USER` | `1` | Concurrent runs per viewer |
| `LIVE_STARTS_PER_HOUR` | `6` | Starts per viewer per hour |
| `LIVE_TURN_TIMEOUT_MS` | `30000` | A stalled turn is closed after this long |

## Privacy

Runs are in memory only. Private (DM) runs are visible to the asker only; their village events (`discussion.*`) carry no `text` or `cites`. Public runs put caption-sized text (max 400 chars) and verified citation labels in village events. Audio chunks go only to the SSE stream, never into village events or logs. Agents never receive ledger, mesh or mastery data: their input is the topic, retrieved course pages, the room transcript and the user's words. Village events are routed to the run's squad only.

## Ephemeral tokens (documented, not used)

Gemini supports browser-direct Live sessions with short-lived tokens (`ai.authTokens.create({config: {uses: 1, expireTime, newSessionExpireTime, liveConnectConstraints}})`, browser connects with `apiKey: token.name`). Squad does not use them: the hub must relay between agents anyway, and proxying keeps the key off the browser.

## Try it

```bash
FORCE_FAKE_LIVE=1 PORT=8893 pnpm --filter @squad/hub dev   # or without FORCE_FAKE_LIVE to use the key
T=$(curl -s -XPOST localhost:8893/v1/auth/dev-login -H 'content-type: application/json' -d '{"studentId":"s_ana"}' | jq -r .token)
ID=$(curl -s -XPOST localhost:8893/v1/live/start -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"topic":"how do z-scores work?"}' | jq -r .id)
curl -N "localhost:8893/v1/live/$ID/stream?st=$T"
curl -XPOST localhost:8893/v1/live/$ID/say -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"text":"I am lost","kind":"lost"}'
```

In chat: `@cubbie discuss: how do z-scores work?` replies with `(live discussion ld_xxxxxxxxxxxx)`, which the web transport renders as the `live` card.

Real call check (manual, one tiny call, never in `pnpm check`): `LIVE_DISCUSSION_REAL=1 pnpm --dir scripts/live exec tsx checks/09-live-discussion.ts`.

## Tests

`apps/hub/src/live/*.test.ts` (engine, fallback, budget, Gemini client with an injected `ai.live.connect`), `apps/hub/src/routes/live.test.ts` (auth, 404s, SSE schema, privacy and key-leak sweeps), `apps/bot/src/transports/live-card.test.ts`. All deterministic with FakeLive and zero delays.
