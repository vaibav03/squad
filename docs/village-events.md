# village-events: adapter command list (village-mesh)

`@squad/village` adapter: `adapt(event: VillageEvent, ctx: AdapterContext): SceneCommand[]`, pure, no Phaser.
The full command union lives in `packages/village/src/adapter/commands.ts` (the source of truth).
Scenes (world, scenes, mesh-view, cutscene) execute commands and hold no business state.

Command tags: setAgentState, walkTo, spawnEnvelope, bubble, dismissBubble, marker, clearMarker, ring, tick,
ledgerCard, setGlow, chalkboard, callPortrait, councilOpinion, councilRank, councilVerdict, lantern,
openOverlay, playTrip, announce.

Places: door(agent) | commons | board | house(chapter) | hall(councilId) | tripDoor.

Executors: world/scenes own setAgentState, setGlow, chalkboard, callPortrait, council*, lantern.
village-mesh owns spawnEnvelope, walkTo-with-envelope, marker, ring, tick, ledgerCard, bubble over commons, playTrip,
announce, openOverlay (overlay bridge). A scene that does not implement a command must ignore it, never throw.
