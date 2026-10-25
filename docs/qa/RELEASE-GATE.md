# Release gate harness

The gate is **one continuous journey**, not independent demos. A run owns one fixture world (one squad, one group
iMessage thread, one web conversation) and every later step builds on the earlier ones:

```
S1 connect Canvas + Google (minimal permissions)         S6 reply delivered into the same iMessage group
S2 ingest + normalize permitted context                  S7 web chat shows the complete ordered thread (and mirrors back)
S3 agents retrieve it, answers carry verified citations  S8 conversation continues into a collaborative trip plan
S4 group iMessage tagging @cubbie / @cubbi               S9 ... and a shared study plan
S5 route to the correct LIVE agent, same grounded ctx    S10 decisions, updates, failures, agent activity synced in web and iMessage
```

The plan behind it is `docs/plans/RELEASE-GATE.md`; the review it belongs to is `docs/plans/E2E-PRODUCT-REVIEW.md`. This
document is how to run the harness, how to read it and what it needs from the outside world. The latest result is
[`RELEASE-GATE-REPORT.md`](RELEASE-GATE-REPORT.md) (and `.json`).

## 1. Statuses (what a result may say)

| Status | Meaning |
|---|---|
| `PASS` | every assertion held. Always labelled with what it means: `PASS (fixture)`, `PASS (fixture/degraded)`, or `PASS (real)`. |
| `FAIL` | an assertion failed on a feature that is on this tree. Fails `pnpm gate`. |
| `BLOCKED(reason, runbook)` | an external prerequisite is missing (credentials, Apple permission, a second person, provider credit). Never turned into a pass; the runbook link is in the report. |
| `NOT_BUILT(owner branch)` | the owning feature branch is not on `origin/main` yet. **Never `PASS`.** The report lists the branch, whether it is pushed and whether it is on this tree. |
| `SKIPPED(flag)` | the real variant was not requested (`GATE_REAL` unset). |

Every step has a `fixture` variant and a `real` variant; the report shows both columns. Overall verdict, in order:
`HARNESS-ERROR`, `RED` (a BUILT step failed), `INCOMPLETE` (steps still NOT_BUILT), `FIXTURE-GREEN / REAL-BLOCKED`, `GREEN`.

Exit codes of `pnpm gate`: `0` nothing BUILT failed, `1` a BUILT step failed, `2` harness error (stack did not come up),
`3` only with `GATE_STRICT=1` when anything is still NOT_BUILT, BLOCKED or not run (so CI cannot mistake it for green).

### How NOT_BUILT flips to real assertions

`e2e/gate/lib/probes.ts` has one probe per capability (`P.context`, `P.connectors`, `P.mentions`, `P.imsync`, `P.a2a`,
`P.board`, `P.trip`, `P.study`, `P.blankShell`, `P.floatingChat`). A probe is built when `origin/<owner branch>` is an
ancestor of `HEAD`, or when its marker files exist on the tree. A step lists the probes it needs; when all are built its
assertions run and decide `PASS`/`FAIL`, otherwise it is `NOT_BUILT(owners)` and may run a clearly labelled `preview`
(the part that already works on main; informational, never a pass). The merge captain lands branches in order
(floating-chat + blank-shell, w0, typed-mentions, nook-parity, imessage-sync, study-plan, trip-collab); after each landing
re-run `pnpm gate`: the corresponding steps turn from NOT_BUILT into PASS or FAIL with no edit. Nothing in the harness
edits another branch's files; a gap shows up as a FAIL naming the owner's missing piece.

## 2. How to run

```
pnpm gate                 fixture run: fake Canvas, fake Google, scripted iMessage, fake model labelled Demo
pnpm gate:live            same, but real Gemini when GET /v1/status says the key has credit (LIVE=1)
pnpm gate:report          regenerate docs/qa/RELEASE-GATE-REPORT.md/.json from the last run's results
pnpm gate:smoke           safe real-account path (section 7); default stage is a no-network preflight
pnpm gate:down            stop a stack left running by GATE_KEEP=1
GATE_TRACE=1 pnpm gate    print every assertion as it is recorded
pnpm gate -- --grep S3    any playwright arguments
```

| Variable | Default | Effect |
|---|---|---|
| `LIVE=1` | off | real Gemini for the 3 agents the budget allows; otherwise the fake with a visible Demo label asserted in the UI |
| `GATE_BUDGET_USD` | `1` | ceiling per run; the guard assumes a conservative per-call cost and 3 live agents at most |
| `GATE_REAL=1` | off | evaluates real-variant prerequisites and lets `gate:smoke` run beyond preflight |
| `GATE_STRICT=1` | off | exit `3` when anything is NOT_BUILT, BLOCKED or not run |
| `GATE_REUSE=1` | off | use an already running gate stack (also skips teardown); `GATE_KEEP=1` keeps the stack after the run |
| `GATE_HUB_PORT`, `GATE_WEB_PORT`, `GATE_AGENT_BASE`, `GATE_CANVAS_PORT`, `GATE_GOOGLE_PORT`, `GATE_CTL_PORT` | 8927, 5327, 4771, 8940, 8941, 8942 | the gate's own ports; fake servers live in 8940-8949 |

The gate never touches the e2e stack (8851 / 5251 / 4151) or anybody else's ports, and its setup refuses to start if one of
its own ports is busy.

### Teardown is PID scoped

`e2e/gate/lib/stack.ts` records the process group of every process it starts in `e2e/gate/.tmp/stack.pids` and signals
exactly those. It never kills by port or by name pattern. A hub restart (variant V7) and an agent going offline (S8, V9)
stop and start exactly the recorded PID.

### Findings the gate reported and how they were resolved

The first full run (17 of 22 fixture steps) found these real differences between the plan and what was on main. All five
are fixed on `fix/gate-findings`; the rows stay as the record of what the gate caught and the decision taken:

| Step | Finding | Resolution |
|---|---|---|
| S2 | the Connections page showed raw squad ids in "Shared with" | names come from the roster (`GET /v1/squads`), never ids; the no-raw-ids scan covers the page |
| S7 | an iMessage-origin message had no "via iMessage" tag and no delivery label in the web chat | `SyncBadge` is mounted in the bubble; the chat client consumes `chat.sync` and updates the state live; failed sends offer Retry (`POST /v1/imessage/messages/:id/retry`) |
| V1 | asking `@cubbie` before anything is connected answered "Not in the materials. Ask the TA." | course/Canvas/Drive questions with no readable source answer "Nothing is connected yet: connect Canvas or Google in Connections" with a link; the exact refusal stays for questions outside the materials when sources exist |
| V3 | a grant revoked at Google makes the hub delete all imported data | kept on purpose (privacy first, a documented difference from Nook): state `revoked`, "Google access was revoked. Imported data was removed. Reconnect to import again." and a Reconnect button. The gate and the plan now assert this |
| V4 | a 401 on sync ended the connection `revoked`; a refused refresh after a short-lived token stayed `live` | a 401 refreshes once and retries; `invalid_grant` is `revoked` (V3), any other refusal is `expired` with the data kept, sync stopped, retrieval flagged stale and a Reconnect prompt; the hub no longer stretches a short-lived token to an hour |

Notes on behaviour the harness adapted to: `@planner plan a trip to <place>` / `@planner ... trip ...` starts the trip flow and
`@planner study plan ...` starts the study-plan flow (the same flows `@cubbie` starts); other `@planner` messages and the
other persona aliases answer as the persona only. The demo model cannot ground a content answer, so citation assertions on persona answers run with
`LIVE=1`; the fixture run asserts citations at the retrieval and source-viewer API instead. The live council
(`feature/council-integration`) is not on main: when it lands, S5 gains its assertions (probe `P.council`).

## 3. Structure

```
e2e/gate/
  gate.spec.ts            the journey S1..S10 in one world (fixture + real variant per step)
  variants.spec.ts        V1..V12, each in a fresh world
  report.ts               writes docs/qa/RELEASE-GATE-REPORT.md and .json (scrubbed)
  run.mjs                 pnpm gate entry: playwright, then the report; exit code policy
  playwright.config.ts    own ports, serial, global setup/teardown
  stack-down.mjs          pnpm gate:down: stops a stack left by GATE_KEEP=1 (exact PIDs)
  steps/
    s01-s03.ts            connect, ingest, retrieve with citations
    s04-s07.ts            iMessage tag, routing, reply delivery, web mirror
    s08-s10.ts            trip plan, study plan, cross-surface sync
    conflicts.ts          reusable fragments for conflicting edits and agent-offline
    variants.ts           V1..V5 and the V1..V12 registry
    variants-im.ts        V6..V12
    flows.ts              reusable journey fragments (connect, sync, ask, bind a group)
  lib/
    types.ts runner.ts    the typed step runner (StepDef, runStep, StepResult)
    asserts.ts            assertion collector (ids, ordering, leaks, raw ids, mode badge, screenshots)
    probes.ts             "is the feature on main" probes -> NOT_BUILT(owner)
    blockers.ts           external blockers -> BLOCKED(reason, runbook); names only, never values
    contract.ts           the connector contract and env the stack gives the hub
    live.ts               LIVE switch and the budget guard
    gate-hub.ts           the hub entrypoint with a scripted iMessage transport and a loopback control server
    stack.ts              own stack start/stop, hub restart, agent stop/start (exact PIDs)
    world.ts hub.ts       a fresh world per run, API and browser helpers
    fakes/                fake Canvas, fake Google, scenario transport, control clients
  real/
    smoke.ts guard.ts     the safe real-account path and its rails
```

Per step the runner writes `e2e/gate/.tmp/results/<id>.<mode>.json` (git-ignored); the report reads them.

## 4. Fixtures

* **Fake Canvas** (`:8940`): the REST subset the hub's real Canvas connector reads (and a calendar feed). The gate hub (`lib/gate-hub.ts`) redirects `https://canvas.fixture.invalid` to it with a fetch seam, so the real connector code runs; it serves, with original synthetic course
  content (a statistics course: three assignments, two events, one course file). Controls: `mode` (`ok`, `404`, `410`,
  `moved`, `big`), token validity, request log, reset.
* **Fake Google** (`:8941`): reached through the same seam (the Google hosts map to `/__h/<host>/...`, a fake OAuth client switches the hub to its live Google code): OAuth authorize and consent page, token and revoke endpoints, Calendar free/busy-style events,
  Drive/Docs export for picked files only, Classroom courses. Controls: `revoke` (next refresh returns `invalid_grant`),
  `expire`, `ttl`, `fail-refresh n`, `over-grant` (grants more than asked, to prove the hub refuses it), `pick`, request log.
* **Scripted iMessage** (`:8942`, control server of the gate hub): `ScenarioTransport` extends the `FakeIMessageTransport`
  of `feature/imessage-sync` and adds a persisted chat.db copy (a gap survives a hub restart), stable GUIDs and
  timestamps, duplicates, out-of-order delivery, an offline gap followed by backfill, delayed delivery, `failNext(n)`,
  receipts, and a virtual clock for the retry ladder. A world has squad A (Rhea, Ben, Cy; group thread A) and optionally
  squad B (Dan, plus Cy; group thread B). A spare allowlisted-but-unbound chat and a non-allowlisted chat exist for the
  "ignored" checks. No Apple, no real message is read or sent.
* **Live agent switch** (`lib/live.ts`): real Gemini only when `LIVE=1` and the hub's own probe says the key has credit,
  with at most 3 live agents and a ~1 USD ceiling; otherwise the fake model, whose answers carry `demo: true` and a visible
  **Demo** label that S5 and S7 assert on in the web DOM. The key reaches the hub only through its intended runtime
  interface (its environment, read from `.env`); the harness never prints it.

## 5. What every step asserts

Ids and ordering (unique ids, strictly increasing `seq`, the shared thread order of message time then sequence, web DOM
equal to the hub thread), attribution (member names, persona ids, never raw handles), delivery state (`queued`, `sent`,
`delivered`, `failed`, `web_only`, `dry_run`, with labels in words), citations present **and verified** (each citation
resolves to a stored source and the quote is present verbatim), privacy sentinels (`$180`, `therapy`, a private calendar
title, an unpicked Drive file, a Canvas grade, refresh token, feed secret never appear on any surface they must not reach),
no raw ids in any text a person reads (student, squad, chat and message ids, GUIDs, phone numbers), and honest mode
badges (Demo shown exactly when the model is the stand-in).

## 6. Variants

| Variant | What it proves |
|---|---|
| V1 fresh setup | an empty account sees optional, skippable connect offers; asking before connecting says nothing is connected; no error toast |
| V2 reconnect | disconnect then reconnect: derived data is purged, a new sync recreates the same ids and content hashes; chat history untouched |
| V3 revoked auth | Google revokes the grant: state `revoked`, imported data purged on purpose (privacy first), "Google access was revoked. Imported data was removed. Reconnect to import again." and a Reconnect button |
| V4 expired token | access token expires mid-sync: one refresh and retry, no user-visible failure; refresh refused with `invalid_grant` falls to V3, any other refusal is `expired` with data kept, sync stopped, retrieval flagged stale |
| V5 Canvas feed gone | 404/410/moved: degraded with the last good items and a last-synced time, never a silent empty |
| V6 duplicate events | the same GUID x3, a replayed OAuth callback, a replayed sync: one message, one reply, one connection, one outbound |
| V7 offline/backfill | watcher dropped, messages arrive in chat.db, hub restart: both appear once, in message-time order, flagged late, one reply |
| V8 outbound failure | `failNext(2)` retries then sends; `failNext(many)` ends `failed(reason)` visible on the web bubble, never "sent", bounded attempts, Retry works |
| V9 conflicting edits | same trip field / same plan item at once: loser gets 409 with both versions, other fields merge, votes never conflict, outcome in chat on both surfaces |
| V10 multiple threads | two squads, two groups, a 1:1: each group routes only to its squad; retrieval id sets are disjoint; a squad you did not opt into contributes nothing |
| V11 degraded model | forced fallback: replies carry the Demo label; steps report `PASS (fixture/degraded)` and the real step `BLOCKED(llm_credits)` |
| V12 wrong person | an unlinked handle and a non-member tag `@cubbie` in a bound group: prompt only, nothing posted to the web |

## 7. Smoke path (safe real accounts)

`pnpm gate:smoke` is for **your own** Google account, Canvas calendar and iMessage chat. It never messages a third party,
never reads the real Messages database except in the documented flagged stages, and takes credentials only through the hub's
own runtime and OAuth interfaces. Stages are strictly ordered and each needs the previous one green.

| Stage | Command | What happens |
|---|---|---|
| 0 preflight (default) | `pnpm gate:smoke` | no network, nothing started. Lists which prerequisites are present (names only) and which runbook fixes each missing one. |
| 1 dry run | `GATE_REAL=1 pnpm gate:smoke -- --stage dry-run --confirm-reads-allowlisted-chat` | starts the real hub on the gate ports with `IMESSAGE_ENABLED=1 IMESSAGE_DRY_RUN=1`, allowlist of exactly one chat and your own handle. Real Canvas/Google read-only fetches, real Gemini. Would-be outbound text is written to `e2e/gate/.tmp-real/outbox-review.txt` for you to read. Nothing is sent. |
| 2 allowlisted send | `GATE_REAL=1 GATE_DRY_RUN=0 GATE_APPLE_VERIFIED=1 pnpm gate:smoke -- --stage send --confirm-send` | same, without dry run; only into the one allowlisted chat that contains only you and consenting people. |
| 3 revoke | `pnpm gate:smoke -- --stage revoke` | revokes at Google, deletes the Canvas connection and asserts tokens and derived items are gone (also runs at the end of stages 1 and 2 unless `--keep`). |

Rails, all fail-closed:

1. **Dry run first.** Sending requires `GATE_DRY_RUN=0`, `GATE_APPLE_VERIFIED=1` (you recorded a passing dry run) and `--confirm-send`.
2. **Allowlist.** `GATE_ALLOWED_CHAT` must be exactly one chat guid and `GATE_OWN_HANDLE` your own number or Apple ID.
   `IMESSAGE_ALLOW_ALL` is refused. Anything else is never read or written.
3. **Kill switch.** `touch .gate-kill` in the repo root, or `IMESSAGE_ENABLED=0`, is checked before every send and every
   500 ms; the smoke script stops the hub it started (exact PID). More than `GATE_MAX_OUTBOUND` (default 10) outbound
   aborts the run.
4. **Own accounts only.** The Google account email must equal `GATE_OWN_GOOGLE_EMAIL` (otherwise the grant is revoked and
   the run aborts); the Canvas feed host must equal `GATE_OWN_CANVAS_HOST`. Reports redact with `***`; `.env` values are
   never logged.
5. **Revocation.** The run ends by revoking and asserting the purge.

Evidence from real runs goes into the report's real column and (for Apple) into `docs/imessage.md` section 8.8 by you.

## 8. External blockers and runbooks

These cannot be solved in code. The harness reports them as `BLOCKED(reason, runbook)` and lists them in every report.

### Google OAuth client and consent screen

Blocker code `no_google_client`. Google requires you to register the client:

1. Google Cloud Console: create a project and enable the Calendar API and the Drive API (plus Classroom if you want courses).
2. OAuth consent screen: External, publishing status Testing; add **your own** Google account as a test user.
3. Scopes: the hub asks for the minimal set only (`calendar.readonly` for free/busy, `drive.file` for picked files; see
   `docs/context-store.md`). Restricted scopes need Google's verification for anyone outside the test users.
4. Create an OAuth 2.0 Web client; authorized redirect URI `<HUB_PUBLIC_URL>/oauth/google/callback`
   (locally `http://localhost:8927/oauth/google/callback` for the gate hub).
5. Put `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_REDIRECT_URI` in your **local** `.env`
   (never commit it), and `GATE_OWN_GOOGLE_EMAIL` for the own-account guard. Until then the hub runs its labelled
   simulator, which is a fixture.

### Canvas session or feed

Blocker code `no_canvas_session_or_feed`. Real Canvas needs **your signed-in Canvas session through the extension** OR
**an `.ics` calendar-feed URL**. A student API token is **optional** (only some institutions allow it) and is never the
blocker.

Route A, the extension (Nook-style, signed-in browser; no institution approval and no admin):
1. `pnpm --filter @squad/extension build`, then `chrome://extensions`, Developer mode, Load unpacked, `apps/extension/dist`
   (source in `apps/extension`; set `SQUAD_WEB_ORIGIN` at build time to the web app origin you serve).
2. Sign in to your school's Canvas in the same Chrome profile.
3. In Squad, Connections, "Connect Canvas": pair the extension. Until it is installed and paired the page honestly says
   "Extension not detected".
4. Set `GATE_CANVAS_SESSION_VERIFIED=1` once the extension has synced your own Canvas.

Route B, the calendar feed: Canvas, Calendar, "Calendar Feed" gives your secret `.ics` URL. Set `GATE_CANVAS_FEED_URL` and
`GATE_OWN_CANVAS_HOST` (only the host is ever compared or shown). The URL is a secret: it is encrypted at rest by the hub
and shown only as host plus last four characters.

Optional: if your school allows it, Account, Settings, "New Access Token" gives a token for the REST path
(`GATE_CANVAS_TOKEN`). Missing token never blocks anything.

### Apple behaviour and permissions

Blocker code `apple_unverified`. The real transport (imessage-kit on macOS) needs Full Disk Access for the terminal that
runs the hub, Automation permission for Messages, Messages signed in, and the Mac awake. Chat id shapes are not verified
on this macOS. Steps: grant the permissions, run `docs/imessage.md` section 8.8 stage 1 (dry run), read the transcript,
then run stage 2 on one allowlisted chat and set `GATE_APPLE_VERIFIED=1`. Until a manual allowlisted run records a pass the
real iMessage column stays blocked; only the fake transport can produce `PASS (fixture)`.

### Real multi-person iMessage group

Blocker code `needs_second_person`. Apple has no API to create a group or list its members, and other participants must
consent. Create the group by hand with consenting friends (or a second Apple ID you own), add only its chat guid to the
allowlist and set `GATE_REAL_GROUP_HAS_OTHERS=1`. Without it V10 and V12 stay fixture-only and a single-person self-group
runs a reduced check.

### Gemini credits, Live and ElevenLabs plan

Blocker codes `llm_credits`, `elevenlabs_plan`. The hub probes the providers and says so in `GET /v1/status`. Gemini: top up
the key's billing and restart is not needed (the hub re-probes every 60 s); Gemini Live additionally needs billing enabled
on the project. ElevenLabs reports `paid_plan_required` on a free plan: voice (calls, podcast) stays off until the plan
allows API voices. Fixtures use the fake model and are labelled Demo.

## 9. Privacy of the harness itself

No secret, token, private message content or run artifact is committed: results, logs, screenshots and the real-run outbox
live in git-ignored paths. The report and the JSON are scrubbed of every sentinel and provider value before they are
written; only the report and a few `key-*.png` screenshots (`docs/design/shots/gate/`) are committed. Assertion details
name the surface and the check, never the surrounding text.
