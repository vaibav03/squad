# Sendblue iMessage transport

Squad's iMessage layer (`docs/imessage.md`) has a second provider: **Sendblue**, the hosted iMessage API that the Nook
clone also uses. It sits behind the same transport interface as the local Mac bridge, so the bridge, bindings, identity
map, sync queue, mirroring rules, delivery states, SyncBadge and every `IMESSAGE_*` safety flag work unchanged.
Google OAuth is a separate piece of work (feature/integration-journey); the Sendblue health probes appear on its
Integration Health page (`GET /v1/connections/health`) and also at `GET /v1/imessage/health`.

## 1. Nook map (what the existing implementation does)

Read from `cubbie-re/app/apps/mock/src/bridge/sendblue.ts` (117 lines), `store/imessage.ts`, `sim/imessage.ts`, the
`voice-sendblue` test, and `cubbie-re/docs/03-messaging-integration.md`. Only code shape and env **names** were read.

| Topic | Nook |
| --- | --- |
| Send | `POST https://api.sendblue.co/api/send-message`, headers `sb-api-key-id` and `sb-api-secret-key`, body `{number, content, from_number, media_url?}`. 15 s timeout. |
| Groups | Not supported: a payload with `group_id` is ignored (`if (... p.group_id) return ignored`). Nook is 1:1 only. |
| Inbound | `POST /webhooks/sendblue?token=<SENDBLUE_WEBHOOK_TOKEN>`: the secret is a **query-string token**, compared with `!==` (not constant time), 403 on mismatch, 503 when unconfigured. No timestamp, no HMAC. |
| Dedupe | In-memory `Set` of `message_handle`, 2000 entries, cleared on restart. |
| Status callbacks | Ignored (`is_outbound` payloads return `{ignored:true}`). No delivery, read or failure tracking. |
| Attachments | Outbound `media_url` only (voice notes, ElevenLabs mp3 served from the app). Inbound media ignored. |
| Typing / read receipts | None. |
| Rate limits | None in the adapter (the docs only say "add rate limits to the webhook routes"). |
| Conversation mapping | A handle is the user: `handleInbound` matches a **live activation code** (`Link code K7QX2M` embedded in the greeting the user texts to the line), else the sign-in phone. Bound handles then reach the assistant. |
| Opt-in / phone linking | Text-a-code: the web page shows "text this message to the line"; the inbound text carries a 6-char code; a match creates a binding (`bound`), a mismatch waits as a `pending_claim`. |
| Env names | `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`, `SENDBLUE_NUMBER`, `SENDBLUE_WEBHOOK_TOKEN` (+ `PUBLIC_BASE_URL`, `VOICE_REPLIES`, `ELEVENLABS_API_KEY`). |

Squad improves on Nook where it matters: header secret compared in constant time (not a URL token that lands in logs),
groups, persisted dedupe, replay window, status callbacks, an allowlist that must exist before anything is sent.

## 2. Sendblue facts used (docs.sendblue.com, read 2026-10)

Sources: getting-started/webhooks, sending-messages, groups, receiving-messages, limits, api-v2/read-receipts.

* **Send**: `POST https://api.sendblue.com/api/send-message` `{number, from_number, content, media_url, status_callback, send_style}`.
  Group: `POST /api/send-group-message` with `group_id` (or the participant numbers to create one) and **`from_number` required**.
  Auth headers `sb-api-key-id`, `sb-api-secret-key`. Max 18,996 characters. `media_url` must end in the file extension and
  **does not support query-string signed URLs** (so Squad puts the signature in the path, section 6).
* **Webhooks** (types `receive`, `outbound`, `typing_indicator`, ...): configured in the dashboard (Developer, Webhooks) or
  `POST /api/account/webhooks` with `{url, secret}` or a `globalSecret`. HTTPS only. Retries up to 3 times on 5xx, 45 s timeout,
  `410 Gone` removes the webhook. Delivery is at least once: dedupe on `message_handle`.
* **Security scheme**: "When you configure a secret, Sendblue will include it in the webhook request headers." It is a **shared
  secret, not an HMAC**. The page does not name the header; the Chat SDK adapter docs make it configurable
  (`webhookSecretHeader`) and the task brief names `sb-signing-secret`. Squad defaults to `sb-signing-secret` and exposes
  `SENDBLUE_WEBHOOK_SECRET_HEADER`. Verify in your dashboard's delivery log which header your account sends.
* **Payload ids**: `message_handle` (message id, UUID-like), `group_id` (empty string for 1:1), `from_number`/`to_number`/`number`,
  `sendblue_number`, `participants[]`, `group_display_name`, `media_url`, `service` (iMessage/SMS/RCS), `reply_to`, `thread_originator`.
* **Statuses**: `REGISTERED, PENDING, DECLINED, QUEUED, ACCEPTED, SENT, DELIVERED, ERROR`. There is **no READ status** in the
  documented callback set. Error codes: 4000 validation, 4001 rate limit, 4002 blocked, 4007-4010 pre-reply limits, 5000, 5003,
  5509, 10001, 10002; `error_key` (e.g. `OPTED_OUT`) is the stable field.
* **Status callbacks**: per message via `status_callback` on the send request (no global default), or an `outbound` webhook.
* **Read receipts / typing**: `POST /api/mark-read` and typing-indicator endpoints exist (v2); inbound typing arrives on the
  `typing_indicator` webhook. Squad does not send typing or read receipts (see limitations).
* **Rate limits**: per line 10 messages/second; Blue Ocean 50 new contacts/day and 15/hour per line; AI Agent plans 1,000
  inbound contacts/day and 200 follow-ups/day; before a contact's first reply: 300 characters, no links/media, 6 messages.
  **Group messages are not subject to the pre-reply limits.**
* **Groups**: only on select plans; AI Agent plan numbers **cannot create groups, only reply in groups they were added to**
  (which is the only thing Squad does). Group rename, add/remove people exist; removal needs at least 4 members.

## 3. Signature scheme implemented

`POST /v1/webhooks/sendblue` (receive + outbound status) and `POST /v1/webhooks/sendblue/status` (per-message callback). Public,
rate limited (240/min/client), 256 KB cap. Order of checks, all before any side effect and all failing closed:

1. rate limit (429), `Content-Length` cap (413);
2. provider not running or `SENDBLUE_WEBHOOK_SECRET` unset: **503** (nothing is accepted without a configured secret);
3. the `sb-signing-secret` header must equal `SENDBLUE_WEBHOOK_SECRET`: both values are SHA-256 hashed then `timingSafeEqual`
   (constant time, length hidden); missing = **401** `missing_signature`, mismatch = **401** `bad_signature`;
4. the raw body is read (still cap-checked) and two **optional** layers are verified when the headers are present:
   `sb-body-signature: sha256=<hex HMAC-SHA256(secret, raw body)>` (for a signing proxy; Sendblue itself does not send it) and
   `sb-timestamp` (seconds, ms or ISO; outside `SENDBLUE_REPLAY_WINDOW_S`, default 24 h, is **401** `stale_timestamp`);
5. only now is the JSON parsed (400 on bad JSON or schema) and acted on.

Honest limit: a shared secret authenticates the sender, not the body. If TLS is terminated before the hub, anyone who holds
the secret can forge. Mitigations in place: replay protection, persistent dedupe, allowlists, schema validation, and the
optional body HMAC. Replay protection: an inbound whose `date_updated`/`date_sent` is outside the window is refused; the
message handle is claimed in the iMessage identity map (`imsg_xref`) so a redelivery is a no-op and is answered once;
status callbacks are deduped per `handle:status` in `sb_events` and are monotonic (`sb_status`).

## 4. Architecture

```
Sendblue --signed webhook--> /v1/webhooks/sendblue --verify--> SendblueSdk.deliverInbound
                                                        |         (IMessageSdkLike: the same interface as the Mac bridge)
                                                        v
                      gateway.safety (kill switch, allowlist, echo, flood, dedupe) -> bridge.handleInbound
                                                        |  join <code> / hashed phone -> account -> shared mention parser
                                                        v
                         deps.chat.send (the SAME web chat API) -> agent answer posted in the same thread
                                                        |
        sync queue (backoff, order) -> gateway.sendOne (allowlist + dry run + rate limit BEFORE any call) -> SendblueSdk.send
                                                        v
                  POST /api/send-message | /api/send-group-message  (the only network calls the hub makes)
Sendblue --status callback--> /v1/webhooks/sendblue/status --> SendblueSdk.receipt --> sync.syncOnReceipt --> chat.sync event
```

Code: `apps/hub/src/imessage/sendblue/` (`config`, `client`, `sdk`, `webhook`, `webhook-schema`, `runtime`, `store`, `media`,
`health`, `health-register`, `fake-sendblue` for tests). Selection in `imessage/wire.ts`:
`IMESSAGE_PROVIDER=sendblue|local|fake|off`. Unset: `local` when `IMESSAGE_ENABLED=1` (the old behaviour), otherwise off.
`fake` (and the older `IMESSAGE_FIXTURE=1`) runs the scripted transport and labels everything "Fixture transport (no real iMessage)".

**Id mapping**: chat guid for a Sendblue group is `Sendblue;+;<group_id>` (a 1:1 is `Sendblue;-;<number>` on the wire and
`dm:<handle hash>` as a thread key). Table `sb_id_map(kind, sb_id)` has a **primary key on (kind, sb_id)**, kinds `group`,
`thread`, `message`; upserts are idempotent (`ON CONFLICT ... COALESCE`, first mapping wins) and store the conversation
(`group:<squad>` / `dm:<user>`), the hub message id, the **handle hash and last 4 digits only**. Message dedupe itself lives in
`imsg_xref` (unchanged). Ordering and attribution are exactly docs/imessage.md section 8.2.

**Delivery states**: `queued -> sent -> delivered -> read | failed`. `sent` = Sendblue accepted the send and returned a
`message_handle`; `delivered` = `DELIVERED` callback; `read` is wired (a `READ` status) but Sendblue documents none; `failed` =
`ERROR`/`DECLINED` with the code (`Failed: Sendblue rate limit exceeded (4001)`), the web offers Retry. Out-of-order callbacks never
move a state backwards, delivered/read never turn into failed. A callback that beats our own bookkeeping is retried for 10 s.

## 5. Environment

| Name | Meaning |
| --- | --- |
| `IMESSAGE_PROVIDER` | `sendblue` to use this provider |
| `IMESSAGE_ENABLED` | kill switch, must be `1` |
| `IMESSAGE_ALLOWED_CHATS` | `Sendblue;+;<group_id>` (a bare `group_id` is accepted and prefixed) |
| `IMESSAGE_ALLOWED_HANDLES` | your own number(s) for 1:1. With neither list set the provider **refuses to start** |
| `IMESSAGE_DRY_RUN`, `IMESSAGE_RATE_PER_MIN`, `IMESSAGE_ALLOW_ALL`, `IMESSAGE_IGNORE_HANDLES` | unchanged |
| `SENDBLUE_API_KEY` | API key id (Nook name `SENDBLUE_API_KEY_ID` also read) |
| `SENDBLUE_API_SECRET` | API secret |
| `SENDBLUE_FROM_NUMBER` | the Sendblue line (Nook name `SENDBLUE_NUMBER` also read) |
| `SENDBLUE_WEBHOOK_SECRET` | shared secret for webhooks |
| `SENDBLUE_PUBLIC_URL` | https origin Sendblue can reach (default `HUB_BASE_URL`) |
| `SENDBLUE_WEBHOOK_SECRET_HEADER` | default `sb-signing-secret` |
| `SENDBLUE_REPLAY_WINDOW_S`, `SENDBLUE_MEDIA_HOSTS` | optional hardening |
| `SENDBLUE_API_BASE` | **tests only** (the fake server); never set in production |

Credentials are read only by `config.ts`, passed to the client, redacted from errors, and never in a response, status, log,
queue row or the id map (a sentinel scan test covers each).

## 6. Setup

1. Put the four `SENDBLUE_*` values, `IMESSAGE_PROVIDER=sendblue`, `IMESSAGE_ENABLED=1` and an allowlist in the hub env; start with
   `IMESSAGE_DRY_RUN=1`; restart the hub. The iMessage card on Connections lists any missing names.
2. Webhook URL (shown on the card, derived from `SENDBLUE_PUBLIC_URL` or `HUB_BASE_URL`): `https://<origin>/v1/webhooks/sendblue`.
   In the Sendblue dashboard (Developer, Webhooks) add a **receive** webhook with that URL and the secret `SENDBLUE_WEBHOOK_SECRET`;
   add the **outbound** webhook with `.../v1/webhooks/sendblue/status` (Squad also sends this as the per-message `status_callback` over https).
3. Local development: Sendblue needs https, so tunnel the hub: `cloudflared tunnel --url http://localhost:8788` (or ngrok), set
   `SENDBLUE_PUBLIC_URL` to the printed https address, restart, and update the dashboard URLs.
4. Allowlist: `IMESSAGE_ALLOWED_CHATS=Sendblue;+;<group_id>` (the `group_id` appears in the first webhook; Integration Health
   `allowlist_configured` says what is missing) and `IMESSAGE_ALLOWED_HANDLES=<your number>`.
5. In the iMessage group send `join <invite code>`. From then on `@cubbie` / `@cubbi` / aliases are answered in the same Squad thread.
6. Outbound files are served as `/v1/imessage/media/<id>.<expiry>.<sig>.<ext>` (random id, HMAC in the path because Sendblue
   rejects query-signed URLs, 15 minute expiry, only png/jpg/gif/webp/pdf/mp3/m4a/wav). Links in messages are absolute plain text.

## 7. Health probes

`GET /v1/imessage/health` and, registered in the shared registry, `GET /v1/connections/health` (group `sendblue`):

| Check (ids) | Passes when |
| --- | --- |
| `sendblue_configured` / `sendblue_configured` | the four env values are set and the provider is `sendblue` |
| `webhook_secret_set` / `sendblue_webhook_secret` | `SENDBLUE_WEBHOOK_SECRET` set |
| `webhook_reachable_url` / `sendblue_webhook_url` | the URL is public https (reachability itself is proven by `inbound_seen`) |
| `outbound_probe` / `sendblue_outbound` | `GET /api/lines` works and lists the from number. **Never sends a message.** Cached 60 s |
| `last_delivery_status` / `sendblue_delivery` | the last status callback was not `failed` |
| `inbound_seen` / `sendblue_inbound` | a verified inbound message arrived |
| `thread_mapped_to_web_thread` / `sendblue_thread` | a Sendblue group is bound to a squad |
| `allowlist_configured` / `sendblue_allowlist` | an allowlist exists (warn on allow-all) |

Without credentials every live check is `blocked` with reason `BLOCKED(missing env: NAMES)` and `missingEnv`, never a pass.
Header states: `Sendblue: connected to <group>, last inbound <t>, last status <t>, <n> queued`,
`Sendblue: not configured (set <names>)`, `degraded: <reason>`, `Fixture transport (no real iMessage)`, `Dry run, not sent`.

## 8. Tests

* `apps/hub/src/imessage/sendblue/sendblue.test.ts` (48 tests, fake Sendblue server on an OS-assigned port, global fetch fenced to
  loopback): signature valid/missing/wrong/prefix/tampered body/stale timestamp/oversize/invalid JSON/rate limit; replay and
  dedupe; out-of-order and duplicate status callbacks; allowlist/dry run/kill switch/rate limit with the fake never called;
  group mapping and the id table; `@cubbie`, `@cubbi`, aliases; attachments (inbound fetch, SSRF guard, signed outbound URLs);
  failure, retry, backoff; unconfigured, degraded, fixture, dry run; sentinel secret scan; cross-squad isolation; `$180`/`therapy`.
* `e2e/specs/j34-sendblue.spec.ts` (Playwright, fixture mode): `E2E_SENDBLUE=1 E2E_NO_AGENTS=1 E2E_HUB_PORT=9070 E2E_WEB_PORT=5470 E2E_AGENT_BASE=4951 E2E_SENDBLUE_PORT=9071 pnpm exec playwright test specs/j34-sendblue.spec.ts` from `e2e/`.
* Gate steps `S4s S6s S7s S10s` (`e2e/gate/steps/sendblue.ts`): fixture column PASS against the fake; real column
  `BLOCKED(missing env: ...)` unless every `SENDBLUE_*`, `GATE_SENDBLUE_TEST_NUMBER` and `IMESSAGE_ALLOWED_HANDLES` are set.

## 9. Safe real-account smoke (yours to run; automation never does)

1. Use your own Sendblue line and your own phone. Allowlist only your number and one group you own.
2. `IMESSAGE_PROVIDER=sendblue IMESSAGE_ENABLED=1 IMESSAGE_DRY_RUN=1`, start, open Connections and Integration Health: expect
   `inbound_seen` warn until you text the line, `outbound_probe` pass.
3. Text the line from your allowlisted number: the first-contact reply must arrive as a dry-run (nothing sent) and the web thread
   must show the inbound message `via iMessage (Sendblue)`.
4. Remove `IMESSAGE_DRY_RUN`, restart, send `join <code>` in your group, then `@cubbie hello`: check the answer in both places and the
   badge moving sent, delivered.
5. Gate: `GATE_REAL=1 GATE_REAL_SEND=1 GATE_SENDBLUE_TEST_NUMBER=<your number>` sends **one** message to that number.
6. Kill switch: unset `IMESSAGE_ENABLED` and restart; the webhook then answers 503 and nothing is sent.

## 9b. Demo/Fixture bridge (test the whole loop with no credentials)

Real Sendblue stays `blocked` until credentials exist. To exercise the loop locally anyway, there is an explicit **Demo
bridge**: a scripted transport (`FakeIMessageTransport` with simulated delivery and read receipts) bound to your squad.

* **Switch on**: Connections, iMessage card, "Start demo bridge" (or `POST /v1/imessage/demo {"enabled":true}`;
  `IMESSAGE_PROVIDER=fake` / `IMESSAGE_FIXTURE=1` at boot does the same). Off by default; `POST {"enabled":false}` or "Stop demo bridge" turns it off.
* **Never in production**: refused with 403 when the hub runs a production config, and with `IMESSAGE_DEMO=0`. It never overlays a
  running real bridge (409). It uses no network at all (the tests make `fetch` throw) and cannot send a real message.
* **Loop**: "Send as the demo phone" (`POST /v1/imessage/demo/inbound {text}`, signed-in members only) -> stored once in the same
  web group thread as "via iMessage (demo)" -> `@cubbie` answers through the same `chat.send` path as the web (same retrieval,
  provenance and Demo labels) -> the answer is mirrored to the fixture group -> delivery badge sent, delivered, read.
  The demo phone is a fake `+1 555 01..` number linked to your account; roster students without a sign-up account get 409 `no_account`.
* **Labels**: status route `bridge.demo=true` and `Fixture transport (no real iMessage)`; message footers `via iMessage (demo)`;
  Connections "Demo bridge is ON ... never sent anywhere"; Integration Health `imessage_demo_bridge` is a **demo pass**
  (`mode: demo`, "NOT the real Sendblue connection") next to the Sendblue checks, which stay `blocked`/`fail` until credentials exist.
* **Safety flags** (all providers): `GET /v1/imessage/status` -> `bridge.safety` `{dryRun, killSwitch, allowlist:{chats,handles,allowAll}}`
  (counts only) and the same on `GET /v1/imessage/setup`; both are shown in the Connections Sendblue section.
* Tests: `apps/hub/src/imessage/demo.test.ts`, `e2e/specs/j34-demo-bridge.spec.ts` (default stack, no `E2E_SENDBLUE`), gate step `S4d`.

## 10. Limitations (honest)

* The webhook secret header name is not stated on the public webhook page; `sb-signing-secret` is the default and configurable.
* A shared secret does not authenticate the body (section 3).
* Sendblue documents no READ status, so `read` appears only if a provider callback carries it; delivered is the practical end state
  for iMessage. No typing indicators or read receipts are sent.
* Groups need a Sendblue plan with group support; Squad only replies in groups the line already belongs to and never creates one.
  Sendblue sends at most one `media_url` per message, so extra files go as separate messages (the first carries the text).
* Inbound media is fetched from the webhook's `media_url` (https, public hosts, 9 MB, optional host allowlist) only for allowlisted chats.
* 1:1 replies obey Sendblue's pre-reply limits (300 characters, no links or media, 6 messages) until the person has texted first;
  a decline is reported as `Failed: Sendblue pre-reply limit ...` with Retry.
* No backfill (Sendblue has no history API used here): a webhook missed after Sendblue's 3 retries is lost. Sendblue pacing
  headers (`x-rate-limit-suggestion`) are not read yet; Squad's per-chat limit and backoff apply instead.
* Nothing in this repo has talked to the real Sendblue: all verification is against the fake, which implements the documented
  shapes. Payload field names for `/api/lines` and the group-send body are from the docs, not from a live account.

## 11. Missing env in this repo's current `.env` (names only)

Present: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `HUB_BASE_URL`, `INTERNAL_EVENTS_SECRET`, `DB_PATH`, `SQUAD_LIVE`.
Absent for Sendblue: `SENDBLUE_API_KEY`, `SENDBLUE_API_SECRET`, `SENDBLUE_FROM_NUMBER`, `SENDBLUE_WEBHOOK_SECRET`, plus
`IMESSAGE_PROVIDER`, `IMESSAGE_ENABLED`, `IMESSAGE_ALLOWED_CHATS`, `IMESSAGE_ALLOWED_HANDLES`, `GATE_SENDBLUE_TEST_NUMBER`.
Absent for Google (owned by feature/integration-journey): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI` (scopes are that branch's). Sendblue account scopes: an API key pair, a dedicated or shared line,
and (for groups) a plan with group messaging.
