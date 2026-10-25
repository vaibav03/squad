# Council board (W5)

The Council board is the laptop view of how a council reaches a decision: who is on it, who asked whom what, where
the run is in the decision flow, and what the chair decided. It runs on the A2A envelope (`docs/a2a.md`), so it
works the same on the council replay fixtures and on a live run.

## Open it

- Council Hall and Round Table room panels: the "Open Council board" button (with that room's mode badge).
- The `Council board` pill in the village (appears while a council session exists), and the launcher beside "Ask the council".
- Agent Inspector: the `Board` button and the Hierarchy tab's "Open council board".
- URLs: `?replay=track4` (healthy run), `track4b` (degraded), `track4c` (private skeleton), plus `&board=1` to open it.
  `?board=ask` or `?board=roundtable` plays a scripted fixture into the board (no hub events needed); `boardspeed=instant` or a
  number sets the pace.

## What is on it

- Org chart: chair on top, specialists below, code checks to the side. Cards use the cast portraits (Chairman, Chill, Grind, Advisor) and
  an initial tile otherwise, a role chip, a mode badge (glyph and word), the current public status, and the position.
  Edges light for a few seconds after a message crosses them; peer exchanges (Skeptic to Teacher) show as links below.
- Stepper: question, delegation, opinions, critiques and ranks, dissent, verdict, action items.
- Feed: `Skeptic to Chair: Critique` rows, citations (open the source viewer), time, "in reply to", indent by delegation depth,
  filters by agent and kind, auto-scroll that pauses when you scroll up with "Jump to latest (n new)".
- Verdict card: the call, confidence in words, dissent linked to the dissenting message, action items with "Send to chat" and
  "Add to plan" (both go through the existing chat-send helper; off in replays and without a hub).
- Arrows: a thin violet arc with a kind word between the seats of agents exchanging messages now, in the Council Hall (Ask council and
  quiz-key) and the Round Table. 160-200 ms ease-out, opacity and a 3 px packet; static in Calm.

## Honesty

Every surface shows `Live`, `Degraded: reason` or `Demo` with a glyph and the word, from the event `mode`. A run is as honest as its
worst agent. Scripted fixtures are always Demo. Thinking text has no field anywhere on the board.

## Accessibility

Focus-trapped dialog, Esc closes, Tab stays inside. Feed rows and org-chart cards are keyboard lists (arrows, Home/End, Enter).
A polite live region announces steps and new messages by display name. Raw ids never reach text, aria-label or title
(scan tests in `board.test.tsx` and the inspector's `no-raw-ids.test.tsx`).

## Code

`packages/village/src/council` (model, store, arrows, fixtures), `packages/web/src/council/board` (UI), Playwright
`e2e/specs/j20-council-board.spec.ts`.

## Live runs (council integration)

- The header shows the CURRENT state: `Now` plus the step or who is still working while the run goes, `Result` plus the verdict
  answer when it is done (never the opening "Question received" line). The question comes from the stage event or the run result.
- From the chat: `@cubbie ask the council: ...` posts the run card at once (the closing verdict text follows as a plain message).
  The card polls the run, shows the mode badge, the step words and who is on it, and `Open council board` opens a board that
  keeps streaming (`RunStrip`, `useResultBoardStore`, `syncResultToBoard`). In the village the same button opens the shared board.
- Council Hall and Round Table panels show the same strip. A stage never moves backwards on the board, so a late poll cannot undo `done`.
- Action items: the chair's `actions` stage publishes one envelope per item (`docs/a2a.md`). `Send to chat` calls
  `POST /v1/council/:id/actions/chat`, `Add to plan` calls `POST /v1/council/:id/actions/plan` (shared study plan, `docs/study-plan.md`),
  each with pending, success and failure states. Scripted fixtures are not hub runs, so their buttons report "Could not send".
- Tests: `e2e/specs/j20-council-board.spec.ts`, `e2e/specs/j23-council-live.spec.ts` (fixture stack by default, `LIVE=1` for real Gemini).
