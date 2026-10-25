# Release gate report

Generated 2026-10-25T13:15:11.298Z by `pnpm gate` (tree feature/release-gate@c7a11eef, origin/main@2835a43d).
Mode: LLM fake model, labelled **Demo**; real integrations not requested.

## Verdict: RED (a BUILT step failed)

Fixture steps: 14 PASS, 8 FAIL, 0 NOT_BUILT, 0 not run, of 22. A NOT_BUILT step is never a PASS: its owner branch is not on origin/main.

## Journey (one world, one chain)

| Step | What | Fixture | Real | Evidence |
|---|---|---|---|---|
| S1 | Connect Canvas and Google Workspace with minimal permissions | PASS (fixture (real hub connectors against HTTP fakes; no real Google or Canvas account)) | BLOCKED(no_google_client, [runbook](RELEASE-GATE.md#google-oauth-client-and-consent-screen)) | `docs/design/shots/gate/s1-01-connections.png` |
| S2 | Ingest and normalize permitted context | FAIL: no raw squad or student ids on the Connections page after sharing | BLOCKED(no_google_client, [runbook](RELEASE-GATE.md#google-oauth-client-and-consent-screen)) | `docs/design/shots/gate/s2-01-connections-shared.png` |
| S3 | Agents retrieve permitted context with verified citations | PASS (fixture (retrieval and source viewer asserted at the API; chat answers use the demo model unless LIVE=1)) | SKIPPED(real_not_requested) | `docs/design/shots/gate/s3-01-citation-excerpt.png`<br>`docs/design/shots/gate/s3-02-cubbie-answers.png` |
| S4 | Group iMessage tagging @cubbie / @cubbi | PASS (fixture) | BLOCKED(apple_unverified, [runbook](RELEASE-GATE.md#apple-behaviour-and-permissions)) |  |
| S5 | Route to the correct live agent with the same grounded context | PASS (fixture) | BLOCKED(llm_credits, [runbook](RELEASE-GATE.md#gemini-credits-live-and-elevenlabs-plan)) |  |
| S6 | Reply delivered into the same iMessage group | PASS (fixture) | BLOCKED(apple_unverified, [runbook](RELEASE-GATE.md#apple-behaviour-and-permissions)) | `docs/design/shots/gate/s6-01-delivery-state.png` |
| S7 | Web chat shows the complete ordered conversation (and mirrors back) | FAIL: iMessage-origin message carries a "via iMessage" tag | SKIPPED(real_not_requested) | `docs/design/shots/gate/s7-01-web-mirror-rhea.png`<br>`docs/design/shots/gate/s7-02-web-mirror-ben.png` |
| S8 | Conversation continues into a collaborative trip plan | PASS (fixture (demo labelled)) | SKIPPED(real_not_requested) | `docs/design/shots/gate/s8-01-trip-voting.png`<br>`docs/design/shots/gate/s8-02-trip-cutscene.png`<br>`docs/design/shots/gate/s8-03-trip-agent-offline.png` |
| S9 | ... and a shared study plan | FAIL: iMessage lists Rhea's 2 items | SKIPPED(real_not_requested) | `docs/design/shots/gate/s9-01-plan-proposed.png` |
| S10 | Decisions, updates, failures and agent activity stay synchronized in web and iMessage | FAIL: no raw ids in web thread | SKIPPED(real_not_requested) |  |

## Variants

| Variant | What | Fixture | Real | Evidence |
|---|---|---|---|---|
| V1 | Fresh setup: connecting is optional and asking before connecting is honest | FAIL: and says nothing is connected and offers a way to connect | SKIPPED(real_not_requested) | `docs/design/shots/gate/v1-01-fresh-connections.png` |
| V2 | Reconnect: purge on disconnect, same ids on reconnect, chat untouched | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V3 | Revoked auth: needs reconnect, data marked not deleted, the other source keeps working | FAIL: the label says to reconnect in words | SKIPPED(real_not_requested) |  |
| V4 | Expired access token: transparent refresh; refresh failure falls to V3 | FAIL: a refused refresh ends needing reconnect | SKIPPED(real_not_requested) |  |
| V5 | Canvas upstream gone: degraded with the last good items, never a silent empty | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V6 | Duplicate events | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V7 | Offline gap, backfill and hub restart | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V8 | Outbound failure and retry | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V9 | Conflicting edits (trip field, plan chapter) and an agent going offline | FAIL: iMessage summary lists the item under the picked owner | SKIPPED(real_not_requested) | `docs/design/shots/gate/v9-01-trip-agent-offline.png` |
| V10 | Multiple group threads | PASS (fixture) | SKIPPED(real_not_requested) |  |
| V11 | Degraded model is labelled Demo everywhere | PASS (fixture/degraded) | BLOCKED(llm_credits, [runbook](RELEASE-GATE.md#gemini-credits-live-and-elevenlabs-plan)) |  |
| V12 | Wrong person tags @cubbie | PASS (fixture) | BLOCKED(needs_second_person, [runbook](RELEASE-GATE.md#real-multi-person-imessage-group)) |  |

## Failures

### S10 (fixture) Decisions, updates, failures and agent activity stay synchronized in web and iMessage

- no raw ids in web thread: found: phone number

### S2 (fixture) Ingest and normalize permitted context

- no raw squad or student ids on the Connections page after sharing: found: squad id

### S7 (fixture) Web chat shows the complete ordered conversation (and mirrors back)

- iMessage-origin message carries a "via iMessage" tag

### S9 (fixture) ... and a shared study plan

- iMessage lists Rhea's 2 items: expected 2, got 0
- iMessage lists Ben's 1 items: expected 1, got 0
- iMessage lists Cy's 2 items: expected 2, got 0

### V1 (fixture) Fresh setup: connecting is optional and asking before connecting is honest

- and says nothing is connected and offers a way to connect: reply does not mention connecting

### V3 (fixture) Revoked auth: needs reconnect, data marked not deleted, the other source keeps working

- the label says to reconnect in words
- Google-derived items are kept (stale), not deleted

### V4 (fixture) Expired access token: transparent refresh; refresh failure falls to V3

- a refused refresh ends needing reconnect: state live
- a 401 on sync triggers one refresh and a retry (no user-visible failure): sync 200, state revoked, refresh calls 0

### V9 (fixture) Conflicting edits (trip field, plan chapter) and an agent going offline

- iMessage summary lists the item under the picked owner:  / want ch12 (Oct 26)
- and under nobody else: expected 0, got 1


## External blockers (code cannot fix these)

| Blocker | Now | Why | Runbook |
|---|---|---|---|
| `no_google_client` | BLOCKED | GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set: the Google OAuth client and consent screen are not registered. | [runbook](RELEASE-GATE.md#google-oauth-client-and-consent-screen) |
| `no_own_google_account` | BLOCKED | GATE_OWN_GOOGLE_EMAIL is not set: real runs only ever use the user's own Google account. | [runbook](RELEASE-GATE.md#google-oauth-client-and-consent-screen) |
| `no_canvas_feed` | BLOCKED | GATE_CANVAS_FEED_URL / GATE_OWN_CANVAS_HOST are not set: no Canvas calendar feed of the user's own to read. | [runbook](RELEASE-GATE.md#canvas-institution-token-or-feed) |
| `token_disabled_or_missing` | BLOCKED | No Canvas personal access token (many institutions disable student tokens). | [runbook](RELEASE-GATE.md#canvas-institution-token-or-feed) |
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
- V3 (fixture): after revoke: state=revoked label=Disconnected: imported data deleted status=revoked degraded=false note=Disconnected. All imported data was deleted.
- V9 (fixture): same option, different field with a stale baseRev answered 409 (docs say merge, code checks per option)
- V9 (fixture): fewer than two members pending: the simultaneous-accept check was skipped

## Key screenshots

- `docs/design/shots/gate/key-s3-01-citation-excerpt.png`
- `docs/design/shots/gate/key-s6-01-delivery-state.png`
- `docs/design/shots/gate/key-s7-01-web-mirror-rhea.png`
- `docs/design/shots/gate/key-s8-01-trip-voting.png`
- `docs/design/shots/gate/key-s9-01-plan-proposed.png`

How to run and read this: [RELEASE-GATE.md](RELEASE-GATE.md).
