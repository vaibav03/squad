# Agent UI: portraits, crests, status chip

For the agent-focus-panel worker (`feature/agent-focus-panel`) and anything that shows an agent.

## Web (React)
Import from one module: `packages/web/src/components/agent-ui`.

- `AgentPortrait` (by agent id, 32px or 64px framed): animated cast bust for Chill, Grind, Advisor, Chairman; otherwise a crest.
- `AgentCrest`: bare crest image by agent id.
- `PortraitButton`: a portrait that is a real `<button>`; opens the selected-agent panel through `openAgentPanel(agentId)`.
- `StatusChip` + `agentStateToChip(state)`: icon + word. Words: Resting, Thinking, Speaking, Waiting, Offline (and Live, Degraded, Fixture, Done, Working, Problem). Never a dot, `Z` or bare letter.
- `openAgentPanel(agentId)` / `registerAgentPanel(open)`: the seam for the ONE selected-agent panel. The panel worker calls
  `registerAgentPanel(fn)` once; every portrait on the deliberation surface then opens it. Until then the board narrows its own feed.

## Village HUD (canvas-hosted DOM, no dependency on packages/web)
`@squad/village/portraits` (`packages/village/src/hud/portraits.ts`):

- `crestIdForAgent(agentId)` -> crest id (all 9 HUD agents: `council:quizkey`, `council:debate`, `council:planner`, `expert:feynman`,
  `expert:stepdiff`, `expert:oracle`, `expert:oral`, `expert:rubric`, `expert:devil`; plus `expert:ch1..ch5`, `dean`, students and council seats).
- `crestPath(id)` -> repo path for `assetUrl()` (`assets/pixel/composed/characters/crests/<id>.png`, 32x32, `image-rendering: pixelated`).
- `CREST_ROLE[id]` -> role words for the tooltip.

HUD chip wiring: `const id = crestIdForAgent(a.id); img.src = d.assetUrl(crestPath(id))`; tooltip `${name}, ${CREST_ROLE[id]}, ${STATE_WORD}`;
replace the state glyph (`z`, `*`) with the state word (Resting, Thinking, Speaking, Waiting).

## Crest generation
`python3 assets/pixel/composed/scripts/crests.py` crops head and shoulders from frame 0 of each village sprite
(`assets/pixel/composed/characters/<sprite>/idle.png`, original palette-only art), scales 2x with nearest neighbour and sets it on a
palette-only tile. HUD crests carry an accent hairline and nameplate strip. Deterministic; the PNGs are committed (they derive only from
the repo's own art, never from Modern Interiors).
