# Shared study plan

One squad-scoped, versioned plan object lives in the hub. Chat, the village panel and REST all read and write that one object, so the group always sees the same plan. No points, streaks or rankings: progress is plain counts and words.

Code: contract `packages/core/src/plan.ts`; hub `apps/hub/src/plans/{logic,service,store,routes,context,port}.ts`; chat skill `apps/bot/src/plan/{skill,port,nudges}.ts`; web `packages/web/src/overlays/plan/`; village landmark `packages/village/src/scenes/plan.ts`.

Chat entry points: `@cubbie study plan for the exam on <date>`, and `@planner study plan ...` (the planner persona routes plan intents: `study plan` starts this flow, `trip` starts the trip flow in docs/trip-planning.md; other `@planner` messages stay a persona answer).

## Object model

`Plan` (table `hub_plans`, one JSON row, written through on every change)

| Field | Meaning |
| --- | --- |
| `id`, `squadId`, `courseId`, `title` | A plan belongs to exactly one squad. Other squads get 404. |
| `status` | `proposed`, `active`, `cancelled`, `failed` |
| `organizerId` | The student who asked. Can confirm, cannot decline (cancel instead). |
| `examDate`, `examLabel` | Exam day (`YYYY-MM-DD`) from the request or the course's exam due item. Countdown is derived, never stored. |
| `rev` | Bumps on every accepted change. |
| `items[]` | `id, ownerId, ownerName, kind (review/teach/practice), title, chapter, topic, date, durationMin, status (todo/done), rev, sources[]`. `item.rev` is the plan `rev` at which that item last changed. |
| `members[]` | `id, name, optedIn, response (pending/accepted/declined)` |
| `conflicts[]` | `theirs` and `mine` versions of one item, `open` or `resolved` |
| `citations[]` | Course files and pages, and due items the plan was built from |
| `generator` | `mode` is `live`, `degraded` or `demo`, with a plain note. The web badge shows this. |
| `error` | Present when `failed` |

`PlanView` is what one viewer gets. It adds `countdown`, `progress` (plain words), `load` (per member: item count, done, minutes), `availability` and `myWeakTopics`.

## Conflict rule

Optimistic version check per item.

1. Every edit sends `baseRev`, the plan `rev` the editor last saw, and a patch (`ownerId`, `date`, `durationMin`, `title`, `topic`).
2. If `item.rev <= baseRev` the edit applies, plan `rev` and `item.rev` bump, and the change is logged.
3. Edits to different items never conflict, even with an old `baseRev`. They merge.
4. If another edit changed the same item since `baseRev` (`item.rev > baseRev`) the edit is not applied. The hub answers 409 and records a conflict holding both versions: `theirs` (what is on the item now) and `mine` (the losing patch applied on the version it was based on). Nothing is overwritten.
5. While a conflict is open on an item, further edits to it are refused (`conflict_open`).
6. Any opted-in member resolves it with `pick: theirs | mine`. The picked version is applied, `rev` bumps, the conflict closes.
7. Declining members have their items shared out among the others (load balance by minutes).

The village panel shows a conflict banner with both versions and a pick-one action. The conflict, the pick and every other decision is also said in the group chat in plain text.

## Flow

### Chat

In a group: `@cubbie study plan for the exam on Nov 4` (also `@squad`; extra aliases come from the shared mention parser on `feature/typed-mentions`, through the bot's `mentionsBot` flag).

1. Cubbie posts a progress line at once ("On it. Building a shared study plan...").
2. The skill calls the hub plan service with a 20 s guard. The hub builds the plan from course chapters, course-wide due items and each member's busy/free days. It posts ONE plan card for the group: summary per member, exam countdown, sources, reply help.
3. Any failure (bad date, no materials, exam in the past, timeout, exception) is a plain sentence in the group. The group never stays on "thinking".
4. The asker also gets a DM with their own detail (busy overlaps, own weakest chapters). Nobody else's mastery or calendar detail appears in the group, only aggregates.
5. Replies, with or without the mention while a plan waits: `plan 1` accept, `plan 2` decline, `plan 3 ch6 to dev` or `plan 3 ch6 to Nov 8` edit, `plan 4` organizer confirms and starts, `show plan`.
6. The plan activates when every opted-in member accepted, or the organizer confirms.
7. `done ch6 review` marks the sender's own item done (organizer may mark any). Progress is posted as words ("3 of 9 items done").

In a DM Cubbie points to the squad chat; study plans are shared.

### Web

Village planning table (landmark, no nav tab), docked like the mastery panel. Deep link `/squad/village?plan=1`. The panel shows countdown, status, progress, a live/degraded/demo badge, load per member, the day timeline with owners, accept/decline/confirm, edit item (date, owner, minutes), done, conflict banners, your own weak chapters and the sources. Chat plan cards link to it.

### REST

`GET /v1/plans/current`, `GET /v1/plans/:id`, `POST /v1/plans`, `POST /v1/plans/:id/respond`, `PATCH /v1/plans/:id/items/:itemId` (`{baseRev, patch}`), `POST /v1/plans/:id/conflicts/:cid/resolve`, `POST /v1/plans/:id/confirm`, `POST /v1/plans/:id/cancel`, `POST /v1/plans/:id/items/:itemId/done`. All require a squad viewer. Mutations return the new `PlanView`; failures carry `error.code` and, for conflicts, the conflict.

## Privacy

- Busy/free only: the plan context reads start and end of calendar blocks. Titles never leave the calendar store.
- `availability.squad` is an aggregate (free count per day) and is null below the minimum group size.
- `myWeakTopics` and busy-overlap flags are the viewer's own only. Other members' boxes are used to pick strengths when assigning chapters, never copied into the plan.
- Group messages contain plan facts any member can see. Private lines go to the member by DM.
- Deleting an account removes the student from plans (`forgetStudent`).

## Nudges

`registerPlanNudges` (bot) registers `plan.item` and `plan.pending` on the existing scheduler (`docs/proactive.md`); the hub engine wires it when the scheduler runs (`HUB_SCHEDULER=1` or iMessage enabled). Jobs follow the plan on every change and are cancelled when it is cancelled or an item is done.

- All DM only, all `requiresOptIn`, so snooze, quiet hours and per-day caps apply through the scheduler's delivery gate.
- `plan.pending`: when a proposal waits on you, now and again after 24 h.
- `plan.item`: 9:00 in the member's timezone on the item's day, skipped when the item was done, moved or reassigned.

## Group thread mirror

Every decision, update and failure becomes a plain-text bot message in the squad's group chat (`deps.plans.post`, a hub chat event). The iMessage sync layer mirrors group chat events; this feature has no iMessage code.

## Context seeds (feature/nook-parity)

`deriveStudySeeds(store, viewer, now)` there returns `{kind: 'due'|'lecture', title, dueAt, courseId, sourceUri}`. It maps onto the plan like this: a `due` seed becomes a `PlanSource` of kind `due` (label `title: date`) and may set the exam date when its kind is exam; a `lecture` seed becomes a `material` source (file from `sourceUri`) and a chapter candidate. That branch is not on main yet, so the default context (`apps/hub/src/plans/context.ts`) reads the course store and `due_items` table. When it lands, implement `PlanContext` over the seeds; nothing else changes.

## Tests

- Hub: `apps/hub/test/smoke/plan.smoke.test.ts` (create, accept, edit, merge, conflict, pick, confirm, done, cross-squad isolation, sentinels `$180` and `therapy`), `plan-chat.smoke.test.ts` (group request, progress then card, numbered replies, done, bad date), `plan-nudges.smoke.test.ts`.
- Bot: `apps/bot/src/plan/skill.test.ts` (fake port: progress first, timeout and exception end in a message, routing).
- Web: `packages/web/src/overlays/plan/plan.test.tsx`, `packages/web/src/pages/chat/Chat.test.tsx` (plan card).
- E2E: `e2e/specs/j22-study-plan.spec.ts` (three students, chat and village panel).

## Known gaps

- The fallback generator is deterministic (chapter assignment plus busy-day avoidance). It is only used when no real model answers or the planner agent fails, and it is always labelled `Fallback sample plan`.
- Study times are whole days, not hourly slots from mesh agents.
- One open plan per squad; a new proposal by the organizer replaces it.
- Declining members' items are shared out evenly, with no negotiation step.

## Planner agent, badge and surface (fix/provenance-plan-sync)

**Who writes the plan.** When a real Gemini key works, `POST /v1/plans` and `@cubbie study plan ...` call the planner agent (`apps/hub/src/plans/planner.ts`): ONE grounded call on the RAW real model (never the resilient demo wrapper) with the viewer-scoped context the hub already gated: chapters with the text of each chapter's first page, course due items, the organizer's own Canvas/Google items from the context store (`deriveStudySeeds`), and PRIVATE per-member hints (weak/strong chapters, busy days, as ids only). The model proposes items with owners, dates, a one-line `why`, a verbatim `quote` and `page`, and a written `rationale`. Code disposes: unknown chapters dropped, owners must be members, dates clamped to tomorrow..exam-1 and moved off the owner's busy day, a quote that is not verbatim on the cited page loses its source (never shown as verified), private words (mastery, weak, busy, calendar...) are stripped from `why` and `rationale`, and a plan that covers fewer than two chapters throws so the fallback runs.

**Badge.** `plan.generator = {kind: 'agent'|'fallback', mode: live|degraded|demo, reason?, model?, usage?}`; `planBadge()` in core gives the words: `Live`, `Degraded: <reason>`, `Demo: sample data, scripted`, plus `Planner agent` or `Fallback sample plan`. The chat card, the panel and the chat text all use it. The fallback is never presented as agent output; its chat message carries the provenance label `Fallback sample plan: scripted, not written by an agent (...)`; an agent plan's message carries chips for the verified pages.

**Persistence surface.** `PlanView.saved = {rev, lastEditedBy, lastEditedAt}` and `PlanView.sync = {posted, imessage}` (the last plan message in the squad chat and its iMessage delivery state). Entry points: a Study plan card on Home, a `Study plan` pill in the village HUD, and `/squad/village?plan=1`. The panel reloads the plan from the hub, so `Saved, version N, last edited by <name> <time ago>` is the same after a reload. Empty state: `Propose a plan` (exam date input) starts the real flow.

### One real run (2026-10-25)

Dev stack on hub 9020, Gemini key working, `POST /v1/plans {examDate: +12 days}` as Ana: 6.7 s, `generator = {kind: agent, mode: live, source: planner}`, 1092 input tokens, 692 output tokens, estimated cost **0.0021 USD** (flash-class price table in `planner.ts`: 0.30 / 2.50 USD per million tokens). Plan produced (exam 2026-11-06): Oct 27 Ben teach Measures of Center and Spread (ch2 p.1), Oct 29 Chi teach Probability Rules and Events (ch3 p.1), Oct 31 Dev teach The Normal Distribution (ch6 p.1), Nov 2 Ana review Normal Distribution (ch6 p.1), Nov 4 Ben teach Linear Regression and Correlation (ch12 p.1), Nov 5 Ana group practice. Every item carried a one-sentence `why` and a verified source except the practice item; the rationale said the plan covers all topics, gives each core topic dedicated time and ends with a group review before the exam.

### Tests

`apps/hub/test/smoke/plan-agent.smoke.test.ts` (FakeLlm as the real model: agent plan, Live/Degraded badge, verified quotes only, private words stripped, failing agent -> labelled fallback, no key -> Demo fallback, persistence and sync block), `packages/core/src/provenance.test.ts` (`planBadge`), web `plan.test.tsx`, gate step S9b, `e2e/specs/j30-provenance-plan.spec.ts`.
