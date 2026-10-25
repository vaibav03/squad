# QA bugs (web, hackathon happy paths)

Run: `DEV_ALL_HUB_PORT=8831 DEV_ALL_WEB_PORT=5231 VITE_HUB_URL=http://localhost:8831 pnpm dev:all --no-agents`, then `BASE_URL=http://localhost:5231 node apps/web-host/e2e/<script>.mjs` (rooms-walkin, rooms-entered-all, village-escape, village-resize, village-leak).

| # | Sev | Defect | Status | Evidence |
|---|---|---|---|---|
| 1 | P1 | Council panel ignored Esc once a run had started (textarea disabled, focus fell to body; trap listened on the panel only) | fixed: `useFocusTrap` also answers Esc/Tab on document when focus is on body; test `overlays/kit/focus-trap-body.test.tsx` | `e2e/rooms-walkin.mjs` |
| 2 | P2 | Desktop docked room panel (info, council) covered the right part of the room (Round Table advisor cut off) | fixed: canvas slides left beside the panel (`pages/village/village.css`) | `docs/design/shots/qa/walkin-desk-round.png` |
| 3 | P2 | Phone room sheet covered the whole screen, hiding the room | fixed: sheet capped at 56dvh | `walkin-phone-round.png` |
| 4 | P2 | Room "Run it" did nothing | fixed: `onRun` sends the phrase to the squad group chat (`pages/village/chat-send.ts`), toast confirms | unit test chat-send.test.ts |
| 5 | P2 | Demo student id `s_cam` (dev stack, live demo, agent fixtures) vs `s_chi` (hub seed) | fixed: dev:all and demo:live use `s_chi`; agent fixtures add `s_chi` profile, ics and peer | |
| 6 | P3 | Exam Oracle, Oral Hut, Rubric Courthouse, Devil's TA stay locked until their first event, so entering shows no panel (by design, skills are rooms-b) | open, not a web bug | `e2e/rooms-entered-all.mjs` |
| 7 | P3 | While the Council panel is open the room outcome card shows through behind it | open, cosmetic | `dbg-council-5.png` |

RoomLayer is mounted on the village page and the room session is published for all 9 unlocked rooms (RoomLayer appears on entry). The four locked rooms are #6.
