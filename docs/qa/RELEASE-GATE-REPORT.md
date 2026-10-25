# Release gate report

Generated 2026-10-25T12:42:31.743Z by `pnpm gate` (tree feature/release-gate@80b8674b, origin/main@d646013a).
Mode: LLM fake model, labelled **Demo**; real integrations not requested.

## Verdict: RED (a BUILT step failed)

Fixture steps: 0 PASS, 2 FAIL, 1 NOT_BUILT, 19 not run, of 22. A NOT_BUILT step is never a PASS: its owner branch is not on origin/main.

## Journey (one world, one chain)

| Step | What | Fixture | Real | Evidence |
|---|---|---|---|---|
| S1 |  | NOT_RUN | NOT_RUN |  |
| S2 |  | NOT_RUN | NOT_RUN |  |
| S3 |  | NOT_RUN | NOT_RUN |  |
| S4 |  | NOT_RUN | NOT_RUN |  |
| S5 |  | NOT_RUN | NOT_RUN |  |
| S6 |  | NOT_RUN | NOT_RUN |  |
| S7 |  | NOT_RUN | NOT_RUN |  |
| S8 |  | NOT_RUN | NOT_RUN |  |
| S9 | ... and a shared study plan | FAIL: a plan card reached the group | SKIPPED(real_not_requested) |  |
| S10 | Decisions, updates, failures and agent activity stay synchronized in web and iMessage | NOT_BUILT(feature/trip-collab, feature/w5-council-board) | NOT_BUILT(feature/trip-collab, feature/w5-council-board) |  |

## Variants

| Variant | What | Fixture | Real | Evidence |
|---|---|---|---|---|
| V1 |  | NOT_RUN | NOT_RUN |  |
| V2 |  | NOT_RUN | NOT_RUN |  |
| V3 |  | NOT_RUN | NOT_RUN |  |
| V4 | Expired access token: transparent refresh; refresh failure falls to V3 | FAIL: the hub refreshed the token (a refresh call reached the token endpoint) | SKIPPED(real_not_requested) |  |
| V5 |  | NOT_RUN | NOT_RUN |  |
| V6 |  | NOT_RUN | NOT_RUN |  |
| V7 |  | NOT_RUN | NOT_RUN |  |
| V8 |  | NOT_RUN | NOT_RUN |  |
| V9 |  | NOT_RUN | NOT_RUN |  |
| V10 |  | NOT_RUN | NOT_RUN |  |
| V11 |  | NOT_RUN | NOT_RUN |  |
| V12 |  | NOT_RUN | NOT_RUN |  |

## Failures

### S9 (fixture) ... and a shared study plan

- a plan card reached the group: bot said: nothing

### V4 (fixture) Expired access token: transparent refresh; refresh failure falls to V3

- the hub refreshed the token (a refresh call reached the token endpoint)
- and the connection is still live, no user-visible failure: expected "live", got "revoked"


## Not built yet (owner branch not on origin/main)

| Owner branch | On origin | Landed on this tree |
|---|---|---|
| `feature/trip-collab` | no | no |
| `feature/w5-council-board` | yes | no |

Steps waiting, with what is missing:

- S10 Decisions, updates, failures and agent activity stay synchronized in web and iMessage: `feature/trip-collab`, `feature/w5-council-board` (Trip object, per-member state, rev + 409 conflicts, confirm once; agent activity (typing, thinking, offline) surfaced on the board)

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

- V4 (fixture): after refused refresh: state=revoked label=Disconnected: imported data deleted

How to run and read this: [RELEASE-GATE.md](RELEASE-GATE.md).
