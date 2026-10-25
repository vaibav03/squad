# Spine API (apps/bot), for brain, mesh and media

Source of truth for types: `@squad/core` (Skill, Ctx, InboundMessage, OutboundMessage, Persona, VillageEvent) and `apps/bot/src/types.ts` (spine extras). Your package never imports `@squad/bot`; you only need `@squad/core`.

## 1. Registering a Skill
A Skill is a plain object (`Skill` from `@squad/core`). Export an array from your package:

```ts
// packages/brain/src/skills/index.ts
import type { Skill } from '@squad/core';
export const brainSkills: Skill[] = [doubtSkill, quizSkill /* ... */];
```
The spine registers it with one line in `apps/bot/src/skills/index.ts` (`buildRegistry([chatSkill], brainSkills, meshSkills, mediaSkills)`); the integrator adds that line at merge. Skill names are unique across the repo (duplicate throws at startup). Prefix them by area: `doubt`, `quiz`, `feynman`, `trip`, `podcast`, ...

Contract details:
- `match(m, ctx)` returns 0..1 and must be fast: the router runs every Skill in parallel with a **1.5 s cap**; a throw, NaN or timeout counts as 0 and is logged. Do cheap checks first (regex, mentionsBot); call `ctx.llm` with tier `'fast'` only when needed. No side effects in `match`.
- `handle(m, ctx)` returns the `OutboundMessage[]` to send into `m.chatId` (the router sends them, in order, persona-prefixed). You may also call `ctx.send` / `ctx.dm` yourself for long flows; then return `[]`.
- **Speaking policy** (router, not you): in a group the top Skill runs only if `m.mentionsBot` or best score >= 0.8, and at most one *unprompted* group message per chat per 2 minutes. In a DM the top Skill always runs. Score honestly: 0.8+ means "I am very sure the group wants this unprompted".
- Anything personal goes through `ctx.dm(student, text, attachments?)`, never `ctx.send` to the group.
- Mentions: `@cubbie`, leading `cubbie,` / `hey cubbie`, and every DM set `m.mentionsBot = true`.
- Personas: set `OutboundMessage.personaId`; the text is sent as `"{emoji} {name}: {text}"`. Unknown ids fall back to the default `cubbie` persona.
- Attachments are local absolute paths with a mime (audio as `.m4a`).
- Errors thrown from `handle` are caught, logged and answered with a short apology; never throw to signal "not mine" (return a low score instead).

`BotCtx` (a superset of `Ctx`, the object actually passed): `db`, `llm`, `send`, `dm`, `askConfirm`, plus `memory`, `events`, `log`, `persona(id?)`, `now()`. Cast `ctx as BotCtx` only if you need extras; the type is exported from `apps/bot/src/types.ts` (copy the 6-line shape into your own tests; a published `@squad/bot-types` is not planned).

## 2. Confirm API (`ctx.askConfirm`)
```ts
askConfirm(student: StudentId, question: string, options: string[], taskId: string): Promise<string | 'timeout'>
```
- DMs the student: `question` then a numbered list and `Reply 1, 2 or 3`. Resolves with the **exact option string** chosen. Accepted replies: the number (`2`, `2.`, `#2`), the option text (case-insensitive, trimmed, unique prefix of at least 3 chars or a unique containing word), `yes`/`no` when the options are exactly one yes-like and one no-like. Anything else gets one gentle re-prompt, then is ignored (still pending).
- While a confirm is pending for that student, that student's DMs go to the confirm and **not** to the router.
- Timeout 10 minutes (override `CONFIRM_TIMEOUT_MS`) resolves `'timeout'`; callers must treat it as "no". At most one pending confirm per student; a second `askConfirm` for the same student queues behind the first (FIFO).
- Events, published automatically with your `taskId`: `agent.state {agent:'student:<id>', state:'waiting_for_student'}` + `confirm.pending` before the DM, then `confirm.done` and `agent.state idle` after (also on timeout). **Do not emit these yourself** (one emitter per fact). Never put a withheld value in `question`: the question text is published in the event.
- Rows are persisted in `pending_confirms`; on restart, expired ones are dropped.
- Nothing may be booked, sent or revealed on a student's behalf without an `askConfirm` that returned a non-`'timeout'` yes-like option.

## 3. Transport interface (internal; only the spine and its adapters implement it)
```ts
interface Transport {
  name: 'imessage' | 'discord' | 'cli';
  start(onMsg: (m: InboundMessage) => void | Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(o: OutboundMessage): Promise<void>;     // text and/or attachments
  dmChatId(s: StudentId): ChatId;
}
```
Selected by `TRANSPORT=imessage|discord|cli` (default `cli`). Adapters drop their own messages, map unknown senders to `s_<last4 of handle>`, and rate limit sends to 1/s. `ChatId` for iMessage is the imessage-kit chat id, for Discord the channel id, for the CLI `group:<name>` and `dm:<student>`.

## 4. Fake-chat CLI (use it to test your Skills with no iMessage)
`pnpm --filter @squad/bot chat` starts the real router + policy + confirm on the CLI transport with `FakeLlm` (set `FAKE_LLM=0` and `GEMINI_API_KEY` for real Gemini). Commands: `/as <student>`, `/group <name> <ids...>`, `/dm`, `/script <file>` (run a scripted multi-student session), `/record <file>` (write a replay JSON validated by `@squad/core` `validateReplay`), `/decisions` (print the glass-box log), `/quit`. In code: `createBot({ skills, llm, transport, db })` from `@squad/bot/testing` (headless harness: `bot.say('s_ana', 'group:test', '@cubbie hi')`, `bot.sent`, `bot.events`, `bot.answerConfirm(...)`).

## 5. Memory
`ctx.memory.get/set/delete/list(scope: 'student'|'chat', scopeId, key)`, JSON values, backed by the `memory` table (UNIQUE(scope, scope_id, key)). Namespace your keys (`brain.chapter`, `mesh.availability`).

## 6. Village events from the spine
`agent.state` (`studying` while a Skill runs, per `agent: 'student:<from>'`, `idle` after), `confirm.pending/done`. Quiz (`quiz.*`) and call events from other packages are posted by those packages through `postEvent` from `@squad/core` directly; the spine does not proxy them. Every decision (scores, chosen skill, spoke or not, reason) is stored in `messages.decision_json` and logged.
