# 02 · Spine: iMessage bot + core (draft for approval)

Owner: build agents A–F below. Conforms to `00-OVERVIEW.md` contracts (one small contract addition, see Decision 3).

## Summary
One Node process (`apps/bot`) watches this Mac's Messages database with Photon `imessage-kit`, turns each new message into an `InboundMessage`, asks every registered Skill for a score, and either stays quiet or sends a reply. `packages/core` holds what every other workstream imports: types, SQLite, the Claude client, config, logging, and the `Ctx` (send, dm, askConfirm). A **fake-chat CLI** drives the exact same router from the terminal, so workstreams 03–06 never need iMessage to test. Verify iMessage works on this Mac (macOS 27) first; if it fails, switch to the Discord adapter, which plugs into the same router.

## Scope
**In:** iMessage listener + sender (groups and DMs), `@cubbie` mention detection, Skill router, speaking policy, DM-based `askConfirm`, persona-tagged sends, SQLite (students, chats, messages, memory), Claude client with prompt caching, `.env` config, logging, fake-chat CLI, Discord fallback adapter (built either way, as a tested fallback), Village event publishing (see Village support).
**Out:** the Skills themselves (03, 04, 05), the Hot Mic "inner thoughts" queue (a Skill in 03/05 can own it; the spine just logs every score so it's possible), web pages (06), creating group chats (the SDK can't; a human creates the group).

## Key design
```
 iPhones ──iMessage──▶ Messages.app on this Mac (bot Apple ID)
                              │ chat.db (polled by imessage-kit)
 Discord (fallback) ──┐       ▼
 fake-chat CLI ───────┼──▶ Transport adapter ──▶ normalize → InboundMessage
                      │                              │ save to SQLite
                      │                              ▼
                      │                  Router: score all Skills (parallel, 1.5 s cap)
                      │                              │
                      │                  Speaking policy: mentioned? best ≥ 0.8? group or DM?
                      │                              │ (quiet → log score, stop)
                      │                              ▼
                      └──◀── Transport.send ◀── best Skill.handle(m, ctx) → OutboundMessage[]
```
- **Transport interface** (internal to 02; the only thing that differs between iMessage, Discord and the CLI):
  `interface Transport { start(onMsg: (m: InboundMessage) => void): Promise<void>; send(o: OutboundMessage): Promise<void>; dmChatId(s: StudentId): ChatId }`
- **iMessage facts (verified):** package `@photon-ai/imessage-kit` + `better-sqlite3` on Node ≥ 20; `sdk.startWatching({ onGroupMessage, onDirectMessage })`; message has `chatId, text, participant, isFromMe, attachments, createdAt`; `sdk.send({ to: chatId | phone, text, attachments: ['/abs/path'] })` works for groups using a chatId from `sdk.listChats({ kind: 'group' })`. Attachments must be local absolute paths (audio goes as a file, e.g. `.m4a`). Only one watcher per process. `send()` resolves when AppleScript exits, with no delivery receipt. No tapbacks, threaded replies or edits (those need paid Photon Spectrum). It can't create groups. [README](https://github.com/photon-hq/imessage-kit), [npm README v3](https://cdn.jsdelivr.net/npm/@photon-ai/imessage-kit@3.0.0/README.md)
- **macOS 27 risk:** macOS 26 moved message text into the binary `attributedBody` column; imessage-kit decodes it (regex, then `plutil` fallback), but nobody has published a macOS 27 result. That's what the iMessage verification gate checks. [issue writeup](https://claudeissues.com/issue/41783-imessage-channel-plugin-messages-not-detected-on-macos-26-text-column-is-null), [Photon tech overview](https://photon.codes/blog/frontier-agent-interaction-on-imessage-tech-overview)
- **Mentions:** iMessage has no real @-mention for a bot, so `mentionsBot` = case-insensitive match of `@cubbie` or a leading `cubbie,`/`hey cubbie`. Every DM to the bot counts as a mention.
- **Ignore own messages:** drop `isFromMe` (stops the bot replying to itself).
- **Speaking policy (from 00 + Hot Mic research):** in a group, run the top Skill only if `mentionsBot` or its score ≥ 0.8; otherwise log "stayed quiet (best=skill, 0.41)". In a DM, always run the top Skill. A Skill that wants to say something personal calls `ctx.dm`, never `ctx.send` to the group. Limit: at most 1 unprompted group message per chat per 2 minutes. Every decision is written to `messages.decision_json` so the web "brain panel" (06) and Hot Mic can show it. [DiscussLLM](https://arxiv.org/abs/2508.18167)
- **Fallback Skill:** a built-in `chat` Skill scores 0.5 when mentioned and answers with Sonnet, so `@cubbie hi` always gets a reply even before 03 lands.
- **askConfirm:** `Ctx.askConfirm(student, question, options, taskId): Promise<string | 'timeout'>` (00 contract). DM the student `question` + numbered options ("Reply 1, 2 or 3"); `taskId` ties the prompt to its `confirm.pending`/`confirm.done` events. Resolve with the first DM from that student that matches a number or option text (case-insensitive). While a confirm is pending, that student's DMs go to the confirm and not the router. Timeout 10 min → resolves `'timeout'` (callers treat as no).
- **Personas:** `OutboundMessage.personaId` → text is prefixed `"{emoji} {name}: "` (one Apple ID can't change its sender name). Personas come from 05; core ships a default `cubbie` persona.
- **Claude client (`Llm`):** thin wrapper over `@anthropic-ai/sdk`: `complete({ model, system, messages, cache?: string[] , json?: zodSchema })`. Large stable blocks (persona prompt, a chapter) are passed as system blocks with `cache_control: { type: 'ephemeral' }` so repeats are cheap. Model aliases: `fast` = `claude-haiku-4-5-20251001`, `main` = `claude-sonnet-5-5`, `chair` = `claude-opus-5-5`. Retries once on 429/529. [Prompt caching docs](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)
- **Discord fallback:** `discord.js` client with `Guilds`, `GuildMessages`, `DirectMessages`, `MessageContent` intents (MessageContent must be enabled in the Developer Portal). Channel id = `ChatId`, real `@Cubbie` mentions set `mentionsBot`, `user.send()` for DMs. Same Skills, no code changes. [discord.js guide](https://discordjs.guide/popular-topics/intents.html)

## File layout
All paths are relative to the `app/` workspace root (`cubbie-re/app`).
```
packages/core/src/  types.ts (00 contracts verbatim) · config.ts (zod-parsed .env) · log.ts (pino → stdout + logs/bot.log)
                        db.ts (schema + helpers) · llm.ts · personas.ts (default cubbie) · index.ts
apps/bot/src/       main.ts (picks transport from TRANSPORT=imessage|discord|cli) · router.ts · policy.ts
                        ctx.ts (send/dm/askConfirm) · skills/chat.ts · skills/index.ts (registry: other workstreams add one line)
                        transports/imessage.ts · transports/discord.ts · transports/cli.ts
apps/bot/fixtures/  students.json (demo roster: id, name, phone) · chats.json (group chatIds after setup)
```
Run with `tsx` like `apps/mock`. Scripts: `pnpm --filter @nook/bot dev` (iMessage), `pnpm bot:chat` (fake chat).

## DB schema (SQLite, `data/cubbie.db`)
```sql
students(id TEXT PK, name TEXT, handle TEXT UNIQUE, persona_id TEXT, voice_id TEXT, avatar_url TEXT, created_at INT)
chats(id TEXT PK /*ChatId*/, is_group INT, name TEXT, transport TEXT, settings_json TEXT)
chat_members(chat_id TEXT, student_id TEXT, PRIMARY KEY(chat_id, student_id))
messages(id INTEGER PK, chat_id TEXT, from_id TEXT /*StudentId or 'bot'*/, text TEXT, attachments_json TEXT,
         mentions_bot INT, persona_id TEXT, decision_json TEXT /*scores, chosen skill, spoke?*/, ts INT)
memory(id INTEGER PK, scope TEXT /*'student'|'chat'*/, scope_id TEXT, key TEXT, value_json TEXT, ts INT, UNIQUE(scope, scope_id, key))
pending_confirms(id INTEGER PK, student_id TEXT, question TEXT, options_json TEXT, answer TEXT, expires_at INT)
```
Unknown senders get auto-created as `s_<last4 of phone>` so nothing crashes on a new number. Other workstreams add their own tables in their own packages.

## Setup the user must do
1. Sign this Mac's Messages.app into a **spare Apple ID** (not your personal one) and send it one test message from your phone.
2. System Settings → Privacy & Security → **Full Disk Access** → add the terminal app you'll run the bot from (Terminal/iTerm/Superset). Restart that terminal.
3. On first send, macOS asks to let the terminal **control Messages** (Automation): click Allow.
4. Create a group chat on your iPhone with the bot's Apple ID + 1–2 friends/second device; name it "Cubbie Test".
5. Put `ANTHROPIC_API_KEY` in `.env`. (Discord only if needed: create a bot, enable Message Content intent, invite to a test server, put `DISCORD_TOKEN` in `.env`.)
6. Keep the Mac awake during demo (`caffeinate -dis`).

## iMessage verification gate
Verify iMessage works on this Mac (macOS 27) first. Run `pnpm --filter @nook/bot dev` and check all five: (1) the "Cubbie Test" group appears in `listChats`, (2) a group message shows up in the log within 5 s with correct text (the macOS 27 check), (3) `@cubbie hi` gets a reply in the group, (4) the bot DMs you and `askConfirm` reads your "1", (5) an image and an `.m4a` arrive on the iPhone. Pass = 1–4 (5 can be fixed later). If it fails, switch to the Discord adapter (`TRANSPORT=discord`); nothing else changes. Ticket F is built either way.

## Build tickets (parallel agents)
| # | Ticket | Est (ordering only) | Depends on |
|---|---|---|---|
| A | `packages/core`: types.ts, config, log, db schema + helpers, default persona | 30 min | none (start first) |
| B | `llm.ts`: Claude wrapper, model aliases, caching, JSON mode via zod, retry | 30 min | A's types (can stub) |
| C | `apps/bot` router + policy + ctx (send/dm/askConfirm/personas) + `chat` skill + CLI transport + fake-chat REPL (`/as ana`, `/group`, `/dm`) | 60 min | A, B |
| D | iMessage transport: watch, normalize, mention detect, send text/attachments, DM by handle, roster from fixtures | 45 min | A (types only); joins C |
| E | Smoke tests (vitest, CLI transport, mocked LLM) | 20 min | C |
| F | Discord transport, tested fallback (built either way) | 45 min | C |
| V | Village support: `agent.state` around Skill runs, `confirm.pending`/`confirm.done` (with `taskId`), quiz/call passthrough, all posted to the hub's `/internal/events` through the one helper in `packages/core`; CLI `/record <file>` writes a replay-format script | 45 min | C, 00 event schema, hub (06) |

A + D start at once; B in parallel; C right after A; F and V after C.

## Village support
The bot/hub publishes `VillageEvent` items (00 contract) to the hub (06) when the router handles messages. Withheld values never appear, only the label and "hidden".
- `agent.state` changes as the router runs a Skill (`studying` while handling, `waiting_for_student` during a confirm, back to `idle`).
- `confirm.pending` / `confirm.done` around every `askConfirm` (with `taskId` and `question`).
- Transport: every event is POSTed to the hub at `/internal/events` (header `X-Nook-Internal`) through the single helper in `packages/core`; the zod schema lives there too. Ticket V owns this.
- Quiz (`quiz.*`) and call (`call.*`) events from other packages are passed through to the hub unchanged.
- The fake-chat CLI can record a session as a JSON event script in the replay format (the same `VillageEvent` list, with timestamps) via a `/record <file>` command, so Replay looks identical to Live.

## Smoke tests
1. CLI: group message without mention, `chat` skill only → bot stays quiet, decision logged.
2. CLI: `@cubbie hi` → one reply; a stub Skill scoring 0.85 → speaks unprompted; second unprompted within 2 min → quiet.
3. askConfirm: answer "2" or the option text → returns that option; no answer → `"timeout"`.
4. Persona send → text prefixed with emoji + name. `isFromMe` messages ignored.
5. LLM: second identical call shows `cache_read_input_tokens > 0` (manual, one real call).
6. Village: a confirm emits `confirm.pending` then `confirm.done`; a recorded CLI session replays to the same event list.

## Risks and fallbacks
| Risk | Fallback |
|---|---|
| imessage-kit can't read text on macOS 27 | Discord (F); demo video uses Discord or the CLI |
| Detection lag from polling chat.db | Fine for demo; keep the Mac awake and on Wi-Fi |
| Send succeeds silently but nothing arrives (no receipt) | Log every send; check the iPhone during the verification gate |
| Messages from SMS/green-bubble friends | Demo with iMessage users only |
| Apple flags the spare Apple ID for bot-like volume | Rate limit ≤ 1 msg/s, keep the demo small |
| Audio arrives as a file, not a voice-memo bubble | Acceptable; say "tap to play" in the demo |

## Decisions for you
1. **Mention trigger:** `@cubbie` plus "hey cubbie"/"cubbie," at the start? *Recommend yes* (people won't type @ in iMessage).
2. **Unprompted threshold:** 0.8 as in 00, plus a 1-per-2-min cap per group? *Recommend yes.*
3. **askConfirm timeout:** 10 min, returns `"timeout"` (treated as no)? *Recommend yes.* `'timeout'` is part of the 00 contract's `askConfirm` return type (`string | 'timeout'`).
4. **Persona display:** prefix text with `emoji Name:`? *Recommend yes* (the only option with one Apple ID).
5. **Discord adapter:** build it as a normal ticket either way, as a tested fallback? *Recommend yes.*
6. **Student roster:** a hand-written `fixtures/students.json` for the demo, with onboarding from the web (06) later? *Recommend yes.*
