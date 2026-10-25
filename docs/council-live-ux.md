# Council live UX (provider status, Live participants, last run, hall as the live stage)

Release blocker found by customer QA on the served build: the council surfaces said `Idle`, `no reasoning shared`, `no council running` and
`Demo / No council session yet`, showed no provider, audio, transcript or A2A evidence, and the stage was the outdoor village. This feature
makes the council honest and visible. Hub contract and the Live runtime: `docs/live-council.md`, `docs/council-api.md` section 8.

## What the user sees

1. **Status strip** on the Council board header, the Council Hall and Round Table panels, the council chat card and the Live Discussion panel
   (words and glyphs, never colour only): provider `Google Gemini`; the model ids actually used; transport (`Gemini Live (audio + transcript)`,
   `Gemini streaming text`, `Demo (scripted, not Gemini)`, `Gemini streaming (Live unavailable: <reason>)`); key state with the exact fix; run mode
   (live, degraded with the reason, demo); mic (idle, listening, permission denied, unavailable); audio output (playing, muted, unavailable);
   transcript (streaming, complete, none); A2A counters (messages, delegations, stage).
2. **Demo is unmistakable**: every council surface shows `DEMO: scripted, not Gemini` on a demo or fixture run. `LIVE: Gemini` shows only when the run
   mode is exactly `live` AND every participant really used the model; otherwise `DEGRADED: <reason>`.
3. **Last council** is kept per squad (last 20 runs, hub store) and shown whenever no run is active: board, Hierarchy / Agents / Chat / Thinking inspector
   tabs for council agents, Round Table and Council Hall panels, action items, labelled `Last council, 4 min ago, Live`. A squad that never ran one gets an
   honest empty state with a primary `Convene the council` button that starts a real run (Live when configured, otherwise a labelled demo) and opens the board.
4. **The Council Hall interior is the live stage**: starting a council (chat `@cubbie ask the council`, the panel buttons, the board) opens the hall,
   seats the participants, shows speaking / thinking / waiting states driven by A2A events, arrows with kind words, live captions with the speaker chip and
   mode badge, and keeps the board one click away. Round Table likewise.

Where each piece lives: `docs/council-board.md` (board), `docs/inspector.md` (tabs), `docs/live-council.md` (Live runtime and proof).
