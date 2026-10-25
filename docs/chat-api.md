# Chat API (apps/hub + apps/bot web transport), v1

The web chat enters the SAME router, speaking policy, confirm flow and skills as iMessage. The hub mounts the bot in-process with a `web` Transport (`apps/bot/src/transports/web.ts`). Wire types and zod schemas live in `@squad/core` (`packages/core/src/chat.ts`): `ChatMessage`, `ChatSummary`, `ChatCard`, `ChatTyping`, `ChatUpdate`, `ChatSendBody`, `HubStatus`. Never redefine them.

All `/v1/chat/*` routes need `Authorization: Bearer <token>` (from `POST /v1/auth/dev-login`); SSE and files take `?st=<token>` (a bearer token or a `POST /v1/squad/stream-token` token). Error body: `{ error: { code } }`.

## Chats
- Group: `group:sq_demo` (the squad; members s_ana, s_ben, s_chi, s_dev). Everyone in the squad sees it.
- DM: `dm:<studentId>`, a private chat between one student and Squad. Only that student ever receives or can read it (stream, history, files). Private replies ("am I behind?", confirm questions, quiz feedback) arrive here; the group only gets "Sent you a DM.".
- Mentions: in a group the bot answers when the text has `@squad` or `@squad` (word bounded, any case), a leading `cubbie,` / `hey cubbie`, or when an unprompted skill scores >= 0.8 (at most one unprompted message per chat per 2 min). Every DM message is a mention. Student-to-student group messages that do not mention the bot are just stored and streamed.

## Endpoints
| Endpoint | Response |
|---|---|
| `GET /v1/status` (public) | `HubStatus {llm:'gemini'\|'fake', tts:'elevenlabs'\|'none', demo, notice?}`. `demo` is true when `llm==='fake'`; `notice` is `Demo mode: add GEMINI_API_KEY to .env for real answers`. |
| `GET /v1/chat/chats` | `{ chats: ChatSummary[] }` the viewer's group first, then their DM. `last` is the newest message the viewer may see. |
| `GET /v1/chat/history?chatId=&before=<seq>&limit=50` | `{ chatId, messages: ChatMessage[] /* oldest first */, hasMore }`. 403 `forbidden` for a chat the viewer is not in. |
| `POST /v1/chat/send` `{chatId, text, attachments?: [{id}], clientId?, confirmTaskId?}` | `202 { message: ChatMessage }` (the viewer's own message, already persisted and streamed). The bot's replies arrive on the stream. `clientId` makes a retry idempotent: `(chat, sender, clientId)` is stored once (also across a hub restart) and the first message comes back with `duplicate: true`. The same text (8+ characters) from the same sender in the same chat within 3 s is also one message (double-click guard): the first message comes back with `duplicate: true, hint: "You already sent this"`. Stored student messages carry their `clientId`; bot replies carry `replyTo` (the id of the message that triggered them) and the hub stores one answer per trigger and text. History collapses exact repeated prompt+answer pairs (30 min window, no cards or attachments) into the first with `repeat: N` (shown as ×N); stored data is untouched. `confirmTaskId` marks a confirm-card answer: only valid in the student's own DM while that card is pending, else 409 `stale_confirm`. Errors: 400 `invalid`, 403 `forbidden`, 404 `unknown_attachment`, 409 `stale_confirm`, 413 `too_large` (64 KB body), 429 `rate_limited` (30/min/student) or `busy` (2 bot runs in flight per student). Needs text or an attachment. |
| `POST /v1/chat/upload` (multipart `file`; png, jpeg, webp, gif up to 8 MB, magic bytes checked) | `{ attachment: ChatAttachment }` owned by the uploader; reference it by id in `send`. 415 `unsupported_type`, 413 `too_large`, 429 `upload_limit` (10/min, at most 8 unsent files or 32 MB per student; unsent uploads are deleted after 1 h). |
| `POST /v1/chat/file-token` | `{ ft, expiresAt }` a 2 h token that can read chat files and nothing else; use it as `?ft=` in `<img>`/`<audio>` URLs (never put the bearer token in a URL). |
| `GET /v1/chat/files/:token?ft=` | file bytes (Range supported, so audio can seek). Token is 32 hex (128 bit, unguessable); the viewer must be in the chat the file was posted to (uploaders may read their pending uploads). 404 otherwise. `cache-control: private, max-age=3600` for group files, `private, no-store` for DM files and pending uploads. |
| `GET /v1/chat/citation?file=&page=&q=` | `ChatCitationExcerpt {file, page, chapter?, title?, excerpt, highlight?}`; a window of the page the citation was verified against (about 700 chars, cut at a word boundary). With `q` (the answer text) the window opens at the sentence that best matches it and `highlight` names that sentence. 404 `not_found`. |
| `GET /v1/chat/stream?st=&lastEventId=` | SSE, per-viewer filtered (below). |

## Stream (SSE)
At most 3 live streams per student (the oldest is closed). Same framing as `/v1/squad/stream` (`retry: 2000`, `: ping` every 15 s). The `Last-Event-ID` header (or `?lastEventId=`) is a chat `seq`; the hub replays everything after it that this viewer may see, then goes live, no gaps or duplicates. Gaps in ids are normal.

| `event:` | `data:` | Delivered to |
|---|---|---|
| `chat.message` (id = seq) | `ChatMessage` | group: squad members; dm: that student only |
| `chat.update` | `ChatUpdate` (a confirm card became `answered`/`timeout`) | same audience as the message |
| `chat.typing` | `ChatTyping` (`on:true` while the bot works on a mention or DM, `on:false` when done or after 45 s) | same audience as the chat |
| `chat.resync` | `{ seq }` when `lastEventId` is ahead of the hub or the catch-up is longer than 200 messages; refetch history | the subscriber |

## Cards (structured, no text parsing in the client)
- `confirm`: `{type:'confirm', taskId, question, options[], status, answer?}` in the student's DM. To answer, `POST /v1/chat/send {chatId: 'dm:<me>', text: '<1-based option number>'}`; the router's confirm manager consumes it (nothing is booked without it). The hub later streams `chat.update` with `status:'answered'` + `answer` or `'timeout'`.
- `quiz`: `{type:'quiz', index, question, input:'choice'|'free', choices?:[{id:'A',text}]}` in the group (or DM). To answer, send the choice id (`A`) or free text to the same chat as an ordinary message (no mention needed while a quiz is active). Feedback comes privately as a DM message. Never any score, XP or streak.
- Per-viewer answered state for quiz cards is the client's own (localStorage keyed by message id).

## Citations and attachments
- Grounded doubt answers carry `citations: [{file, page, label}]` parsed from the verified `[file p.N]` markers; the text keeps the markers so it reads correctly without UI. The client shows chips; a chip opens the excerpt from `/v1/chat/citation`.
- Step Diff: upload an image, send it in the student's DM (`attachments:[{id}]`) while a diff is open (`@squad diff` in the group opens one).
- Podcast / explainer: `@squad podcast ch3` -> an `audio` attachment (audio/mp4 `.m4a`); `@squad picture it ch3` -> an `image` attachment (png). Served from `/v1/chat/files/<token>` with unguessable names.

## Honesty in demo mode
No `GEMINI_API_KEY`: the hub uses a deterministic extractive demo model over the committed OpenStax sample (4 chapters) and fake audio/image engines; every bot message has `demo: true` and the UI must show the `notice` from `/v1/status`. `ELEVENLABS_API_KEY` switches TTS to `elevenlabs`. Keys are never printed or logged.

## Privacy invariants (tested)
1. A student never receives, lists, fetches or is served a file from another student's DM (stream, history, chats, files).
2. Sentinels `$180` and `therapy` (seeded private ledger rows, and any text a student DMs) never reach another viewer through any chat route.
3. Group messages never carry private data; personal skill output goes to the DM only.

## Ask Squad: structured context (journey)

- `POST /v1/chat/send` accepts `context: ChatContextRef[]` (max 3, `packages/core/src/chat-context.ts`). The hub keeps only
  `sourceId` and `location.anchor` from each ref and re-derives title, course, location, provenance (`real` | `fixture`) from
  the context store through the viewer's read gate. Unreadable or other members' private sources: `404 context_unreadable`.
- `GET /v1/chat/context-ref?sourceId=&anchor=` returns `{ ref, groupView }`: the verified ref for the owner's composer chip and
  the redacted view a group chat may show (an unshared calendar event never shows title, time or location in a group).
- The student message stores the group-safe `context`; the bot turn receives the full verified refs (`InboundMessage.context`).
  Skill `context-ask` answers from exactly those sources; each reply carries one citation per source with
  `source.provenance`, `source.courseName`, `source.locationLabel` and a verbatim `quote` (the source viewer verifies it).
- Web: an item UI calls `queueAskCubbie({ chatId, sourceIds, prefill? })` (`sessionStorage['squad.pendingContext']`) and opens the
  chat; the composer for that chat shows the removable chip (`composer-context-chip`, remove `composer-context-chip-remove`),
  prefills the prompt, and never auto-sends.
