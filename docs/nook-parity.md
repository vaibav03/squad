# Nook parity: Canvas and Google Workspace in Squad

Status: living document for workstream `feature/nook-parity` (based on `feature/context-store`).
Mandatory requirement: Canvas and Google Workspace are integrated like the working Nook integration, not as a
generic connector design. This file maps what Nook actually does (read from the Nook clean-room clone, the dev
extension and the screenshots), how Squad adapts it, the parity checklist the tests assert, the deliberate
differences, and what is BLOCKED on real accounts.

No secret was read or copied. The Nook sources inspected are code and docs only; `.env` files, tokens, cookies and
keys were not opened. The dev extension manifest embeds a public key; it is not reproduced here or in Squad.

## 1. Where Nook lives (verified)

| Artefact | Path |
|---|---|
| Nook clone (app) | `/Users/vaibav/Documents/projects/devhacks/cubbie-re/app` (`apps/web`, `apps/mock`, `apps/extension`, `packages/contracts`, `packages/api-client`) |
| Nook docs | `cubbie-re/docs/04-canvas-real.md` (real Canvas through the extension), `docs/03-messaging-integration.md`, `app/ARCHITECTURE.md`, `app/PARITY.md`, `app/parity/*.json` |
| Client map of the original | `cubbie-re/CLIENT-MAP.md`, `spec/ui/routes_cubbie-canvas.md`, `routes_cubbie-gmail.md`, `routes_connect-provider.md` |
| Packaged dev extension | `~/Downloads/nook-extension/` (`background.js`, `content.js`, `options.html`, `options.js`, `manifest.json`, `icon/`; also the zip) |
| Screenshots | `~/Desktop/nook-screenshots/` (`*-connect-canvas.png`, `*-workspace.png`, `*-connect-imessage.png`, ...) |
| `cubbie-skill.md`, `cubbie-hackathon-kit`, `devhacks/docs` | contain no Canvas or Google integration material |

Important honest finding: the Nook "working integration" is a **clone built against a mock server** (`apps/mock`,
in memory, restart means re-authorize). Its Canvas path is real (extension reads a live Canvas with the student's
own browser session); its Google path is real when OAuth credentials are configured and a simulator otherwise. Nook
has **no scheduled sync, no cursors, no backfill, no lecture text extraction, no rate-limit state and no citations**:
it answers "what's due?" / "send me the slides" from synced metadata. Where Squad needs more (cursors, states,
citations, lecture text) it is added on top of Nook's shapes and listed under deliberate differences.

## 2. Map of Nook's behaviour

### 2.1 Canvas: auth (no OAuth, no developer key, no API token)

Nook reads Canvas with the **student's own logged-in browser session cookies**, through a Chrome MV3 extension
(`cubbie-re/app/apps/extension/src/canvas.ts`, `background.ts`, `protocol.ts`).

* `canvas.ts` `createCanvasClient`: every request is `fetch(url, { credentials: "include", headers: { Accept:
  "application/json+canvas-string-ids, application/json" } })` from the service worker with host permission.
* Canvas prefixes cookie-auth JSON with `while(1);`: `parseCanvasJson` strips `^\s*while\s*\(1\)\s*;?`.
* `probe(origin)`: `GET <origin>/api/v1/users/self`; 200 means signed in, yields `{ origin, canvasUserId, name,
  primary_email }`; any failure means `null` (not signed in, not Canvas, network).
* Origins: only exact `https://` origins (`isExactHttpsOrigin`, `protocol.ts`); a content script on
  `https://*.instructure.com/*` reports the origin (`canvas-seen.ts`); an options-page "extra Canvas origin" covers
  schools on their own domain; an optional allow-list (`allowedOrigins`) can restrict. Links are never followed
  off-origin (`pages()` checks `new URL(next, origin).origin === origin`).

### 2.2 Canvas: bridge between the web page and the extension

* Content script (`content.ts`) marks the page `data-<ns>-extension="1"`, announces `<ns>:extension-ready`
  (CustomEvent and `window.postMessage`), and relays `<ns>:bridge-request` window messages (validated by
  `relay.ts isBridgeRequest`: same window, same origin, `requestId` string, message type prefixed with the
  namespace) to the service worker, answering with `<ns>:bridge-response`.
* Message types (`wire.ts`): `ping`, `extension-ready`, `bridge-request`, `bridge-response`, `canvas-status`,
  `canvas-authorize`, `canvas-open-sign-in`. `externally_connectable` is limited to the web origin.
* `canvas-status` reply: `{ ok, accounts[{origin, canvasUserId, name, primary_email}], cubbieUserId, sync, signInUrl }`.
* `canvas-authorize` `{ canvasUserId, origin, userId }` error codes (`protocol.ts`): `canvas_origin_not_allowed`,
  `canvas_session_changed`, `cubbie_not_signed_in`, `cubbie_account_mismatch`, `canvas_registration_failed`,
  `canvas_account_already_bound` (+ `ownerEmail`), `canvas_account_conflict`. On success the extension binds the
  account, starts a sync and reports `sync = { phase: "syncing"|"idle", progress, lastOutcome, lastFinishedAt }`.
* Extension auth to the Nook API (`auth.ts`): phone-code sign-in on the options page, a short-lived JWT plus a
  refresh token held in `chrome.storage.local`; `getToken()` refreshes when `exp - now < 15s`; a 401 on refresh
  clears the session (honest "not signed in"); sign-out ends the session server side.

### 2.3 Canvas: ingestion, normalization, storage

`canvas.ts collect()` (runs in the extension, on authorize):

* `GET /api/v1/courses?enrollment_state=active&per_page=50`
* per course in parallel: `/courses/:id/assignments?bucket=upcoming&per_page=50` and `/courses/:id/files?per_page=100`
* `Link: rel="next"` followed up to `MAX_PAGES = 3`, same origin only; ids normalized to strings; names default to
  `""`, `"(untitled)"`, `"file"`; 401/403/404 on files (Files tab disabled) means "no files" for that course.
* Payload `{ origin, canvas_user_id, courses[{id,name,course_code}], assignments[{id,course_id,name,due_at,html_url}],
  files[{id,course_id,display_name,content-type,size,url,updated_at}] }`.
* Hub endpoint (`apps/mock/src/routes/canvas.ts`): `POST /v1/app-api/canvas-accounts/:id/sync` (auth, owner check,
  zod; 404 not yours, 422 invalid, 409 `canvas_session_mismatch` when origin or user id differ from the bound
  account). Stored in memory per account. Reads: `GET /v1/app-api/canvas/courses`, `/assignments` (sorted by
  `due_at`, nulls last), `/files?type=ppt|pdf` (`canvasFileMatchesType`). Accounts: `GET .../canvas-accounts/me
  ?include_disconnected`, `POST .../:id/reconnect`, `DELETE .../:id` (soft disconnect, reactivatable).
* Account rules (`store/canvas.ts registerCanvasAccount`): same (origin, canvas user) active for someone else
  gives `canvas_account_already_bound`; a different active Canvas login for the same user on the same origin gives
  `canvas_account_conflict`; same login same user is reactivated.
* Q&A (`bridge/canvas-answers.ts`): "due / deadlines / assignments" lists next 5 with course and `fmtDue`
  (UTC, "(past)" marker, assignments up to 24h overdue still shown); "slides / ppt / pdf / files" lists latest 5 with
  link; honest empty states ("I haven't synced your Canvas yet", "No slides found in your synced Canvas files.",
  "Nothing due. You're all caught up.").
* UI: `/connect/canvas` (status via the bridge, authorize), `/workspace` card "N courses, M upcoming, K files synced".

### 2.4 Google Workspace

`apps/mock/src/bridge/google-workspace.ts`, `routes/integrations.ts`, `store/integrations.ts`:

* Web OAuth with PKCE: `GET /v1/app-api/integrations/:provider/connect` (auth, `provider` in `google|gmail`,
  `return_to` must be a same-site relative path) returns `{ authorization_url }`. Pending state kept server side
  (`OAuthStateRecord`: state, user, return_to, add_account, account hint, PKCE verifier, 30 min TTL, single use).
* Authorization URL: `access_type=offline`, `prompt=consent select_account`, `include_granted_scopes=true`,
  `code_challenge_method=S256`, `login_hint`. Client id, secret and redirect URI come from config; with none
  configured the same endpoint points at a **simulator** consent page under `/__sim/integrations/oauth/*` and the
  simulated consent redirects back with `?provider=&status=connected|error[&message=<b64url>]`.
* Callback `GET /oauth/google/callback`: state check (invalid/expired/consumed gives 400 `oauth_state_invalid`),
  code exchange (`oauth2.googleapis.com/token`, 15 s timeout), identity from `openidconnect.googleapis.com/v1/userinfo`,
  upsert the email account (`active`, scopes from the token response), redirect to the web app with
  `status=connected` or `status=error&message=google_connection_failed`; logs carry only a 180 character error head.
* Scopes requested by Nook: openid, email, profile, `gmail.modify`, `drive` (full), `documents`, `spreadsheets`,
  `presentations`, `calendar` (full), `tasks`, `contacts.readonly`. Broad by design (an assistant that edits).
* Token storage (`GoogleTokenRecord`): access token, refresh token (kept from the prior grant if Google omits it),
  `expiresAt = now + expires_in`; in-memory only in the mock.
* Refresh (`googleAccessToken`): if `expiresAt > now + 60 s` use it; no refresh token gives `google_reauth_required`;
  refresh failure gives `google_refresh_failed:<error>`; probe failure sets the account `needs_reauth`.
* Account status values: `active | needs_reauth | revoked`. Disconnect: `DELETE .../integrations/email/accounts/:id`
  deletes the account and its tokens (404 for foreign ids). `GET .../email/accounts` lists `{id, provider, email,
  status, scopes}`.
* Link tokens (chat-issued connect link): `POST .../:provider/connect/inspect|redeem` (no auth), errors
  `link_invalid` 404, `link_used` 409, `link_expired` 410, token consumed on redeem, 30 min TTL.
* `GET .../integrations/google/probe` runs lightweight live Gmail/Drive/Calendar/Tasks checks; no content returned.

### 2.5 Nook behaviours that do not exist (so cannot be "ported")

No sync cadence, cursor, backfill, retention, or rate-limit handling; no per-source permission model (data is owned by
the single user); no citation format; no lecture/PDF text; no Classroom; Google content is probed, not ingested. The
Nook extension's registered sync is on authorize only ("Re-authorize to refresh").

## 3. Squad adaptation plan

Principle: reuse Nook's auth shapes, endpoints, error codes, payload shapes, account rules and honest empty states
verbatim in meaning; keep Squad's existing context store (sources, chunks, citations, sharing) as the storage layer.

| Concern | Nook | Squad |
|---|---|---|
| Canvas auth | extension + session cookies, bridge, `canvas-authorize` | same: new `session` Canvas variant. Extension ported to `apps/extension` (namespace `squad`), hub bridge endpoints `POST /v1/connections/canvas/register`, `POST /v1/connections/:id/canvas-sync`. The feed (`.ics`) and API-token variants from the earlier branch stay as fallbacks |
| Canvas REST | `canvas.ts` client | shared pure client `packages/brain/src/context/connectors/canvas-rest.ts` (same endpoints, `while(1);` strip, rel=next, MAX_PAGES, 401/403/404 files rule). Used by the extension build and the hub live token connector |
| Normalization | `{courses, assignments, files}` payload | `normalizeCanvasPayload` to `canvas_assignment` / `canvas_file` sources with stable ids, chunks and `source://` anchors; file bodies are metadata chunks (title, course, type, size, link) because Nook never extracts text |
| Google | PKCE OAuth, state record, callback, token store, refresh, disconnect | `GET /v1/connections/google/authorize` returns `{ authorization_url }`; `GET /oauth/google/callback`; simulator consent route when no client is configured (labelled fixture); tokens in the existing AES-GCM `ctx_tokens`; refresh within 60 s of expiry; revoke calls Google's revoke endpoint and purges |
| Google scopes | broad | minimal read-only: `calendar.readonly`, `drive.file` (Picker), Classroom coursework.me.readonly and courses.readonly |
| Account rules | already_bound / conflict / reactivate | same codes at `register` |
| States | status + `needs_reauth`, sync phase | `state`: `live | fixture | expired | revoked | rate_limited | error` on every connection view; sync phase `idle|syncing` plus cursor and `lastOutcome` |
| Sync | on authorize | on connect and manual, plus cursor/backfill pass (Canvas `updated_since` per course, Calendar `syncToken` / `updatedMin`, window of 120 days back and 180 forward), tick before listing, `store.purgeExpired` |
| Q and A | `canvas-answers.ts` | the same answers (due list, slides list, empty states) generated from the store for the viewer, plus grounded citations for questions |
| Agents | none | `Brain.ask(viewer)`, council `retrieve` tool, `@cubbie` chat, trip constraints, study-plan seeds, all through the privacy gates |

Wiring targets and gates:

* `Brain.ask`: the chat doubt path now passes `{ viewer }` (resolved from the account and verified squad membership).
* Council agents: the `retrieve(query, courseId?)` contract in `docs/context-store.md` is bound to one viewer.
* `@cubbie` group chat: answers use only the asker's own sources plus sources explicitly shared with that squad.
* Trips: only derived busy blocks (start, end) and due items cross into trip planning; no event titles are stored.
  `hub_busy_blocks.title` is no longer written (a constant `busy` placeholder column remains for schema
  compatibility; existing rows are blanked by a migration). The setup copy is corrected.
* Study plans: due dates and lecture topics seed plan items via a pure function `deriveStudySeeds(viewer)`; the
  `feature/study-plan` contract (hub shared study plan) is consumed through that function when it lands.

## 4. Parity checklist (asserted by tests)

Tests live in `packages/brain/src/context/parity/nook-parity.test.ts` (REST client, normalized sources, states, cursors,
OAuth, Google ingestion), `apps/hub/src/routes/nook-parity.test.ts` (pairing, register, sync, reads, privacy, Google OAuth
through the hub, sentinel scan of responses, logs and every table), `apps/hub/src/context/secret-scan.test.ts`
(credential-shaped strings in tracked files), `apps/extension/test/*` (bridge protocol) and
`packages/web/src/pages/connections/connections.test.tsx` (honest labels). Fixtures are synthetic and shaped like the real
APIs: the fake Canvas and fake Google servers are `packages/brain/src/context/parity/fake-servers.ts` (exported as
`@squad/brain/fake-servers`). Nook's own tests were ported where they exist (`apps/extension/test`: canvas, protocol, relay,
wire; the Nook mock-server route tests have no equivalent in Squad because Squad's hub implements the same routes).

| # | Observable Nook behaviour | Test |
|---|---|---|
| P1 | `parseCanvasJson` strips `while(1);` | canvas-rest |
| P2 | Pagination follows `Link rel=next` up to 3 pages and never leaves the origin | canvas-rest |
| P3 | Files 401/403/404 yields no files, not a failure | canvas-rest |
| P4 | `collect` payload shape equals Nook's for the same fake Canvas | canvas-rest |
| P5 | ids become strings; defaults `(untitled)`, `file`, `""` | canvas-rest |
| P6 | probe returns null on non-200 and on failure | canvas-rest |
| P7 | origin must be an exact https origin; error `canvas_origin_not_allowed` | hub bridge |
| P8 | register: already_bound (+owner hint), conflict, reactivation | hub bridge |
| P9 | sync 404 not yours / 422 invalid / 409 `canvas_session_mismatch` | hub bridge |
| P10 | assignments sorted by `due_at` nulls last; `type=ppt|pdf` filter; invalid type 422 | hub bridge |
| P11 | answers: due list, slides list, "not synced", "No slides found", "Nothing due" | `packages/brain/src/context/wiring.test.ts`, `skills/canvas/canvas.test.ts` |
| P12 | disconnect is soft and reconnect works; purge deletes derived data | hub bridge |
| P13 | Google authorize URL: PKCE S256, offline, consent, state, minimal scopes, login_hint | google |
| P14 | callback: invalid/consumed/expired state gives `oauth_state_invalid`; denial redirects with `status=error` | google |
| P15 | token exchange success stores encrypted token, upserts one account | google |
| P16 | refresh within 60 s; no refresh token gives reauth; failure gives `expired` | google |
| P17 | disconnect removes tokens and derived data; foreign id 404 | google |
| P18 | `return_to` must be relative | google |
| P19 | states `live|fixture|expired|revoked|rate_limited|error` on every view | states |
| P20 | no token, feed URL or cookie in any response or log (sentinel scan) | secret-scan |
| P21 | another student never reads your private sources | isolation |
| P22 | `Brain.ask` cites Canvas and Drive sources; fabricated quote struck | brain |
| P23 | extension bridge protocol messages and error codes | apps/extension |

## 5. Deliberate differences

1. Squad is multi-student. Every source is private to its owner; sharing is per squad, explicit, per source, and
   calendar events are never bulk-shared. Nook has one owner per account and no sharing.
2. Per-squad opt-in and the Nook "bound to exactly one user" rule: the same Canvas login may be connected by one
   Squad account at a time (`canvas_account_already_bound`), as in Nook; it never exposes the other owner's data.
3. No analytics or telemetry in Squad (Nook's original had a telemetry layer that the clone stripped; Squad has
   none), and no phone-code sign-in on the extension: the extension signs in with a short-lived pairing code issued by
   an authenticated Squad web session (`POST /v1/connections/extension/pair`), which is exchanged for a scoped,
   revocable bearer token usable only for Canvas registration and sync.
4. Minimal read-only Google scopes instead of Nook's broad set (no Gmail, no Drive-wide, no writes).
5. Squad adds cursors, backfill windows, retention (default 180 days), and a `rate_limited` state with `retryAfter`;
   Nook has none of these.
6. Squad cites: verified-quote citations (`source://kind/id#anchor`) for every non-PDF source; Nook has none.
7. Canvas file text is not extracted (same as Nook); files are metadata sources that can be cited by title and link.
8. Event titles are not stored for planning: trip planning receives derived busy intervals only.
9. A fixture/simulator mode is labelled in the UI ("Demo data, not a real account"); Nook's simulator is unlabelled.
10. Nook keeps state in memory; Squad persists in the hub database with encrypted tokens.
11. `DELETE` on a Canvas connection purges the imported data and revokes (Nook soft-disconnects and keeps rows so the
    account can be reactivated). Re-registering the same login afterwards creates a fresh connection.
12. A refused registration never names the other owner (Nook returns `ownerEmail` with `canvas_account_already_bound`).
13. The token route's full pass lists all assignments (`bucket=all`); the extension route keeps Nook's `bucket=upcoming`.
    Squad does not store course names as sources, so there is no `/canvas/courses` read; course names ride inside each
    source's text.
14. Canvas expiry is reported by the extension (`canvas-report`) as honest state instead of a silent empty sync.
15. Squad has no `/__sim` mock server: the simulator is a labelled consent page inside the hub, only active while no
    Google client is configured.

## 6. BLOCKED items and runbooks

| Blocked | Why | Runbook |
|---|---|---|
| Google OAuth client registration | needs the owner's Google Cloud project | Create an OAuth 2.0 Web client; authorized redirect URI `<HUB_PUBLIC_URL>/oauth/google/callback`; consent screen with the copy in `docs/context-store.md` / the connect UI; add test users; set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` in the hub `.env` (placeholders only in `.env.example`); sensitive scopes (`calendar.readonly`, `drive.file`, Classroom) need Google verification for general use (privacy policy URL, scope justification, demo video). Until set the hub runs the labelled simulator. |
| Google Picker | needs a browser API key and an app id | create a browser key restricted to the web origin; set `VITE_GOOGLE_PICKER_API_KEY`; the web connect UI passes `pickedFileIds` |
| Canvas institution access | a real Canvas session needs a real student account; API tokens may be disabled by the institution | extension path needs no institution approval: sign in to Canvas in Chrome, load the extension, open Squad settings, Connect Canvas. Token variant: student generates a token in Canvas Settings if allowed |
| Extension install | unpacked install needs the user's browser; Chrome Web Store needs a developer account, listing review and a fee | `pnpm --filter @squad/extension build`, then `chrome://extensions`, Developer mode, Load unpacked, `apps/extension/dist`. Store submission is BLOCKED (no account); fill the listing from `apps/extension/README.md` |
| Real accounts end to end | no real Canvas/Google account is available to the workstream | run the live checklist in `apps/extension/README.md` and the Google runbook above |
| File text extraction (pdf/pptx/docx) | needs a parsing dependency and real binaries | out of scope, same as Nook; metadata only |
| Secrets provisioning | `CONTEXT_TOKEN_KEY` rotation and `EXTENSION_PAIR_SECRET` | set in the deployment environment |

## 7. What was ported and verified

Ported from Nook (behaviour and shapes, no secrets): the Canvas session-cookie REST client (`canvas-rest.ts`, also in
`apps/extension/src/canvas.ts`), the extension bridge and its message types and error codes (`apps/extension`, namespace
`squad`), the register and sync routes with Nook's status codes (`/v1/connections/canvas/register`,
`/v1/connections/:id/canvas-sync`), Nook's account rules, the Google OAuth start, state record, PKCE, callback, refresh
and revoke (`/v1/connections/google/authorize`, `/oauth/google/callback`), the simulator fallback, Nook's file-type
filter and "what's due / send me the slides" answers. Added on top: sync state machine (cursor, backfill, daily full pass,
`rate_limited`), citations over every source kind, privacy gates and per-squad sharing, encrypted tokens, honest states in
the API and the connections UI (`/squad/connections`), derived busy blocks without titles, wiring into `Brain.ask`, live
council grounding, `@cubbie` chat, trip constraints and study seeds (see `docs/nook-parity-wiring.md`).

Verification (`pnpm check`, exit status 0, on `feature/nook-parity`): brain parity 21 tests, hub parity 13, secret scan 2,
extension 21, connections UI 20, plus the existing context-store suites (19 brain, 11 hub). The only network used by any
test is the in-process fake servers. No real Canvas or Google account, token or cookie was used, read or stored. Not done:
a real-account end-to-end run (BLOCKED, see section 6) and a browser smoke of the connections page against a running hub.
