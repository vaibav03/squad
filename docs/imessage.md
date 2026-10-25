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
- Only **bot** messages are mirrored out. A web student's own words are not copied into the iMessage group (the bot
  would be impersonating them); iMessage members see the bot's answers and their own chat.
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
answer (the rest points to the web). iMessage attachments are never sent.

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

1. **Mac setup.** Sign Messages.app into the spare Apple ID (Settings > iMessage). Note its number or email (the bot's
   identity). From your own iPhone (your real number) start a 1:1 with the spare ID once, and make a group of three:
   your phone, the spare ID, and a friend or a second number. Name it `Cubbie Test`.
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
- The web deep links (`/squad?m=`, `/squad?council=`) and a web field for the link code.

Apple limitations: there is no API to create a group or add people from code: you create the group on a phone and add the
spare ID by hand. Rich cards (tapbacks, polls, link previews made by the bot, buttons) are not supported, hence the text
fallbacks. Group membership is not exposed, so "who is here" is learned from who speaks. The bot needs a Mac that is
awake and signed in; Full Disk Access is required to read the database.
