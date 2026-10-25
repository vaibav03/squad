# E2E bugs: chat journeys (J2-J5), scratch merge of chat/web + council/ask + rooms/a + origin/main, demo mode

## E2E-council-card-not-rendered (P2, J5)
- Steps: sign in as Ana, /squad/chat, group chat, send `@cubbie ask the council: should I switch my major?`.
- Expected: a CouncilCard (3 member answers, ranking, verdict, dissent, "Copy verdict" button).
- Actual: the reply is one flat text paragraph ("Council verdict: ... How they answered: ..."). The hub sends `card.type = 'council'` but the chat page (packages/web/src/pages/chat) has no renderer for it; CouncilCard is only exported from packages/web/src/council. No ranking list or copy button in chat.
- Evidence: docs/design/shots/e2e/j5-council/01-council-reply.png
- Owner: chat/web x council/ask integration (packages/web/src/pages/chat/parts.tsx, packages/web/src/council/CouncilCard.tsx).

## Not exercised (happy-path scope)
Village Council Hall room, village classroom quiz overlay (canvas), J6, J7, J11. Exam Oracle, Rubric and oral exam have no bot skill in the merged tree (only room names), so J7 would record them as missing features.
