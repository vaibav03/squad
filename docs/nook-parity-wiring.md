# Nook parity: wiring context into agents and planning

Branch `nook-wire` (from `feature/nook-parity`). All paths are viewer-scoped: a source is read only by its owner or, when
the owner explicitly shared it, by members of that squad.

| Surface | Where | How |
|---|---|---|
| Chat doubts (`Brain.ask`) | `packages/brain/src/skills/doubt/index.ts`, `create.ts answerSkills(brain, course, viewerFor)`, `apps/bot/src/skills/index.ts` (`SkillDeps.context`), `apps/hub/src/chat/engine.ts` | The hub passes `{ store, viewerFor }`; the viewer is `{ studentId: m.from, squadIds: directory.squadsOf(m.from) }`. Doubts call `brain.ask(course, q, { viewer, contextCourseId: null })`. Without `context` behaviour is unchanged. Fix: `Brain.ask` now honours `contextCourseId` (it was ignored, so Canvas sources under a different course id were never searched). |
| @cubbie group chat shortcut | `packages/brain/src/skills/canvas/index.ts`, `packages/brain/src/context/answers.ts` | Port of Nook `canvas-answers.ts`: `canvasAnswer(text, sources, now, courseNames?)` plus `isCanvasQuestion`. The skill scores 0.95 only when addressed, a deadline/file question, not a graded grab, and the asker has synced Canvas sources; it reads `ownSources` of the asker only, so it never reveals a classmate's Canvas in a group. Runs before the LLM. |
| Live council agents (`retrieve` tool) | `apps/hub/src/live/grounder.ts withContext`, `types.ts` (`Grounder.ground` opts gain `viewer`), `engine.ts`, `wire.ts` | `createRetrieveContext(store, viewer)` is bound per call to the run's asker and squad; chunks become pages (`file = title`, `page = chunk page or ordinal`) so existing `[file p.N]` verification applies. No viewer: nothing read. |
| Trip planning | `packages/brain/src/context/constraints.ts deriveTripConstraints`, `apps/hub/src/context/busy.ts`, `apps/hub/src/adapters/real.ts loadCalendar` | Per student: busy intervals (start/end, no titles) from `gcal_event` / `canvas_event`, due items (`courseId`, `dueAt`; `title` only if the owner shared the source with the squad). `mergeContextBusy(deps, student)` writes derived blocks into `hub_busy_blocks` with title `busy`; `loadCalendar` merges them with the uploaded calendar. The lead should call `mergeContextBusy` after a successful context sync. `feature/trip-collab` is not merged here; hook `deriveTripConstraints` into its service when it lands. |
| Shared study plans | `packages/brain/src/context/study-seeds.ts deriveStudySeeds(store, viewer, now)` | Seeds `{ kind: 'due' \| 'lecture', title, dueAt, courseId, sourceUri }` from own assignments/Classroom items (60 day horizon) and lecture files (section headings of chunks). `feature/study-plan` plan-item contract was not on this branch; the seed shape maps one to one onto plan items. |
| Privacy: event titles | `packages/core/src/ics.ts stripBusyTitles/BUSY_TITLE`, `apps/hub/src/adapters/real.ts`, `apps/hub/src/store/schema.ts`, `apps/agent/src/server.ts`, `packages/web/src/pages/setup/{ics.ts,index.tsx,WeekGrid.tsx}` | Titles are never stored: `hub_busy_blocks.title` is always `busy`; an idempotent migration blanks old rows; the agent push and export carry no titles; the web upload sends a redacted `.ics` (start/end only). Copy now reads "Event titles stay in your browser: only start and end times are sent and stored." |

Exports to add to `packages/brain/src/context/index.ts` (already appended on this branch):

```ts
export * from './readable';
export * from './answers';
export * from './constraints';
export * from './study-seeds';
```

and in `packages/brain/src/index.ts`: `export * from './skills/canvas';`.

Tests: `packages/brain/src/context/wiring.test.ts` (canvasAnswer due list and past marker, slides/pdf lists, honest empties,
isolation, trip constraints and title withholding, study seeds, `Brain.ask` with `contextCourseId: null`, retrieve tool
isolation), `packages/brain/src/skills/canvas/canvas.test.ts` (group chat isolation, doubt skill with and without a
viewer), `apps/hub/src/context/wiring.test.ts` (live grounder viewer isolation, derived busy blocks have no titles and
merge idempotently), `apps/hub/test/smoke/calendar.smoke.test.ts` (ICS titles not stored or pushed, migration), and
`apps/agent/src/server.test.ts` (calendar push strips titles).

Known limits: the shortcut lists the asker's own sources only (shared sources are reachable through retrieval, not
listing); course names are not stored, so the answer shows a course name only when the caller supplies `courseNames`.
