# Chat API (apps/hub + apps/bot web transport), v1

The web chat enters the SAME router, speaking policy, confirm flow and skills as iMessage. The hub mounts the bot in-process with a `web` Transport (`apps/bot/src/transports/web.ts`). Wire types and zod schemas live in `@squad/core` (`packages/core/src/chat.ts`): `ChatMessage`, `ChatSummary`, `ChatCard`, `ChatTyping`, `ChatUpdate`, `ChatSendBody`, `HubStatus`. Never redefine them.

All `/v1/chat/*` routes need `Authorization: Bearer <token>` (from `POST /v1/auth/dev-login`); SSE and files take `?st=<token>` (a bearer token or a `POST /v1/squad/stream-token` token). Error body: `{ error: { code } }`.

## Chats
- Group: `group:sq_demo` (the squad; members s_ana, s_ben, s_chi, s_dev). Everyone in the squad sees it.
- DM: `dm:<studentId>`, a private chat between one student and Cubbie. Only that student ever receives or can read it (stream, history, files). Private replies ("am I behind?", confirm questions, quiz feedback) arrive here; the group only gets "Sent you a DM.".
- Mentions: in a group the bot answers when the text has `@cubbie` or `@squad` (word bounded, any case), a leading `cubbie,` / `hey cubbie`, or when an unprompted skill scores >= 0.8 (at most one unprompted message per chat per 2 min). Every DM message is a mention. Student-to-student group messages that do not mention the bot are just stored and streamed.

## Endpoints
| Endpoint | Response |
|---|---|
| `GET /v1/status` (public) | `HubStatus {llm:'gemini'\|'fake', tts:'elevenlabs'\|'none', demo, notice?}`. `demo` is true when `llm==='fake'`; `notice` is `Demo mode: add GEMINI_API_KEY to .env for real answers`. |
| `GET /v1/chat/chats` | `{ chats: ChatSummary[] }` the viewer's group first, then their DM. `last` is the newest message the viewer may see. |
| `GET /v1/chat/history?chatId=&before=<seq>&limit=50` | `{ chatId, messages: ChatMessage[] /* oldest first */, hasMore }`. 403 `forbidden` for a chat the viewer is not in. |
| `POST /v1/chat/send` `{chatId, text, attachments?: [{id}]}` | `202 { message: ChatMessage }` (the viewer's own message, already persisted and streamed). The bot's replies arrive on the stream. 400 `invalid`, 403 `forbidden`, 404 `unknown_attachment`, 429 `rate_limited` (30/min/student). Needs text or an attachment. |
| `POST /v1/chat/upload` (multipart `file`; png, jpeg, webp, gif up to 8 MB) | `{ attachment: ChatAttachment }` owned by the uploader; reference it by id in `send`. 415 `unsupported_type`, 413 `too_large`. |
| `GET /v1/chat/files/:token?st=` | file bytes. Token is 32 hex (128 bit, unguessable); the viewer must be in the chat the file was posted to (uploaders may read their pending uploads). 404 otherwise. `cache-control: private, max-age=3600`. |
| `GET /v1/chat/citation?file=&page=` | `ChatCitationExcerpt {file, page, chapter?, title?, excerpt}`; the page text the citation was verified against (max 700 chars). 404 `not_found`. |
| `GET /v1/chat/stream?st=&lastEventId=` | SSE, per-viewer filtered (below). |

## Stream (SSE)
Same framing as `/v1/squad/stream` (`retry: 2000`, `: ping` every 15 s). The `Last-Event-ID` header (or `?lastEventId=`) is a chat `seq`; the hub replays everything after it that this viewer may see, then goes live, no gaps or duplicates. Gaps in ids are normal.

| `event:` | `data:` | Delivered to |
|---|---|---|
| `chat.message` (id = seq) | `ChatMessage` | group: squad members; dm: that student only |
| `chat.update` | `ChatUpdate` (a confirm card became `answered`/`timeout`) | same audience as the message |
| `chat.typing` | `ChatTyping` (`on:true` while the bot works on a mention or DM, `on:false` when done or after 45 s) | same audience as the chat |
| `chat.resync` | `{ seq }` when `lastEventId` is older than retained history; refetch history | the subscriber |

## Cards (structured, no text parsing in the client)
- `confirm`: `{type:'confirm', taskId, question, options[], status, answer?}` in the student's DM. To answer, `POST /v1/chat/send {chatId: 'dm:<me>', text: '<1-based option number>'}`; the router's confirm manager consumes it (nothing is booked without it). The hub later streams `chat.update` with `status:'answered'` + `answer` or `'timeout'`.
- `quiz`: `{type:'quiz', index, question, input:'choice'|'free', choices?:[{id:'A',text}]}` in the group (or DM). To answer, send the choice id (`A`) or free text to the same chat as an ordinary message (no mention needed while a quiz is active). Feedback comes privately as a DM message. Never any score, XP or streak.
- Per-viewer answered state for quiz cards is the client's own (localStorage keyed by message id).

## Citations and attachments
- Grounded doubt answers carry `citations: [{file, page, label}]` parsed from the verified `[file p.N]` markers; the text keeps the markers so it reads correctly without UI. The client shows chips; a chip opens the excerpt from `/v1/chat/citation`.
- Step Diff: upload an image, send it in the student's DM (`attachments:[{id}]`) while a diff is open (`@cubbie diff` in the group opens one).
- Podcast / explainer: `@cubbie podcast ch3` -> an `audio` attachment (audio/mp4 `.m4a`); `@cubbie picture it ch3` -> an `image` attachment (png). Served from `/v1/chat/files/<token>` with unguessable names.

## Honesty in demo mode
No `GEMINI_API_KEY`: the hub uses a deterministic extractive demo model over the committed OpenStax sample (4 chapters) and fake audio/image engines; every bot message has `demo: true` and the UI must show the `notice` from `/v1/status`. `ELEVENLABS_API_KEY` switches TTS to `elevenlabs`. Keys are never printed or logged.

## Privacy invariants (tested)
1. A student never receives, lists, fetches or is served a file from another student's DM (stream, history, chats, files).
2. Sentinels `$180` and `therapy` (seeded private ledger rows, and any text a student DMs) never reach another viewer through any chat route.
3. Group messages never carry private data; personal skill output goes to the DM only.
