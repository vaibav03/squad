# Release gate report

Generated 2026-10-25T13:02:48.550Z by `pnpm gate` (tree feature/release-gate@1f6d310c, origin/main@7b09a9c6).
Mode: LLM fake model, labelled **Demo**; real integrations not requested.

## Verdict: RED (a BUILT step failed)

Fixture steps: 5 PASS, 4 FAIL, 0 NOT_BUILT, 13 not run, of 22. A NOT_BUILT step is never a PASS: its owner branch is not on origin/main.

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
| S8 | Conversation continues into a collaborative trip plan | FAIL: hub chat carries the trip card text | SKIPPED(real_not_requested) | `docs/design/shots/gate/s8-01-trip-voting.png`<br>`docs/design/shots/gate/s8-02-trip-cutscene.png`<br>`docs/design/shots/gate/s8-03-trip-agent-offline.png` |
| S9 | ... and a shared study plan | FAIL: a plan card reached the group | SKIPPED(real_not_requested) |  |
| S10 |  | NOT_RUN | NOT_RUN |  |

## Variants

| Variant | What | Fixture | Real | Evidence |
|---|---|---|---|---|
| V1 |  | NOT_RUN | NOT_RUN |  |
| V2 |  | NOT_RUN | NOT_RUN |  |
| V3 |  | NOT_RUN | NOT_RUN |  |
| V4 |  | NOT_RUN | NOT_RUN |  |
| V5 |  | NOT_RUN | NOT_RUN |  |
| V6 |  | NOT_RUN | NOT_RUN |  |
| V7 |  | NOT_RUN | NOT_RUN |  |
| V8 |  | NOT_RUN | NOT_RUN |  |
| V9 |  | NOT_RUN | NOT_RUN |  |
| V10 |  | NOT_RUN | NOT_RUN |  |
| V11 |  | NOT_RUN | NOT_RUN |  |
| V12 |  | NOT_RUN | NOT_RUN |  |

## Failures

### S2 (fixture) Ingest and normalize permitted context

- no raw squad or student ids on the Connections page after sharing: found: squad id

### S7 (fixture) Web chat shows the complete ordered conversation (and mirrors back)

- iMessage-origin message carries a "via iMessage" tag

### S8 (fixture) Conversation continues into a collaborative trip plan

- hub chat carries the trip card text
- card links to the trip page
- at least two live options: 1 live
- Rhea's vote is announced in the group (no ranking)
- Ben's vote is announced in the group (no ranking)
- Ben's ranking is not in Rhea's trip payload
- Cy's vote is announced in the group (no ranking)
- Ben's ranking never appears in Rhea's browser payloads
- Rhea (API) confirmation is announced
- Ben (iMessage "confirm") confirmation is announced
- Cy (API) confirmation is announced
- "Trip confirmed" is said exactly once: expected 1, got 0
- hub chat posts the offline notice

### S9 (fixture) ... and a shared study plan

- a plan card reached the group: bot said: nothing


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

- S3 (fixture): demo model: the context-claims prompt is not served by the demo LLM, so a context-grounded chat answer cannot be produced without LIVE=1; retrieval and the viewer are asserted above
- S5 (fixture): @tutor: the demo model cannot ground a content answer; citations are asserted with LIVE=1
- S5 (fixture): @planner: the demo model cannot ground a content answer; citations are asserted with LIVE=1

## Key screenshots

- `docs/design/shots/gate/key-s3-01-citation-excerpt.png`
- `docs/design/shots/gate/key-s6-01-delivery-state.png`
- `docs/design/shots/gate/key-s7-01-web-mirror-rhea.png`
- `docs/design/shots/gate/key-s8-01-trip-voting.png`

How to run and read this: [RELEASE-GATE.md](RELEASE-GATE.md).
