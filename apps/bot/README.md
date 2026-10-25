# @squad/bot: the spine

The iMessage bot every other feature plugs into: transports (iMessage, Discord, fake-chat CLI), router, speaking policy, DM confirmations (`askConfirm`), memory, persona-tagged sends, Village event publishing and replay recording. API for other workstreams: `docs/spine-api.md`.

## Run

```bash
pnpm install
pnpm --filter @squad/bot chat                 # fake-chat REPL, FakeLlm when no GEMINI_API_KEY (or FAKE_LLM=1)
TRANSPORT=imessage pnpm --filter @squad/bot dev   # real iMessage (after the owner steps below)
TRANSPORT=discord  pnpm --filter @squad/bot dev   # fallback, see DISCORD.md
pnpm --filter @squad/bot exec tsx src/main.ts --dry-run   # print redacted config, connect nothing
pnpm test:smoke bot                           # smoke tests (4-person session, confirm, replay)
pnpm --filter @squad/bot test                 # unit, property and adversarial suites
```

Env: `TRANSPORT` (cli default), `FAKE_LLM=1`, `STUB_SKILLS=1` (adds demo skills: unprompted-quiz, confirm-demo, crasher), `GEMINI_API_KEY` (+ optional `GEMINI_MODEL_*`), `HUB_BASE_URL`, `INTERNAL_EVENTS_SECRET`, `DB_PATH` (default `data/squad.db` under apps/bot), `CONFIRM_TIMEOUT_MS`, `LOG_LEVEL`, `DISCORD_TOKEN`. Secrets are read from `.env` and never logged (logger redacts `*key*`, `*secret*`, `*token*`).

### Internal confirm endpoint

`POST http://127.0.0.1:$BOT_PORT/internal/confirm` (default port 8790, started by `main.ts` for every transport) lets standalone agents ask a student to confirm. Header `X-Nook-Internal: $INTERNAL_EVENTS_SECRET` (else 401). Body `{ "student": "s_ana", "question": "...", "options": ["Yes","No"], "taskId": "t1" }`; replies `{ "answer": "Yes" }` or `{ "answer": "timeout" }` after 10 min. Details in `docs/spine-api.md`.

### Fake-chat REPL

`/as <student>`, `/group <name>`, `/dm`, `/script <file>` (see `fixtures/scripts/*.json`), `/record <file>` ... `/record stop` (writes a replay JSON validated by `@squad/core`), `/checkpoint <name>`, `/decisions [n]` (glass-box: every skill score, the chosen skill, why it spoke or stayed quiet), `/help`, `/quit`. `@cubbie ...` or `cubbie, ...` mentions the bot; every DM does.

### Multi-skill session (`pnpm bot:chat`)

`pnpm bot:chat` (root alias for `pnpm --filter @squad/bot chat`) starts the fake-chat REPL. Registered skills: chat, doubt, behind, hwpolicy, quiz, feynman, stepDiff, studyPlan, podcast, explainer, all on one shared emit, db and mastery store (`src/skills/index.ts`, `createSkills`). The LLM is `GeminiLlm` when `GEMINI_API_KEY` is set, otherwise `FakeLlm`; podcast and explainer use `FakeTts` and `FakeImageGen` in fake mode (ffmpeg and ffprobe on PATH needed for podcasts), real ElevenLabs when `ELEVENLABS_API_KEY` is set. Without a TTS engine in real mode those two skills are not registered (the bot says so at startup).

Run the scripted demo session from `apps/bot`: a doubt answered with a verified citation, a three-student quiz round, a private "am I behind?" (group sees only "Sent you a DM."), and a personal podcast delivered by DM with an audio attachment.

```bash
cd apps/bot && pnpm chat      # then at the prompt:
/script fixtures/scripts/multi-skill.json     # runs on scripted FakeLlm + FakeTts, no keys
pnpm test:smoke bot           # same session asserted: events valid, quiz key/explanation and other students' data never reach the group, events or another DM
```

Quiet-group guarantee: `src/adversarial/registry.adversarial.test.ts` runs 50 banter lines through the full registry; no skill scores >= 0.8 and the bot sends nothing.

### Speaking policy

Group: speak if mentioned, or if the best Skill scores >= 0.8 and no unprompted message went out in that chat in the last 2 minutes. DM: always run the top Skill. A pending `askConfirm` consumes that student's DMs. Every decision is stored in `messages.decision_json` and logged.

## iMessage setup (owner steps)

The bot cannot do these for you (they need your Apple ID and macOS permission dialogs). Do them in order; the script tells you which step failed.

1. **Spare Apple ID.** Use a spare Apple ID, never your personal one. Never put its password in this repo or `.env`. Open Messages.app on this Mac, sign in with the spare ID (Messages > Settings > iMessage), and confirm "You can be reached for messages at" shows it.
2. **Wake it up.** From your own phone, send the spare ID one iMessage (a plain text). Reply from the Mac once so the thread exists.
3. **Full Disk Access.** System Settings > Privacy & Security > Full Disk Access > add the exact terminal app you will run the bot from (Terminal, iTerm, or Superset), switch it on, then **quit and reopen that terminal**. Without this the bot cannot read `~/Library/Messages/chat.db`.
4. **Automation.** The first time the bot sends, macOS asks to let the terminal control Messages. Click Allow (System Settings > Privacy & Security > Automation if you missed it).
5. **Create the group.** On your iPhone, create a group iMessage with the spare Apple ID and 1-2 friends (or a second device) named exactly `Cubbie Test`, and send one message in it. (The SDK cannot create groups.) Use iMessage (blue) contacts only.
6. **Roster.** Put the real phone numbers or emails in `apps/bot/fixtures/students.json` (`[{ "id": "s_ana", "name": "Ana", "handle": "+1..." }]`). Handles that are not in the roster still work: the sender becomes `s_<last4>`.
7. **Keep it awake** during the demo: `caffeinate -dis`.

### Verify (the gate)

```bash
pnpm exec tsx scripts/verify-imessage.ts --dry-run --yes        # rehearse: simulated Mac, no permissions, nothing sent
pnpm exec tsx scripts/verify-imessage.ts --dry-run --simulate-fail=text   # shows the macOS 27 failure path (also: send, attachment, permission)
pnpm exec tsx scripts/verify-imessage.ts --group "Cubbie Test" --to +15551234567   # the real thing
```

It runs: 0 preflight (macOS, Full Disk Access), 1 group listed, 2 your group text decoded within 5 s (send `verify 123` when asked), 3 a reply sent (you confirm you saw it), 4 DM round trip (reply `1`), 5 image + `.m4a` (warn only). Exit 0 means checks 0-4 passed. Next step printed at the end.

| Result                 | Meaning and fix                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FAIL 0                 | Full Disk Access missing for this terminal. Add it, restart the terminal.                                                                                  |
| FAIL 1                 | Group name differs or the bot Apple ID has not received a message in it. Send one, or pass `--group`.                                                      |
| FAIL 2 "text is empty" | macOS stores message text in the binary `attributedBody` column and imessage-kit could not decode it on this macOS version. Switch to `TRANSPORT=discord`. |
| FAIL 3                 | Send ran but you did not see it: Automation permission, or Messages not signed in.                                                                         |
| FAIL 4                 | DM not read: wrong `--to`, or you did not reply in time (`--timeout 120`).                                                                                 |
| WARN 5                 | Attachments are best-effort; fix later, audio arrives as a file ("tap to play").                                                                           |

If it fails, nothing else changes: set `TRANSPORT=discord` (`DISCORD.md`).

### What is verified and what is not

Verified here with mocks and the dry run: normalization (group, DM, attachments, null text, own messages, reactions), mention rules, send validation, 1 msg/s limiter, the verification script flows and exit codes. Typings of `@photon-ai/imessage-kit@3.0.0` were read directly (differences from the spec: `chatId` can be null, there is `onIncomingMessage`, attachments expose `localPath`/`mimeType`, reactions arrive as rows). **Not verified:** a real send/receive on macOS 27 and its text decoding. That is exactly what `verify-imessage.ts` proves once you do steps 1-5; if the model ids in `@squad/core` are stale, that is a one-line `GEMINI_MODEL_*` change.

## Web transport (`src/transports/web.ts`)

The third transport next to iMessage and Discord. The hub mounts it in process (`apps/hub/src/chat/engine.ts`), so web messages go through the same router, speaking policy, confirm flow and skills. Group chat ids are `group:<squadId>`, DMs `dm:<studentId>`. `@squad` is an alias of `@cubbie`. Structured output: the persona prefix is stripped (the UI shows the persona), `(file p.N)` citations are normalised to `[file p.N]` and listed, quiz text becomes a quiz card, and confirms use the optional `Transport.confirmPrompt/confirmResolved` hooks (a card instead of numbered text). Demo model for no-key runs: `src/demo/`. See `docs/chat-api.md`.
