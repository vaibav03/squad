# Village

The village is the side-view world at `/squad/village`. Players walk it, the HUD names the agents, and the DOM overlays (chat dock, panels, boards) sit on top of the canvas. Buildings are specified in `village-scenes.md`, the world contract in `village-api.md`.

## Agent Hall

There is ONE meeting place for every agent: the **Agent Hall** (the former Council Hall building and interior). Everyone you can ask is in it: Cubbie, the experts (Feynman, Quiz, Oracle, Rubric, Devil's TA, StepDiff, Podcast, Explainer, Study plan, Discuss), the council members (Skeptic, Advisor, Chill, Grind, Debate), the judges (Chair, Chairman, Examiner) and the tutor and planner. The seat list is built from the shared alias table (`packages/core/src/mentions.ts`), so a name you can `@mention` is a seat in the hall and the other way round.

### What the player sees

- The open village has no bottom strip at all. The bottom edge keeps the Chat launcher, the HUD and the build marker.
- The village has one door for agents: the Agent Hall. The other buildings (chapter houses, Feynman Porch, Debate Stage, Exam Oracle, Rubric Courthouse, Oral Exam Hut, Devil's TA booth, Panic Line booth, Round Table pavilion) are scenery. They have no door, no Enter prompt and are never shown shuttered.
- Inside the hall (`packages/web/src/hall`):
  - every agent sits on a tidy double arc; name tags show on hover and focus only
  - pressing a seat aims the message at that agent (the composer gets `@alias `) and shows its card: portrait, one-line job, availability, and "Open <agent>'s panel" (the selected-agent panel: Activity, Reasoning summary, Conversation, Team, Structure)
  - a small Council group has "Ask the council", "Start a discussion" and "Council board"
  - the squad chat is docked on the right. It is the same group chat as `/squad/chat` (same `useChat` store, same hub transport, no second store): the chat dock simply opens itself and docks beside the seats while you are inside, and the launcher pill steps aside
  - composer: `@` suggestions come from the shared `MentionAutocomplete` (Cubbie first, then every alias), and suggestion chips replace the old "Run it" buttons (`@cubbie quiz me on ch2`, `@feynman explain z-scores`, `@debate should exams be open book?`; the picked agent's starter comes first)
  - messages show the speaker's portrait and, on messages that mention agents, a "to Feynman" line
  - the "What they are saying" strip is a child of the hall: it only exists inside the hall and only once something was said (a council run, a debate, a last run being reviewed). Every council event heard anywhere in the village is also heard in the hall.
- Leaving (Leave button, Esc) removes the hall, the strip and the docked chat; the Chat launcher returns.

### Former rooms are aliases

Every former room id still works as an entry point and opens the hall with the agent that used to live there selected. The mapping is data in `packages/village/src/scenes/hall.ts` (`legacyRoomTarget`, `hallTargetForAgent`) and `packages/web/src/hall/roster.ts` (`resolveRoomParam`):

| Former room / id | Opens the hall focused on | Composer draft |
| --- | --- | --- |
| `council-hall`, `hall`, `agent-hall` | the whole hall | none |
| `feynman-porch`, `feynman` | Feynman | none |
| `debate-stage`, `debate` | Debate | `@debate ` |
| `round-table`, `roundtable` | Planner | none |
| `panic-booth`, `panic` | StepDiff | none |
| `exam-oracle`, `oracle` | Oracle | none |
| `oral-exam-hut`, `oral` | Examiner | none |
| `rubric-courthouse`, `rubric` | Rubric | none |
| `devils-ta`, `devilta` | Devil's TA | none |
| `chapter-N`, `chN` | Quiz | `@quiz quiz me on chN` |
| any other `@alias` (`tutor`, `skeptic`, ...) | that agent | none |

Entry points that all resolve here:

- deep links: `/squad/village?room=feynman` (any id above)
- the world handle: `openRoom(slot)` (council surfaces use it, e.g. when a council starts)
- HUD agent chips: pressing a chip walks to the hall door and goes in with that agent selected (inside the hall it just re-aims the hall)
- the door itself ("Open the Agent Hall")

The world carries the ask in the room session (`enter(slot, { focus, seed })`, `setFocus`, snapshot field `focus`), so the DOM never reaches into the engine.

### Availability instead of locked rooms

The old rule "a landmark stays shuttered until its first event" is per-agent availability now. An agent that used to live in a room shows **Locked until first use** until its skill has run once this session (the room session reports the used rooms in `snapshot.used`); everyone else shows **Available**. A locked agent can still be addressed: your first message is its first use. Labels are honest and never block a message.

### Chat is one thread

The hall chat is the squad group chat of the selected group. Plans (the composer's `+` menu, plan cards, the Plans drawer), the canonical council card, the header truth badge and pending/retry states all work because it is the same thread. There is no second store, no second transport and no per-room panel.

### Tests

- unit: `packages/web/src/hall/hall.test.tsx`, `packages/village/src/scenes/hall.test.ts`, `packages/web/src/overlays/room-info/room-info.test.tsx`
- e2e: `e2e/specs/j39-agent-hall.spec.ts` (open village has no strip, door, all agents, chat with `@feynman` and `@debate` in one thread, leave, `?room=` aliases); rooms specs j06, j10, j17, j20, j32 follow the single-hall model.
