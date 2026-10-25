# iMessage integration

Squad's bot can live in real iMessage chats. The hub runs the bridge in the same process as the web chat, so an
iMessage group and the web squad chat are the same conversation, and a 1:1 iMessage is the same private thread as the
web DM. Everything here is testable without sending a real message (`FakeIMessageTransport`, dry-run); the manual
verification against real Apple behaviour is the runbook in section 6 and is yours to run.

## 1. Architecture

```
Messages.app / chat.db
   |  @photon-ai/imessage-kit (SDK)               real, macOS only
   v
apps/bot/src/imessage/gateway.ts   kill switch, allowlists, dedupe, loop protection, outbound rate limit,
                                   dry-run, message splitting (the ONLY code that touches the SDK)
   |  GatewayInbound { guid, chatGuid, isGroup, sender, text }
   v
apps/hub/src/imessage/bridge.ts    handle -> account, first contact, join / leave, who is linked,
   |                               numbered quiz replies
   |  deps.chat.send(viewer, ...)  the SAME hub chat API as the web (stored, streamed to the web, routed by the
   v                               same router, speaking policy, confirm flow, skills)
hub chat store  --onBotPost-->  bridge  --renderForIMessage-->  gateway.send(group guid | 1:1 handle)
```

- Group chats map to `group:<squadId>` through the table `chat_bindings` (unique per `chat_guid`; a squad may serve
  several chats). A 1:1 maps to `dm:<userId>`.
- Bot messages are mirrored out. A web student's own words are copied into the bound group only under the mirroring rules
  of section 8.4 (by default only when they @mention an agent, labelled `<name> (via Squad): ...`, never as the person).
- The speaking policy is untouched: the router decides whether the bot speaks (mentioned, or score >= 0.8 with the
  120 s unprompted cooldown). The bridge only carries what the router already posted. 50 lines of banter in a bound
  group produce zero bot messages (tested, `bridge.test.ts` and the bot adversarial suite).
- The standalone bot (`TRANSPORT=imessage pnpm --filter @squad/bot dev`, its own roster and database) still exists and now
  goes through the same gateway, so the same switches apply. Do **not** run it and the hub bridge on the same Mac at
  the same time: both would watch the same chat and answer twice. Use the hub bridge (it knows the accounts).

Code map:

| File | What |
|---|---|
| `apps/bot/src/imessage/config.ts` | env flags, `configProblem` (fail closed) |
| `apps/bot/src/imessage/safety.ts` | allowlists, dedupe, loop protection, outbound rate limit |
| `apps/bot/src/imessage/gateway.ts` | the guarded SDK wrapper, dry-run outbox, splitting |
| `apps/bot/src/imessage/text.ts` | plain-text rendering of cards, `splitMessage`, `stripMarkdown` |
| `apps/bot/src/imessage/fake.ts` | `FakeIMessageTransport` (scripted Apple) |
| `apps/hub/src/imessage/store.ts` | migration + tables (below) |
| `apps/hub/src/imessage/bridge.ts` | the bridge |
| `apps/hub/src/imessage/commands.ts` | `join`, `leave squad`, `who is linked` parsing |
| `apps/hub/src/imessage/routes.ts` | `GET/POST/DELETE /v1/imessage/link` |
| `apps/hub/src/imessage/wire.ts` | `attachIMessage`, called from `apps/hub/src/main.ts` |
| `apps/hub/src/imessage/sync.ts`, `sync-rules.ts` | outbound queue and retry, delivery state, backfill, attachment intake; the pure rules (mirroring, caps, backoff) |
| `packages/core/src/chat-sync.ts` | additive message fields, delivery state names and labels, `orderThread` |
| `packages/web/src/pages/chat/sync/` | `SyncBadge` (origin and state), `applySyncPatch`, `retryImessage` |

Tables (migration scope `imessage`, run at hub boot):
`chat_bindings(chat_guid PK, squad_id, bound_by, bound_at)`, `imsg_links(handle_hash PK, user_id -> acct_users ON DELETE
CASCADE, hint)`, `imsg_link_codes(code PK, handle_hash, hint, expires_at, used_at)`, `imsg_seen(guid PK, ts)`,
`imsg_participants(chat_guid, handle_hash, hint, last_seen)`.

## 2. Handle linking

An incoming sender (phone `+15551234567` or an Apple ID email) is normalized with the same functions as sign-up
(`normalizePhone`, `normalizeEmail`) and hashed on the fly with the same salted HMAC (`accounts.hashContact`, key
`CONTACT_PEPPER`). If it equals a sign-up contact hash, or a handle linked with a code (`imsg_links`), the sender is that
account. **Raw handles are never stored**; only hashes and a masked hint (`•••• 4567`). The raw handle of a student who
texts the bot is kept in memory only, to be able to reply and to deliver nudges. After a hub restart a student must text
the bot once before a nudge can reach their phone.

First contact from an unknown handle in a 1:1 chat: the bot replies once (and at most once per 10 minutes) with
`<HUB_WEB_URL>/welcome` and a 6 character code valid for 30 minutes. The student signs in on the web and enters the code
(`POST /v1/imessage/link { code }`, signed in, 10 attempts per hour); that number is then that account. Signing up with
the same number needs no code. `GET /v1/imessage/link` lists linked numbers (masked); `DELETE /v1/imessage/link` unlinks
them. Deleting the account removes the links. The web UI for entering the code is not part of this change: use the API
(or add a field to the Welcome page).

### 2.1 Linking from the web (phone first)

The other direction: a signed-in student enters their number in Setup (`POST /v1/me/phone/start`, then `/verify`, see docs/accounts-api.md "Phone linking"). The code is delivered by iMessage only when the bridge is configured (`CODE_SENDER=imessage`, `IMESSAGE_SEND_URL`) and the handle is on `IMESSAGE_ALLOWED_HANDLES` (or `IMESSAGE_ALLOW_ALL=1`); with `HUB_DEV_LOGIN=1` and no bridge the code is shown in the web UI and labelled as a dev code; otherwise the UI says "code delivery unavailable". Verification links the handle hash to the current account, so the bot treats that sender as the student from then on (no code text needed).

## 3. Binding a group

In an iMessage group that has the bot (see limitations) a member sends `join ABCD-EFGH` or `@cubbie join ABCD-EFGH` (a
pasted invite link works). The invite is validated by the existing invite logic (`squads.preview` then `squads.join`):
wrong, expired, revoked and used-up codes get a plain-words refusal and bind nothing. The sender must be a known
account. If the sender is not yet in the squad they join it with that invite; if they already are, the code is just the
proof. The chat is then bound and the bot tells the group who is linked, who still needs to sign up (by a masked number,
never a full one) and which squad members it has not heard from in the chat yet.
Note: Apple and imessage-kit expose no group member list, so participants are learned as they speak.

- `@cubbie who is linked` repeats the summary.
- `@cubbie leave squad` unbinds. Only the squad owner may.
- Unbound group: the bot only answers a mention, once per 10 minutes, with how to join. Banter is ignored.
- Bound group: messages from squad members are relayed into the web squad chat. Messages from numbers that are not
  matched, or from accounts not in the squad, are not relayed; on a mention they get one short hint per 10 minutes.
- Disbanding the squad drops its bindings.

## 4. Cards as text

Everything is plain text, no markdown, no tables, at most 900 characters per message, at most 5 messages per bot
answer (the rest points to the web). Bot answers never carry attachments (podcasts and pictures are a title and a link); a web student's attached file is sent along with a mirrored message only under section 8.5.

| Web card | iMessage |
|---|---|
| confirm | question, `1. Yes / 2. No`, `Reply 1 to confirm, 2 to cancel.` (other options: `Reply with a number from 1 to N.`). The reply is the normal `askConfirm` numbered reply. |
| quiz | `Question N: ...`, `1) ...`, `Reply with a number (1 to N).` A numeric reply in that chat is turned into the choice letter before it reaches the quiz skill. |
| council | `Council verdict: ...`, confidence in words, one `Dissent:` line, `Source: [file p.N]`, `Full card: <link>` |
| citations | the `[file p.N]` markers stay in the text; missing ones are appended as `Sources: [..]` |
| podcast, explainer, files | `<title>: <link to the message on the web>` |
| live discussion | topic line and `Takeaways: <link>` |

Links point at `<HUB_WEB_URL>/squad?m=<message id>` and `/squad?council=<id>`. These deep-link query parameters are not yet
handled by the web app (it opens the squad page); adjust `link` in `bridge.ts` if the route differs.

## 5. Safety

| Env | Default | Meaning |
|---|---|---|
| `IMESSAGE_ENABLED` | `0` | Kill switch. Anything but `1` or `true`: nothing is watched, read or sent. |
| `IMESSAGE_DRY_RUN` | `0` | `1`: the whole flow runs, every would-be send is logged (kind and length, never text or number) and kept in `gateway.outbox`; nothing is sent. |
| `IMESSAGE_ALLOWED_CHATS` | empty | comma list of chat GUIDs. A group not listed is never read or written. |
| `IMESSAGE_ALLOWED_HANDLES` | empty | comma list of numbers or emails. A 1:1 with anyone else is never read or written. Matching ignores formatting. |
| `IMESSAGE_ALLOW_ALL` | `0` | `1` disables both lists. Never use on a Mac with real chats. |
| `IMESSAGE_RATE_PER_MIN` | `10` | outbound messages per chat or handle per minute (excess is dropped and counted). Sends are also spaced 1 s apart. |
| `IMESSAGE_IGNORE_HANDLES` | empty | other bots or numbers to ignore. |
| `HUB_SCHEDULER` | `0` | start the proactive scheduler in the hub (it also starts when `IMESSAGE_ENABLED=1`). |

Fail closed: enabled with no allowlist and no `IMESSAGE_ALLOW_ALL=1` refuses to start (the hub logs why and continues
without iMessage; the standalone bot exits). Loop protection: own messages (`isFromMe`), tapbacks and non-text are
ignored; a message that starts with a persona prefix (`🐻 Cubbie: `) is ignored (another bot, or our own echo); the exact
text we just sent is ignored for 60 s; a sender that sends more than 8 messages in 10 s is muted for 5 minutes. Dedupe by
Apple's message guid is persistent (`imsg_seen`, 7 days), so a restart does not replay old messages.

Privacy: the group mirror re-checks every outgoing group text against the sentinels (`$180`, `therapy`) and the ledger's
private values, on top of the hub's own leak guard, and replaces a hit with "I kept that private. Ask me in a DM."
Personal output (DM replies, nudges, confirm prompts) is only ever sent to that student's own 1:1 handle. A DM reply is
not mirrored to the phone while the student's latest message came from the web (10 minutes); proactive messages are.

Nudges and Catch Me Up use the existing scheduler: personal ones are `ctx.dm` (the student's iMessage 1:1), squad ones are
`ctx.send` into the group (the bound chats). Quiet hours (22:00-08:00 local), the per-student gap and daily caps and the
group cooldown and cap are the scheduler's delivery gate, unchanged.

## 6. Manual verification runbook (you, with a spare Apple ID)

Use a **spare Apple ID**, never your main one. Nothing below is automated; I did not send or read anything real.
**Only your own account and your own chats.** Never message, add or test with a third party: the "group" is you, your
spare ID and a second number or device that you own. Section 8.8 is the sync-specific smoke checklist to run after this.

1. **Mac setup.** Sign Messages.app into the spare Apple ID (Settings > iMessage). Note its number or email (the bot's
   identity). From your own iPhone (your real number) start a 1:1 with the spare ID once, and make a group of three:
   your phone, the spare ID, and a second number or device that you own. Name it `Cubbie Test`.
2. **Permissions.** System Settings > Privacy & Security > **Full Disk Access**: add the exact terminal app you run from,
   then quit and reopen it (without this the SDK cannot read `chat.db`). The first send triggers an **Automation**
   prompt (terminal controls Messages): allow it. Run `caffeinate -dis` in another tab so the Mac does not sleep.
3. **Rehearsal with no Apple at all** (any machine): `pnpm exec tsx scripts/verify-imessage.ts --dry-run --yes`, and
   `pnpm --filter @squad/hub exec vitest run src/imessage` (the whole bridge over the fake). All green first.
4. **Live SDK check**: `pnpm exec tsx scripts/verify-imessage.ts --group "Cubbie Test" --to <your own number>` and follow
   the prompts (5 checks; exit 0 means reading text, sending and a numbered reply work). A failure on check 2 ("text is
   empty") is the macOS 27 `attributedBody` problem; see rollback.
5. **Find the chat GUID** of `Cubbie Test` (the verify script's check 1 prints the group's `chatId`, form
   `iMessage;+;chat123...`) and your own number in E.164 (`+15551234567`).
6. **Hub, dry-run first.** In the hub's environment (not committed):
   ```
   IMESSAGE_ENABLED=1 IMESSAGE_DRY_RUN=1
   IMESSAGE_ALLOWED_CHATS='iMessage;+;chat123...'
   IMESSAGE_ALLOWED_HANDLES='+15551234567'
   HUB_WEB_URL=http://localhost:5180
   ```
   Start the hub (`pnpm --filter @squad/hub dev`; the log says `imessage: running (dryRun=true, ...)`). Text the spare ID
   from your phone: the hub logs `imessage DRY RUN: would send` and the phone gets nothing. This reads your Messages
   database through the SDK (that is the point of the manual run).
7. **Live, 1:1.** Remove `IMESSAGE_DRY_RUN`, restart. Text the spare ID. With a number you signed up with, the bot
   answers; with a new number you get the welcome link and a code. Sign in on the web, then
   `curl -X POST $HUB/v1/imessage/link -H "Authorization: Bearer <token>" -H 'content-type: application/json' -d '{"code":"ABC234"}'`.
   Then text again: the message is in your web DM thread (`dm:<you>`) and the answer comes back to the phone.
8. **Live, group.** Create a squad on the web, make an invite (`Members > Invite`). In the `Cubbie Test` group send
   `join ABCD-EFGH`. Expect: a message naming who is linked and who still needs to sign up. Then `@cubbie what is a
   z-score?`: the answer appears in the group and in the web squad chat. Type in the web group chat: `@cubbie ...`: the
   answer is mirrored into the iMessage group. Plain banter gets no reply. `@cubbie leave squad` (as owner) unbinds.
9. **Confirm and quiz.** In the 1:1 trigger a confirm (for example a pinky promise); expect `Reply 1 to confirm, 2 to
   cancel.` and a `1` reply to work. In the group ask for a quiz; reply with a number.
10. **What to expect**: replies start with `🐻 Cubbie:`; long answers arrive as up to 5 short messages about a second apart;
    no markdown; no attachments (podcasts and pictures arrive as a title and a link).

Kill switch and rollback: unset `IMESSAGE_ENABLED` (or set it to `0`) and restart the hub; nothing is read or sent. To
keep the hub running but stop all outbound without a restart, there is no hot switch: restart. To undo a binding use
`@cubbie leave squad` or `DELETE FROM chat_bindings WHERE chat_guid=...`. If check 2 fails on macOS 27, use
`TRANSPORT=discord` (`apps/bot/DISCORD.md`); nothing else changes. Remove the spare ID from Messages when done.

## 7. Verified and unverified

Verified by tests (all over `FakeIMessageTransport`, no Apple involved): handle matching against sign-up hashes with no raw
handle in any table; first contact, link code, expiry and single use; DM is the private thread; the join flow including
wrong, expired, revoked, used-up codes, unknown sender, double bind, owner-only unbind, disbanded squad; group with mixed
linked and unlinked members; relay into the web chat and mirror back; banter silence over the bridge; the DM sentinels
`$180` and `therapy` never reaching the group (including the leak guard); card fallbacks (confirm, quiz with numbered
replies, council, podcast and explainer, citations) and message splitting and plain text; nudges to the 1:1, squad things
to the group, quiet hours; kill switch, dry-run, allowlists, fail-closed config, loop protection, flood mute, outbound
rate limit, dedupe including after a restart.

Unverified (real Apple behaviour; one-line fixes where they fail):
- imessage-kit on macOS 27 (`attributedBody` text, watching, sending). The verify script is the gate.
- That the `chatId` the SDK reports for groups and 1:1 chats has the shape the code assumes (`;+;` for groups, the handle
  as `participant` or the last segment of a 1:1 guid). Fix: `isGroupGuid`, `senderOf` in `safety.ts`.
- That an iMessage sender handle is always the same E.164 / email form that was used at sign-up (country codes other
  than +1 are normalized as written; a number typed without `+` at sign-up is assumed +1).
- Sending to a group by chat id and to a 1:1 by handle (the existing transport's assumption).
- Delivery speed and Apple's own throttling or spam filters for a new Apple ID texting several chats.
- Sync on real Apple (section 8): whether the SDK reports a GUID for our sends (without it nothing is `delivered` and a
  receipt cannot match; `sent` still holds), whether delivery receipts exist at all, that `listMessages` since a time returns
  late-arriving messages and the real `createdAt` ordering, attachment `localPath` access and sizes, the `chatId` of a 1:1 used
  for backfill (`iMessage;-;<handle>` is assumed, and 1:1 backfill only covers handles that texted since the hub started).
- The web wiring of the sync display into the chat page (`SyncBadge`, `chat.sync` event; see 8.3) lands with the chat page fix.
- The web deep links (`/squad?m=`, `/squad?council=`) and a web field for the link code.

Apple limitations: there is no API to create a group or add people from code: you create the group on a phone and add the
spare ID by hand. Rich cards (tapbacks, polls, link previews made by the bot, buttons) are not supported, hence the text
fallbacks. Group membership is not exposed, so "who is here" is learned from who speaks. The bot needs a Mac that is
awake and signed in; Full Disk Access is required to read the database.

## 8. Chat sync (iMessage <-> web)

The bridge keeps one conversation in step on both surfaces. The pieces: an identity map, one deterministic order, a
delivery state per message, a per-chat cursor with backfill, and an outbound queue with retry. All of it is tested over
`FakeIMessageTransport` (`apps/hub/src/imessage/sync.test.ts`, `bridge.test.ts`); none of it has met real Apple yet (section 7).

### 8.1 Identity map and dedupe

`imsg_xref(ext_id PK, direction in|out, thread_key, message_id, status, handle_hash, origin_ts)` maps an Apple message GUID
to a hub message id. Inbound: the gateway claims the GUID atomically before anything else, so redeliveries, backfill
overlap and races stop at the claim (`claimInbound`; a handler that throws releases it so a redelivery can retry).
Outbound: when the transport confirms a send and reports the new GUID, it is recorded with direction `out`, which is
also how a delivery receipt finds its message. Only salted handle hashes are stored, never numbers or emails. A chat GUID
is a thread key, never a message id.

Loops: an iMessage-origin message is never mirrored out; a mirrored web message is sent as
`<name> (via Squad): <text>` and any incoming text with that marker is dropped (the gateway's 60 s memory of its own sends
is the first line, the marker is the second, `isFromMe` and persona prefixes the third).

### 8.2 Order and attribution

One order for both surfaces: `compareThread` / `orderThread` in `@squad/core` sort by message time `ts`, ties by hub
sequence `seq` (arrival). An inbound message is stored with Apple's own timestamp, so a message that arrives late (offline
gap, backfill, Apple delivering out of order) lands where it happened and carries `receivedLate: true`. The sender shows as
the member's name (`senderLabel`) when the handle matches a squad member, otherwise as a masked label (`•••• 4567`).
Messages from unlinked senders are shown read-only (sender kind `system`) and never routed to the bot; a squad can hide
them with `showUnlinked: false`. Raw numbers never appear in a message, a label or a log.

### 8.3 Delivery states

Additive fields on every hub message: `transport` (`web` | `imessage`), `externalId`, `deliveryState`, `senderLabel`,
`attachments` (existing), `skippedAttachments`, `receivedLate`. State changes are stored on the message and streamed as the
additive SSE event `chat.sync { chatId, messageId, patch }`; old clients ignore it.

| State | Label shown | Meaning |
|---|---|---|
| `queued` | Sending to iMessage / Retrying iMessage send / Waiting to send: iMessage connection is unstable | in the outbound queue, not confirmed |
| `sent` | Sent to iMessage | set **only** after the transport confirmed the send |
| `delivered` | Delivered | a delivery receipt arrived (only transports that have receipts) |
| `failed` | Failed: <reason> | gave up; web shows Retry (`POST /v1/imessage/messages/:id/retry`, members of the chat) |
| `dry_run` | Dry run, not sent | `IMESSAGE_DRY_RUN=1`: routed, nothing sent |
| `web_only` | Web only, not sent to iMessage | in a bound squad but the mirroring rule keeps it on the web (also: withheld by the privacy guard) |

Failure reasons: `transport_error`, `chat_not_allowed`, `handle_not_allowed`, `kill_switch`, `expired`, `no_handle`,
`receipt_failed`. A message with several parts or several groups shows one aggregate state (`Failed in 1 of 2 chats`).

### 8.4 Mirroring rules (privacy limits)

| Setting (per squad) | Web squad chat -> bound iMessage groups |
|---|---|
| `bot_and_mentions` (default) | bot replies, and student messages that @mention an agent (`@cubbie`, `@cubbi` and the aliases of the shared mention parser) |
| `bot_only` | bot replies only |
| `full` | every student message |

Owner changes it with `PUT /v1/imessage/squads/:id/settings { mirror, showUnlinked }`; members can read it.
Always: DMs never cross threads in either direction (a web DM is not mirrored to the phone, a 1:1 iMessage is never shown
in a squad chat); a mirrored text is checked against the sentinels and the ledger's private values and kept on the web
(`web_only`, "Kept on the web: it contains private info") on a hit; several groups bound to one squad all receive the
mirror, and each group only ever receives its own squad's messages; an unbound group is neither read nor written.
The `@cubbie` / `@cubbi` detection is `detectMention` today; when `feature/typed-mentions` lands on main the bridge takes its
aliases from that shared parser (one call site: `mirrorStudent` and `groupInbound` in `bridge.ts`).

### 8.5 Attachments

Inbound: up to 4 per message, 8 MB each, types PNG, JPEG, GIF, WebP, PDF and common audio, decided by the file's own bytes
(a relabelled file is refused). A kept file gets an unguessable id and is served only to the chat's members; its local path
never leaves the gateway. Everything else becomes an honest placeholder on the message (`skippedAttachments`:
`unsupported_type`, `too_large`, `unavailable`) and an attachment-only message from a DM gets "I cannot open that kind of
file here." Outbound: a web student's attached file goes with a mirrored message under the same rules; bot answers do not
carry files.

### 8.6 Reconnect, backfill, outbound queue

`imsg_cursor(thread_key, last_ts, last_guid)` advances per chat, forward only. At start, on `reconnect()` and every 60 s the
hub asks the transport for each bound chat's messages since `cursor - 5 min` (the overlap catches Apple's late arrivals; the
identity map dedupes), never earlier than the moment the chat was bound. A backfilled message older than 6 h is stored for the
record but not answered by the bot. A transport without `listMessages` simply does not backfill.

Outbound rows live in `imsg_out(message_id, target, part)` (unique, so queueing is idempotent), sent strictly in order per
target by a drain every second. A failed attempt retries after 2 s, 8 s, 30 s, 2 min, 5 min, then the row is `failed`; a row
older than 1 hour expires instead of sending a stale answer; the per-chat rate limit defers without failing. The gateway
itself tries a send twice before reporting a failure; three failures in a row mark the transport `degraded` (shown on queued
messages and in `GET /v1/imessage/status`). Text is cleared from a row once it is sent.

### 8.7 Test scenarios

`FakeIMessageTransport` scripts: duplicates (`duplicate`), out-of-order and ties, offline gap then backfill (`dropWatcher`,
`restoreWatcher`, `listMessages`), send failure then retry (`failNext`), receipts (`receipt`), multiple groups, an unbound
group, attachments, dry run, a squad with two groups, and the cross-surface consistency check (unique external ids, every
`sent` has an Apple GUID, one order, no raw handle in messages or the identity map).

### 8.8 Safe real-account smoke (after section 6, yours to run)

Own account and own chats only; never a third party; never read the real Messages database outside the documented
`--dry-run` flags.

1. `IMESSAGE_ENABLED=1 IMESSAGE_DRY_RUN=1` with `IMESSAGE_ALLOWED_CHATS` set to one chat that only you are in and
   `IMESSAGE_ALLOWED_HANDLES` to your own number. Send yourself a message: it appears on the web with "via iMessage"; a web
   `@cubbie` message shows "Dry run, not sent" and nothing arrives on the phone.
2. Remove `IMESSAGE_DRY_RUN`, restart. Web `@cubbie ...`: the phone gets `<name> (via Squad): ...`, the web state goes
   queued -> sent (and delivered if Apple reports receipts). Note whether Apple reports a GUID and a receipt at all.
3. Quit Messages.app or sleep the Mac, send yourself three messages and one web `@cubbie`, wake: the three appear once, in
   order, flagged late; the web message goes out after reconnect. Turn Wi-Fi off and send from the web: a failed send shows
   "Failed: ..." and Retry works.
4. Send yourself a PNG and a `.mov`: the PNG shows, the `.mov` shows an "Attachment not shown" placeholder.
5. Kill switch: unset `IMESSAGE_ENABLED`, restart: nothing is read or sent. Remove the binding afterwards.

## 9. Sendblue provider

The hosted Sendblue iMessage API is a second provider behind the same transport interface (`IMESSAGE_PROVIDER=sendblue`). See [docs/sendblue.md](sendblue.md).
