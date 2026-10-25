# Release gate: one end-to-end journey

Companion to `docs/plans/E2E-PRODUCT-REVIEW.md`. The gate is **one continuous journey**, not independent demos. A single run owns one fixture world (one squad, one group thread, one conversation) and every later step depends on the earlier ones.

Verdict vocabulary, used by the harness and in every report: `PASS`, `FAIL`, `BLOCKED(reason)`, `SKIPPED(by flag)`. A fixture pass is reported as `PASS (fixture)`. A step whose real integration cannot run is `BLOCKED`, never `PASS`, and the overall gate result is `FIXTURE-GREEN / REAL-BLOCKED` until every real step passes. The harness never converts a dry-run or a disabled integration into success.

## 1. The journey

```
S1 connect Canvas + Google (minimal scopes)
S2 ingest + normalize permitted context
S3 agents retrieve it, answers carry verified citations
S4 group iMessage message tagging @cubbie
S5 route to the correct LIVE agent with the same grounded context
S6 reply delivered into the same iMessage group
S7 web chat shows the complete ordered conversation (and web replies mirror back)
S8 conversation continues into a collaborative trip plan
S9 ... and a shared study plan
S10 decisions, updates, failures, agent activity stay synchronized in web and iMessage
```

### Versions of each step

Notation: **FX** = fixture version (fake Canvas server + fake Google server + `FakeIMessageTransport` + `FakeLive`/`FakeLlm`, or real Gemini when credits allow). **RL** = real-integration version. Fixtures live in `e2e/lib/fakes/` (new, workstream I): `fake-canvas` (HTTP: `/feed.ics`, optional `/api/v1/...`), `fake-google` (OAuth authorize/token/revoke, freebusy, Drive files export, Picker stub), `FakeIMessageTransport` extended with `dropWatcher()`, `duplicate(guid)`, `outOfOrder()`, `delay(ms)`, `failNext(n)`, receipts.

| Step | FX | RL (only where credentials exist) | Assertions |
|---|---|---|---|
| S1 connect | web "Connections": paste fake Canvas feed URL; click Google, fake consent page grants `calendar.freebusy` + `drive.file`; Picker stub picks 1 file | Google: user's own account, OAuth client in Testing mode; Canvas: user's own calendar feed URL (or token if their school allows) | scopes granted equal exactly the allowed set (no more); `hub_connections` row exists, refresh token encrypted (not equal to plaintext, not returned by any API, absent from every HTTP response and SSE event and web storage); Canvas URL never returned after save (only host + last 4); `/v1/status` shows `canvas: live`, `google: live` |
| S2 ingest | worker syncs fixtures: 3 assignments, 2 events, 1 Drive file, 5 busy blocks | same with real data | normalized `ContextItem`s have stable ids and `contentHash`; re-sync is idempotent (count unchanged); titles absent from `hub_busy_blocks`; grades/submissions absent; item caps enforced; items default `visibility=private`; per-squad opt-in off -> squad retrieval returns zero |
| S3 retrieve | opt in per squad; ask via web `@cubbie when is the stats homework due?` | real Gemini if credits allow | answer text contains a `[canvas:...]` citation; `verifyClaims` passes (quote present in stored item); citation chip opens source viewer with the external URL; an unsupported question returns `NOT_IN_MATERIALS`, never an invented citation; privacy sentinel (private Drive file not picked, calendar title) never appears |
| S4 iMessage tag | `FakeIMessageTransport.group('chat;+;g1', fromRhea, 'hey @cubbie what is due this week?')` after `join <code>` binding | dry-run first (`IMESSAGE_DRY_RUN=1`: parse, route, build reply, send nothing, print what would be sent); then the user's own allowlisted chat | parser recognises `@cubbie`/`@squad`/aliases (table in review doc section 2.3); message gets a hub id and an xref row with the GUID; mention in a non-bound chat is ignored; mention from an unlinked handle gets the link prompt only; allowlist miss -> `chat_not_allowed` and nothing posted |
| S5 route | bot router picks the skill/agent; `@tutor` routes to the tutor expert, `@planner` to study/trip skills | real Gemini + Live where credits allow | the reply is produced by the persona addressed; the same retrieval call (`retrieve(viewer, squad, query)`) returns the same item ids as in S3 (assert id sets equal); status says `live` only if the LLM probe is `gemini`, else the reply carries `demo:true` and the web/iMessage text says so |
| S6 reply into group | transport records outbound to the same `chat_guid`, split <= 900 chars x 5 | allowlisted real group, dry-run diff reviewed first | exactly one outbound per reply; same chat guid; xref `direction=out`, status `sent`; no leak of sentinels; failure (`failNext`) -> persisted `failed` + retry then labelled state on the web bubble |
| S7 web mirror | open web chat as Rhea and Ben | real web | complete ordered thread: ids unique, `seq` strictly increasing, iMessage-origin messages attributed to the right member (via handle hash -> account) with a "via iMessage" tag, bot replies attributed to the persona; no duplicates after duplicate GUID delivery; web reply typed by Ben appears in the group only if "Also post to iMessage group" chosen, prefixed `Ben (via Squad):`; otherwise stays web-only and the bubble says so |
| S8 trip | `@planner plan a trip Dec 12-15` -> Trip object created, three members vote, confirm | real Gemini for wording; mesh stays real | trip id stable and shown in both surfaces as a card with a link; per-member state chips; votes private (assert Ben's ranking not in Rhea's payloads); `trip.confirmed` once; cutscene deep link works; an agent stopped mid-way shows `agent offline` on web and a notice in iMessage, trip stays `open`, never `confirmed` |
| S9 study plan | `@planner study plan for the midterm` using Canvas due date for exam | same | Plan object persisted with `rev`; chapters have owners; acceptances tracked; page and iMessage summary agree; countdown matches Canvas due date; mastery numbers hidden if < 3 members |
| S10 sync | assert end state from three vantage points: hub DB, web DOM, FakeIMessageTransport log | same via allowlisted chat + web | every decision (vote, confirm, accept, swap) appears in both surfaces with one canonical id; a failure appears in both; agent activity (typing/thinking/offline) visible in web and as a text notice in iMessage |

## 2. Variants (each runs the whole chain unless noted)

| Variant | Setup | Required result |
|---|---|---|
| V1 fresh setup | empty DB, new user, no connections | onboarding offers Connect Canvas/Google as optional, skippable; retrieval before connect says "No Canvas connected" and offers a link; no error toasts |
| V2 reconnect | disconnect then reconnect Google and Canvas | items older than revoke are gone; new sync recreates ids deterministically (same `contentHash`); xref and chat history untouched |
| V3 revoked auth | fake Google revokes grant (`invalid_grant`) between S2 and S3 | connection state `revoked`, Google-derived items **purged** (privacy first; a deliberate difference from Nook, see `docs/nook-parity.md`), the UI and API say "Google access was revoked. Imported data was removed. Reconnect to import again." with a Reconnect button; the other source keeps answering |
| V4 expired token | access token expiry mid-sync; refresh succeeds | transparent refresh, one retry, no user-visible failure; a refused refresh -> `revoked` (V3) when the provider says the grant is revoked (`invalid_grant`), otherwise `expired` with the data kept, sync stopped, retrieval flagged stale and a Reconnect prompt; never `live` |
| V5 Canvas feed gone | feed 404/410/changed host | `canvas: degraded(feed_unreachable)`, last good items kept with "last synced" time, no silent empty |
| V6 duplicate events | `duplicate(guid)` x3, replayed OAuth callback, replayed poll | one hub message, one reply, one connection row, no double nudges |
| V7 offline/backfill | `dropWatcher()` for 60 s while two messages arrive in chat.db, plus hub restart | after reconnect both appear once, in `origin_ts` order, tagged "received late", reply sent once; raw handle map rebuilt on next contact and nudges say "waiting for your next text" until then |
| V8 outbound failure | `failNext(2)`, then `failNext(5)` | retry then `failed(reason)` visible on the web bubble; never shown as delivered; no infinite retries |
| V9 conflicting edits | Rhea and Ben edit the same plan chapter owner / same trip field at once | rule: optimistic concurrency with `rev`; different fields merge; same field -> loser gets 409 with "Keep theirs / Replace with mine"; both outcomes logged in chat on both surfaces; votes never conflict (per-user rows); assert final state identical on web and iMessage summary |
| V10 multiple threads | two squads, three iMessage chats (squad A group, squad B group, a 1:1) | each group routes to its bound squad only; retrieval for squad A never returns squad B items (assert id sets disjoint); 1:1 with ambiguous squad asks "Which squad?"; a user opted into squad A but not B contributes nothing to B |
| V11 degraded LLM | force 402 | replies carry the demo label; gate marks steps `PASS (fixture/degraded)` and the real step `BLOCKED(llm_credits)` |
| V12 wrong person | a non-member or unlinked handle tags `@cubbie` in a bound group | ignored or link-prompt only; nothing posted to web |

## 3. Privacy sentinels

Seeded unique strings, asserted absent from every surface they must not reach: a private calendar title (`SENTINEL_CAL_TITLE`), a non-picked Drive file name, a Canvas grade, Ben's budget and hard-no topic, raw phone numbers, refresh token and feed URL. Sweep targets: all HTTP responses and SSE frames, the web DOM and storage, the outbound iMessage log, hub and agent logs, `/v1/status`, the exported account data (except the user's own, per `routes/auth.ts:301`).

## 4. Real-integration smoke path (safe)

Order is strict; each stage requires the previous to be green and is opt-in by explicit flags.

1. **Dry-run (default)**: `GATE_REAL=1 GATE_DRY_RUN=1`. Real Google/Canvas read-only fetches with the user's own credentials and real Gemini; iMessage in dry-run (`IMESSAGE_DRY_RUN=1`): the gateway parses and routes, writes the would-be outbound text to a file, sends nothing. Reviewer reads the diff.
2. **Allowlist send**: `IMESSAGE_ALLOWED_CHATS=<one chat guid>` and `IMESSAGE_ALLOWED_HANDLES=<own handle>`; chat is a group the user created that contains only themselves and consenting people. Fail-closed on any miss.
3. **Kill switch**: `IMESSAGE_ENABLED=0` or a `touch .gate-kill` file checked before every send; the harness also aborts all sends if more than N (default 10) outbound in a run.
4. **Own accounts only**: refuse to run if the Google account email is not equal to `GATE_OWN_GOOGLE_EMAIL`; Canvas host must equal `GATE_OWN_CANVAS_HOST`. Never use someone else's feed URL; never read `.env` values into logs; reports redact with `***`.
5. **Revocation test**: after the run the harness revokes at Google (revoke endpoint), deletes the Canvas URL, and asserts items and tokens are gone.

## 5. External blockers (cannot be solved in code) and how they report

| Blocker | Why code cannot fix it | Harness behaviour | Runbook |
|---|---|---|---|
| Google OAuth client + consent screen | client id/secret must be created in Google Cloud Console; consent screen in Testing mode needs the user as a test user; restricted scopes (`drive.readonly`) need verification | RL steps S1-S3 Google part -> `BLOCKED(no_google_client)` when `GOOGLE_CLIENT_ID/SECRET` unset; fixtures still run | 1. Create project, 2. enable Calendar + Drive APIs, 3. consent screen (External, Testing), add own email as test user, 4. scopes `calendar.freebusy`, `drive.file`, 5. redirect URI `http://localhost:<hub>/v1/connect/google/callback`, 6. set env vars locally (never commit) |
| Canvas institution token | many schools disable student access tokens; LTI/dev keys need an admin | feed URL path works without admin; token path -> `BLOCKED(token_disabled_or_missing)` | Canvas > Calendar > Calendar Feed gives the secret `.ics` URL; or Account > Settings > New Access Token if allowed |
| Apple behaviour/permissions | imessage-kit on macOS 27, Full Disk Access, Automation permission, Mac awake and signed in; chat id shapes unverified | RL iMessage -> `BLOCKED(apple_unverified)` until a manual allowlisted run records a pass; `PASS (fixture)` only for fake transport | grant Full Disk Access to the terminal, sign in to Messages, run dry-run, then allowlist one chat; paste the transcript path into `docs/imessage.md` section 7 as the evidence |
| Real multi-person iMessage group | Apple offers no API to create groups or list members, and other participants must consent | multi-participant steps (V10, V12) -> `BLOCKED(needs_second_person)`; the single-person self group still runs a reduced check | user creates the group by hand with consenting friends or a second Apple ID they own, then adds the chat guid to the allowlist |
| Gemini credits / ElevenLabs plan | provider-side | probe via `/v1/status`; `BLOCKED(llm_credits)` for LIVE steps, fixtures use FakeLlm and are labelled `demo` | top up at the provider, restart not needed (hub re-probes every 60 s) |

Report format, one line per step: `S5 route | FX PASS | RL BLOCKED(apple_unverified) | evidence: <path>`. The final summary lists all BLOCKED items with their runbook link and is written to `e2e/report/` plus mirrored into `docs/qa/`. A run with any `FAIL` exits non-zero; a run with only `BLOCKED` exits with code 3 (distinct from success) so CI cannot mistake it for green.

## 6. Mapping to the existing harness

Existing e2e (`e2e/`, hub 8851 / web 5251 / agents 4151-4154, `pnpm e2e`, `E2E_REUSE=1`, `LIVE=1`) already covers sign-in, group chat citations (j02), DM privacy (j03), quiz (j04), council (j05), trip and study scheduling (j08-squad-flows, j10-trip), accounts (j12), resilience (j13), status (j14), security (j15). The gate adds:

- `e2e/specs/j26-release-gate.spec.ts`: serial, one world, steps S1-S10 as `test.step`s; variants V1-V12 as parameterised re-runs of the relevant step ranges with a fresh world.
- `e2e/lib/fakes/{fake-canvas,fake-google}.ts` started by `e2e/lib/stack.ts` on `E2E_*` ports; `FakeIMessageTransport` fault injection.
- A `gateStep()` helper in `e2e/lib/helpers.ts` that records `FX/RL/BLOCKED` and refuses to record `PASS` for RL when a precondition probe fails.
- Feature specs per workstream in the review doc (`j20`-`j25`) run before the gate; the gate runs last in CI nightly and on demand.

## 7. Acceptance for declaring the gate met

1. `j26` fixture run `PASS` for S1-S10 and V1-V12 on default stack, twice in a row, with no sentinel in any sweep target.
2. Real Gemini steps pass when credits exist, otherwise labelled `BLOCKED(llm_credits)` honestly.
3. Real Google/Canvas dry-run reviewed by the user, then one own-account run `PASS`.
4. iMessage: dry-run reviewed, then one allowlisted own-chat run `PASS` with transcript evidence; multi-person step either passed with consenting participants or recorded `BLOCKED(needs_second_person)` and listed in the release notes.
5. Web and iMessage final states are identical for every decision, with failures visible on both.
