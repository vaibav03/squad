# Proactive features

Squad does not only answer when asked. Four behaviors speak, or schedule themselves, on their own. All of
them obey the speaking policy (docs/spine-api.md), and none of them can spam.

Code: scheduler in `apps/bot/src/scheduler/**`; skills, handlers and pure logic in
`packages/brain/src/skills/{catchup,nudges,pact}/**`; contract between them in `nudges/api.ts`
(`ProactiveApi`). Fixture: `packages/brain/fixtures/nudges/multiday.json`.

## Scheduler

Durable sqlite jobs (`sched_jobs`), cron-like (5 fields, evaluated in the student's time zone) and one-shot.

- **Idempotency**: every job has a unique `key`; scheduling it again returns the existing job. Sends carry a
  `dedupe` key stored in `sched_sends`; a retry or a restart never sends the same message twice. A cancelled
  key can be scheduled again.
- **Retries**: a throwing handler is retried with 30 s, 60 s, ... backoff (cap 1 h) up to `maxAttempts`, then
  `failed`. A cron job that fails moves on to its next occurrence. A job whose runner died (lease expired) is
  reclaimed.
- **Missed runs** (`missed`): `run_once` (default) runs once on restart and then continues from now (three days
  of missed cron fires collapse to one); `skip` drops a run that is later than `graceMs` after its due time,
  including time spent deferred.
- **Time zones and DST**: a local time that does not exist (spring forward) fires shifted forward by the gap;
  one that occurs twice (fall back) fires once, at the first occurrence. Tested for America/New_York.
- **Delivery gate** (the only way a handler may speak, `deliver` / `ask`), checked in this order: duplicate,
  opted out (drops everything), not opted in (study nudges), snoozed (deferred to the snooze end), quiet hours
  (default 22:00-08:00 in the student's zone, deferred to 08:00), global limit (6 per rolling minute),
  per-student minimum gap (20 min) and daily cap (4 per rolling 24 h). Group messages additionally need an
  opted-in member, respect the 120 s unprompted cooldown (including the router's own) and a daily cap of 3.
  Anything held back is re-queued automatically; nothing is lost and nothing is bursty.
- **Persona**: every message goes through `ctx.dm` / `ctx.send`, so it is prefixed `🐻 Cubbie: `.
- **Scope**: personal things are DMs (`ctx.dm` or `askConfirm`); group messages are for squad things only.

Chat controls (addressed to the bot, in a DM or with `@cubbie` in a group; the reply is always a DM):
`snooze 2h` (also `30 min`, `1 day`, `until tomorrow`), `unsnooze`, `stop nudges`, `start nudges` / `nudge me`,
`nudge status`, `my timezone is PT` (or an IANA name). Three unanswered nudges in a row auto-snooze a student
for 3 days.

Admin and debug:

```
pnpm bot:scheduler list [--student s_ana] [--status pending]
pnpm bot:scheduler run <id|key>          # make it due now; the live bot runs it on its next tick
pnpm bot:scheduler run <id|key> --here   # execute locally with a printing ctx, nothing is sent
pnpm bot:scheduler cancel <id|key>
pnpm bot:scheduler prefs <student|chat>
pnpm bot:scheduler sends [n]
pnpm bot:chat      # fake-chat CLI: /jobs [student] lists jobs, /tick runs due ones
```

Tests use a virtual clock: `createSchedulerHarness` (`scheduler/testing.ts`) for unit tests and `createTestBot`'s
clock for end to end (`scheduler/proactive.test.ts`).

## Catch Me Up (`catchUp`)

`@cubbie catch me up`, `what did I miss`, `tldr`, `summarize the chat`. Summarizes topics, decisions, open
questions and who owes what since the asker's last message (or the last 20 messages when it is quiet; also
`last 2 hours`, `last 50 messages`). The `fast` tier returns JSON; every item must cite message ids that are in
the window, else it is dropped. If the model fails, a deterministic extractive digest is used. Output has
footnote markers `[1]` and a Sources block (sender, UTC time, quote); the structured result with message ids is
saved in chat memory `catchup.last` so a UI can link them. With 40 or more unread messages, a plain greeting to
the bot gets an offer instead (at most once per 6 h).
**Privacy**: reads only the one group chat's rows; never `dm:` chats, never other groups; the asker must be a
member; chat text is passed to the model as untrusted data. Tested with sentinels.

## Study nudges (`nudges`)

Opt-in only (`start nudges`, or `setup.nudges = true` in student memory from the setup flow). A student who never
opted in is never nudged; `stop nudges` stops every proactive message, including pact reminders.
- 9 pm local: "Due tomorrow: ..." from syllabus lines (`importSyllabusText`), imported .ics (`importIcsDue`) and
  the hub's `hub_busy_blocks`. Silent when nothing is due. Course-wide items are shared; calendar items belong to
  that student alone.
- 6 pm local: "3 chapters are due for review (...): want a 5-minute quiz?" from Leitner `nextDue`, asked with
  `askConfirm` (1 Yes, quiz me / 2 Later / 3 Stop reminders).
- Exam countdown: DM at 9 am local at T-7, T-3 and T-1 days, with the student's own weakest chapters.
**Privacy**: only the target student's mastery rows are read; messages go to that student's DM.

## Pinky Promise (`pact`)

`@cubbie pinky promise: I will finish ch6 by Friday`. The bot replies in the chat with one line that does not
repeat the task, DMs the owner to lock it in (numbered options), reminds 24 h and 2 h before, and checks in 1 h
after (Done / Need 24 more hours (once) / Drop it). `my promises` and `cancel my promise` work on your own only.
**No public shaming**: no pact handler ever calls `ctx.send`; a miss or an unanswered check-in is recorded and
never mentioned in a group (tested).

## Known gaps

- "Yes, quiz me" DMs the one-line command unless `startQuiz` is wired to the quiz engine (`createProactive`).
- The 40-unread offer is triggered by a greeting to the bot; the bot never interrupts a group on its own.
- Citation timestamps are UTC.
