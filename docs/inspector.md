# Agent Inspector

Click any character in the village (the viewer's own character and every agent sprite) to see what that agent is doing, how it is thinking, what it has said, and who it is talking to. Laptop first: mouse and keyboard. Phones keep working as before but are not tuned.

## Try it
1. `pnpm dev:all --no-agents` (hub 8788, web 5180), sign in as Ana.
2. Open `/squad/village?replay=track2` or `?replay=track3`, or the live village.
3. Click a character, or press `I` on the village to cycle agents, or Tab to the agent chips at the top-left and press Enter. `Esc` closes and returns focus to the village. Clicking empty ground closes it too.

> The inspector is now the focused agent panel with the tabs Activity, Reasoning summary, Conversation, Team and Structure. See `docs/agent-focus-panel.md`. The older tab descriptions below map: Doing = Activity, Thinking = Reasoning summary (shared notes), Chat = Conversation, Agents = Team, Hierarchy = Structure.

## What it shows (tabs)
- **Doing**: the current-activity line (never blank), state, where the agent is, where it is heading, what it waits on, the skill involved, the model tier (fast, main, chair) and Demo mode, and the last ten events with relative times.
- **Thinking**: a thought bubble built only from what the stream carries: the optional `thought` text on events, or public event text (the quiz question, a council member's stance, a dissent, a dropped option, a source being weighed). A live indicator shows while a model call is in flight (`work.thinking`). Earlier thoughts sit in a collapsed list. With nothing shared it says `Working on it: no reasoning shared yet`. Hidden chain of thought is never requested or shown.
- **Chat**: what the agent and the viewer said to each other: the viewer's own private chat with their agent (hub `GET /v1/chat/history`, own DM only, live mode only), plus call lines with citation chips (the shared source viewer), quiz questions, answers and confirms. Other students' chats are never shown.
- **Agents**: who this agent is talking to now (chips with a pulse on the active line; click a chip to select that agent) and the thread of what it said to or got from other agents, with arrows, names and times.

In the village a hover shows an outline and name tag, the selected agent has a ring under its feet, `Follow` eases the camera to it (integer zoom, no fractional zoom), and while two agents exchange messages a soft violet link fades between their sprites (static in Calm mode).

## Inside a room
Every character in a room interior (council members and chair, debaters, the expert in a chapter house, landmark or booth) is a click target: hover shows a small name tag (no outline), click opens the inspector on the **Chat** tab with the room's whole conversation in order (speaker, time, kind, dissent flag, citation chips), the clicked character's lines marked, and a `Just <name>` switch. Tab or the arrow keys move between characters in the room, Enter opens, Esc closes (then Esc again leaves the room); Prev/Next in the popup stay inside the room. Clicking the floor does nothing; only the dark area around the room walks you out. Seats: `packages/village/src/scenes/roomSeats.ts`; words come from the room session (`council.*`, `call.caption`, `quiz.question` text), so a real council run shows the same text. Test: `e2e/specs/j17-room-inspector.spec.ts`.

## Walking is keyboard-only (mouse movement removed)
Arrow keys or A/D walk, Enter enters, Esc leaves. A mouse click on the ground never moves the player, and nothing follows the mouse. Removed: click-to-walk, drag-to-walk, click-a-door-to-walk-and-enter (`packages/village/src/character/index.ts`). Touch devices keep tap-to-walk as before (there is no on-screen d-pad), so phones can still move. The HUD "Trip" door button still walks to the trip road (a button, not a pointer move).

## How agents communicate
Today agents do not hold free-form chats with each other. They coordinate through typed events and tasks the hub relays:
- **Council**: members answer in parallel, each ranks the other answers without names, and the chair writes the verdict. A member who disagrees is recorded as the dissent.
- **Students' agents (mesh)**: each agent sends only masked results (blinded calendar tokens, secret shares) to the mediator, which finds a plan that works for everyone. Private values stay with their owner and show as `hidden`.
- **Experts and the viewer**: calls (captions with citations), quiz questions and answers, confirms.

The Agents tab turns these events into plain sentences (`Grind (council) <-> the chair`, `Ana -> Ben`). The **Live Discussion** feature adds real turn-by-turn conversation. Its events plug in without changing this code: `registerExchangeMapper('discussion.', mapper)` (`packages/village/src/inspector/conversation.ts`). The default mapper reads `from`/`speaker`/`agent`, `to` and `text`/`message` defensively; if the real event shape differs, register a different mapper. If the core union gains `discussion.*` kinds, add them to `exchangesFromEvent`.

## Privacy
Everything comes from the per-viewer filtered event stream. Withheld values stay `hidden`. For other students' agents only public activity shows; their ledger values, quiz correctness, call captions and confirms never reach the inspector, and text about them is scrubbed of amounts and the known sentinels (`$180`, `therapy`) as a second line of defense (`redact`). Tests: `packages/village/src/inspector/*.test.ts`, `packages/web/src/overlays/inspector/inspector.test.tsx`, `apps/hub/src/filter.test.ts`.

## Contract change (packages/core, additive and optional)
Every VillageEvent kind accepts optional `thought` (max 240), `message` (max 280, what was said in plain public words) and `work` (`{ tier?, demo?, skill?, thinking? }`). Strict schemas still reject unknown keys. The hub filter drops `thought`, `message` and `work` from `quiz.answer`/`quiz.result` and rebuilds `ledger.entry` without them. Replays `track2` and `track3` now carry real thoughts and messages. The hub process must be restarted to load the new schema.

## Files
- `packages/village/src/inspector/`: `describe.ts` (`describeActivity`, `eventWords`, `redact`), `conversation.ts` (exchanges, threads, partners, links, mapper registry), `store.ts` (per-agent state, selection, follow), `module.ts` (canvas hit areas, hover, ring, follow, link, `I` key).
- `packages/web/src/overlays/inspector/`: panel, tabs, chat history hook.
- Wiring: `packages/village/src/scene-manager/world-scene.ts`, `hud/index.ts` (chips carry the activity line and open the inspector), `pages/village/index.tsx`.
