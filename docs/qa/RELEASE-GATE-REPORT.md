# Release gate report

Generated 2026-10-25T13:33:15.594Z by `pnpm gate` (tree fix/gate-findings@d86d6a86, origin/main@29bb0842).
Mode: LLM fake model, labelled **Demo**; real integrations not requested.

## Verdict: FIXTURE-GREEN / REAL-BLOCKED

Fixture steps: 22 PASS, 0 FAIL, 0 NOT_BUILT, 0 not run, of 22. A NOT_BUILT step is never a PASS: its owner branch is not on origin/main.

## Journey (one world, one chain)

| Step | What | Fixture | Real | Evidence |
|---|---|---|---|---|
| S1 | Connect Canvas and Google Workspace with minimal permissions | PASS (fixture (real hub connectors against HTTP fakes; no real Google or Canvas account)) | BLOCKED(no_google_client, [runbook](RELEASE-GATE.md#google-oauth-client-and-consent-screen)) | `docs/design/shots/gate/s1-01-connections.png` |
| S2 | Ingest and normalize permitted context | PASS (fixture (real hub connectors against HTTP fakes; no real Google or Canvas account)) | BLOCKED(no_google_client, [runbook](RELEASE-GATE.md#google-oauth-client-and-consent-screen)) | `docs/design/shots/gate/s2-01-connections-shared.png` |
| S3 | Agents retrieve permitted context with verified citations | PASS (fixture (retrieval and source viewer asserted at the API; chat answers use the demo model unless LIVE=1)) | SKIPPED(real_not_requested) | `docs/design/shots/gate/s3-01-citation-excerpt.png`<br>`docs/design/shots/gate/s3-02-cubbie-answers.png` |
| S4 | Group iMessage tagging @cubbie / @cubbi | PASS (fixture) | BLOCKED(apple_unverified, [runbook](RELEASE-GATE.md#apple-behaviour-and-permissions)) |  |
| S5 | Route to the correct live agent with the same grounded context | PASS (fixture) | BLOCKED(llm_credits, [runbook](RELEASE-GATE.md#gemini-credits-live-and-elevenlabs-plan)) |  |
| S6 | Reply delivered into the same iMessage group | PASS (fixture) | BLOCKED(apple_unverified, [runbook](RELEASE-GATE.md#apple-behaviour-and-permissions)) | `docs/design/shots/gate/s6-01-delivery-state.png` |
| S7 | Web chat shows the complete ordered conversation (and mirrors back) | PASS (fixture) | SKIPPED(real_not_requested) | `docs/design/shots/gate/s7-01-web-mirror-rhea.png`<br>`docs/design/shots/gate/s7-02-web-mirror-ben.png` |
| S8 | Conversation continues into a collaborative trip plan | PASS (fixture (demo labelled)) | SKIPPED(real_not_requested) | `docs/design/shots/gate/s8-01-trip-voting.png`<br>`docs/design/shots/gate/s8-02-trip-cutscene.png`<br>`docs/design/shots/gate/s8-03-trip-agent-offline.png` |
| S9 | ... and a shared study plan | PASS (fixture (demo labelled)) | SKIPPED(real_not_requested) | `docs/design/shots/gate/s9-01-plan-proposed.png` |
| S10 | Decisions, updates, failures and agent activity stay synchronized in web and iMessage | PASS (fixture (demo labelled)) | SKIPPED(real_not_requested) |  |

## Variants

| Variant | What | Fixture | Real | Evidence |
|---|---|---|---|---|
| V1 | Fresh setup: connecting is optional and asking before connecting is honest | PASS (fixture) | SKIPPED(real_not_requested) | `docs/design/shots/gate/v1-01-fresh-connections.png` |
| V2 | Reconnect: purge on disconnect, same ids on reconnect, chat untouched | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V3 | Revoked auth: state revoked, imported data purged (deliberate, privacy first), honest reconnect message, the other source keeps working | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V4 | Expired access token: one refresh and retry; a refused refresh is revoked (provider says so) or expired with data kept, never live | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V5 | Canvas upstream gone: degraded with the last good items, never a silent empty | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V6 | Duplicate events | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V7 | Offline gap, backfill and hub restart | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V8 | Outbound failure and retry | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V9 | Conflicting edits (trip field, plan chapter) and an agent going offline | PASS (fixture) | SKIPPED(real_not_requested) | `docs/design/shots/gate/v9-01-trip-agent-offline.png` |
| V10 | Multiple group threads | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V11 | Degraded model is labelled Demo everywhere | PASS (fixture/degraded) | BLOCKED(llm_credits, [runbook](RELEASE-GATE.md#gemini-credits-live-and-elevenlabs-plan)) |  |
| V12 | Wrong person tags @cubbie | PASS (fixture) | BLOCKED(needs_second_person, [runbook](RELEASE-GATE.md#real-multi-person-imessage-group)) |  |

## External blockers (code cannot fix these)

| Blocker | Now | Why | Runbook |
|---|---|---|---|
| `no_google_client` | BLOCKED | GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set: the Google OAuth client and consent screen are not registered. | [runbook](RELEASE-GATE.md#google-oauth-client-and-consent-screen) |
| `no_own_google_account` | BLOCKED | GATE_OWN_GOOGLE_EMAIL is not set: real runs only ever use the user's own Google account. | [runbook](RELEASE-GATE.md#google-oauth-client-and-consent-screen) |
| `no_canvas_session_or_feed` | BLOCKED | No Canvas route of your own is set up: real Canvas needs your signed-in Canvas SESSION via the extension (install the unpacked extension from apps/extension, sign in to Canvas, GATE_CANVAS_SESSION_VERIFIED=1) OR an .ics calendar-feed URL (GATE_CANVAS_FEED_URL + GATE_OWN_CANVAS_HOST). A student API token is optional and never the blocker. | [runbook](RELEASE-GATE.md#canvas-session-or-feed) |
| `apple_unverified` | BLOCKED | imessage-kit on this macOS has no recorded passing allowlisted run (Full Disk Access, Automation, Messages signed in). | [runbook](RELEASE-GATE.md#apple-behaviour-and-permissions) |
| `needs_second_person` | BLOCKED | A real multi-participant group needs other consenting people; Apple has no API to create groups. | [runbook](RELEASE-GATE.md#real-multi-person-imessage-group) |
| `llm_credits` | BLOCKED | GET /v1/status says the model is the demo stand-in (no key, rejected key, or depleted Gemini credits). | [runbook](RELEASE-GATE.md#gemini-credits-live-and-elevenlabs-plan) |
| `elevenlabs_plan` | BLOCKED | ElevenLabs reports paid_plan_required (or no key): voice is unavailable on this plan. | [runbook](RELEASE-GATE.md#gemini-credits-live-and-elevenlabs-plan) |

## Notes

- S10 (fixture): live typing/thinking is transient with the scripted model; only "not stuck" is asserted
- S3 (fixture): demo model: the context-claims prompt is not served by the demo LLM, so a context-grounded chat answer cannot be produced without LIVE=1; retrieval and the viewer are asserted above
- S5 (fixture): @tutor: the demo model cannot ground a content answer; citations are asserted with LIVE=1
- S5 (fixture): @planner: the demo model cannot ground a content answer; citations are asserted with LIVE=1
- S9 (fixture): mastery hidden for squads under 3 members is not exercised: the world squad has 3 members
- V10 (fixture): 1:1 squad disambiguation ("Which squad?") is not part of feature/imessage-sync today (docs/imessage.md); a DM stays private to Cubbie.
- V11 (fixture): iMessage text has no literal "Demo" marker (only the web label); recorded, not asserted
- V3 (fixture): after revoke: state=revoked label=Google access was revoked. Imported data was removed. Reconnect to import again. status=revoked degraded=false
- V9 (fixture): same option, different field with a stale baseRev answered 409 (docs say merge, code checks per option)
- V9 (fixture): fewer than two members pending: the simultaneous-accept check was skipped

## Key screenshots

- `docs/design/shots/gate/key-s3-01-citation-excerpt.png`
- `docs/design/shots/gate/key-s6-01-delivery-state.png`
- `docs/design/shots/gate/key-s7-01-web-mirror-rhea.png`
- `docs/design/shots/gate/key-s8-01-trip-voting.png`
- `docs/design/shots/gate/key-s9-01-plan-proposed.png`

How to run and read this: [RELEASE-GATE.md](RELEASE-GATE.md).
