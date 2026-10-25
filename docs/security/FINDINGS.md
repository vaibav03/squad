# Security findings

Status: FIXED (in this branch), OPEN (owner), INFO.

| id | sev | where | issue | status |
|---|---|---|---|---|
| IDOR-1 | high | apps/hub/src/routes/domain.ts:37 `GET /v1/ledger/:taskId`, store/ledger.ts `entries` | Any signed-in student read another squad's shared ledger rows by guessing a task id (store is not squad-scoped). Exploit: login as student in squad B, GET /v1/ledger/task_trip_cabo. | FIXED: `ledgerScope` middleware, 404 for foreign and unknown. Proper fix for owner of domain.ts: filter in the route with `deps.ledger.taskIds(v.squadId, ...)`. |
| AUTH-4 | medium | apps/hub/src/auth.ts:68-83 `requireViewer` allowQuery accepts `bearer` in `?st=` | 12 h bearer in a URL (logs, Referer). | FIXED: `streamTokenOnly`. Owner of auth.ts: drop `'bearer'` from the kinds list. |
| CFG-1 | high | apps/hub/src/config.ts:37-47 | Default secret `change-me`; auth secret derived from it (`auth:change-me`), so tokens are forgeable if the internal secret is unset; production with HUB_SEED=1 keeps unauthenticated dev-login; HUB_SIM defaults on unless NODE_ENV=production. | FIXED: `assertSafeConfig` refuses to boot in production (override for a demo deploy: `HUB_ALLOW_DEMO=1`, which downgrades seed/sim to warnings; secrets must still be strong). Deploy lead: set INTERNAL_EVENTS_SECRET and HUB_AUTH_SECRET (32+ chars), NODE_ENV=production. |
| ABUSE-1 | medium | routes/media.ts `/v1/voices/preview`, routes/call.ts, domain.ts uploads | No rate limits (TTS and LLM cost exhaustion). | FIXED: rate-limit rules in middleware/index.ts DEFAULT_RULES (chat `/v1/chat` 60/min, council `/v1/council` 12/h pre-registered for when those routes merge). |
| ABUSE-2 | medium | routes/stream.ts | Unlimited SSE connections per student. | FIXED: cap 12 per student. |
| INPUT-4 | medium | domain.ts:140 uploads, all JSON routes | Size checked only from Content-Length; chunked bodies bypass. JSON bodies unbounded. | FIXED: streaming byte cap (256 KB JSON, 52 MB multipart). |
| UPLOAD-1 | high | domain.ts:146 | PDF accepted by file name or client MIME; .ics by name only; no content checks. | FIXED: `uploadGuard` (magic number, bomb heuristics, ics structure, line/event caps). Note PDF parsing itself is in packages/brain; keep its own page cap. |
| UPLOAD-4 | low | domain.ts:155 | Upload file name echoed to events/response unsanitised. | FIXED: sanitised by `uploadGuard`. |
| HDR-1 | medium | hub | No security headers. | FIXED for the hub API. OPEN (web-host owner): apply `webHostHeaders({hubOrigin, callPage})` from apps/hub/src/middleware/headers.ts to the web host (CSP, nosniff, no-referrer, frame-ancestors none, Permissions-Policy microphone only on the call page). |
| IGNORE-1/2 | medium | .gitignore | Conflict markers (already fixed on main) and no ignore for vendor-local/, *.db, *.map, *.pem, *.key. | FIXED. |
| MEDIA-1 | medium | routes/media.ts:28 `PUT /v1/personas/:id` | Personas are global; any student can change any persona's voice and avatar URL (https URL = tracking pixel for every viewer). | OPEN (media/accounts lead): per-squad persona overrides, or host allow-list for avatarUrl. Not blocked because the smoke test and UI edit shared personas; rate-limited 20/min. |
| AUTH-8 | low | routes/replay.ts:56-85 | `/v1/squad/replays` and `/replay/:name` need no auth (replay is filtered as `cast.me`). Names are regex-pinned (no traversal; probed). | OPEN: require a viewer if replays ever contain real data. |
| AUTH-9 | low | auth.ts | No token revocation, no session fixation concern (no cookies). Tokens: bearer 12 h, stream 5 min, call 5 min bound to call id and student (verified). | INFO |
| SIM-1 | medium | routes/sim.ts | `/__sim/*` (reset, emit) unauthenticated whenever sim is on; only guarded by NODE_ENV=production. | MITIGATED by config guard (fatal in production, warn on non-localhost baseUrl). |
| DEP-1 | high (dev only) | pnpm-lock.yaml: vitest/tinypool | 2 critical + 3 moderate advisories, dev dependencies only; `pnpm audit --prod` is clean. | OPEN (any lead): bump vitest to >=4.1.12. |
| LIC-1 | medium (legal) | assets/pixel/LICENSES.md; assets/pixel/monsters/ansimuz-sideview-fantasy-sprites/Grotto-escape-2-boss-dragon/patreon-license.txt | Listed as CC0 but the pack carries a Patreon-supporter license. | OPEN (art lead): verify or remove. Also: LGPL libvips (via sharp) belongs in credits; Lottie license text missing; absolute local path in LICENSES.md. |
| SECRET-1 | info | git history and tree | No API-key patterns (AIza, AQ., sk-, xi-, ghp_, AKIA, private keys) found in 411 commits; no .env, db, map or key files tracked. Re-run with `pnpm security:scan`. | CLEAN |
| CHAT-1 | to review | chat/web, council/ask (on `main` since batch 3; not on main when reviewed) | IDOR on chat/DM/course ids, XSS in message and citation render, per-user limits. Rules for `/v1/chat` and `/v1/council` are pre-registered; probes not yet written for them. | OPEN: those branches are merged now, so rerun (add paths to probes.ts PROTECTED and idor). |
| CRYPTO-1 | info | packages/mesh | secureRng (crypto.randomBytes) is the default; seededRng only when `deps.seed` is set (flows/runtime.ts:146) and in PSI tests. PSI padded to fixed sizes (168 study, 64 trip) and shuffled; share modulus 2^127-1 with 192-bit sampling (bias ~2^-65). Trust table is honest; add the n-1 collusion limit (see THREAT-MODEL). | INFO |
| PRIV-1 | info | domain.ts mastery, trips.view | Min group size 3 enforced server-side for mastery averages and vote progress (probed by existing tests). Podcast and topic counts live outside the hub; not reviewed. | INFO |

## Prompt injection
Chapter expert (packages/brain/src/experts/expert.ts) has no tool access and its output is accepted only if each claim's quote is found verbatim on the cited page (citations/check.ts); regression test in apps/hub/test/security/units.security.test.ts. The mesh bouncer wraps untrusted text in `<untrusted>`. Residual risk: injected text can still be quoted back as an answer.

## Run the scan
`pnpm security:scan` (flags: `--no-audit` offline, `--no-history` skip git history). Exit 1 on any critical/high/medium finding. Hub tests: `pnpm --filter @squad/hub test:security`.

## Rate limits and interactive use (blank-shell 2)

| ID | Change |
| -- | ------ |
| ABUSE-RL-1 | The security middleware answered 429/413/403 before CORS ran, so the browser got no `Access-Control-Allow-Origin`, hid the status and the web showed "You are offline". CORS now runs first, and exposes `Retry-After`. FIXED. |
| ABUSE-RL-2 | Read ceilings raised for interactive use and shared (campus/NAT) addresses: `api-ip` 6000/min, `api-user` 1200/min keyed on the session, `students` 600/min, `stream-token` 240/min, invite preview 120 per 10 min, SSE streams 24 per user. Unchanged (abuse intent kept): auth start 20/h per IP, verify 60/h, dev-login 300 per 5 min, uploads 10-20/h, call start 20/h, council 12/h, chat 60/min, internal events. |
| ABUSE-RL-3 | 429 bodies always carry `retryAfterS` and a `Retry-After` header equal to the time left in that key's window. |
