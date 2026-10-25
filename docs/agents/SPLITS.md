# 15 parallel workstreams (supersedes the 9-row ownership table in WORKFLOW.md)

Each lead gets: docs/agents/_PREAMBLE.md + its brief + its slice below. Paths are exclusive ownership; anything else is read-only. Cross-workstream APIs are published as short docs on the owner's branch within the first 15-20 minutes, and consumers stub against them.

| # | Workstream (branch ws/<name>) | Brief | Owns | Publishes early |
|---|---|---|---|---|
| 1 | spine | spine.md | apps/bot/** (router, policy, confirm, memory, cli, record, transports incl. iMessage + Discord), scripts/verify-imessage* | docs/spine-api.md (Skill registration, Transport) |
| 2 | hub | hub.md | apps/hub/** except apps/hub/sim/replays/** | docs/hub-api.md (endpoint list, ports) |
| 3 | web-shell | web.md (shell half) | apps/web-host/**, packages/web/src/{primitives,shell,styles,gallery,pages/setup,pages/personas}/** | docs/web-api.md (primitives, route registry, lab/ registration) |
| 4 | web-live | web.md (live half) | packages/web/src/{pages/ledger,pages/trip,pages/mastery,overlays}/** | overlay prop contracts in docs/overlays-api.md |
| 5 | village-world | village.md (world half) | packages/village/src/{boot,scene-manager,world,parallax,character,input,camera,hud}/** + packages/village/src/index.ts | docs/village-api.md (SceneModule, asset loader, layout coordinates) |
| 6 | village-scenes | village.md (buildings half) | packages/village/src/scenes/** (chapter-houses, council hall, landmarks) | none |
| 7 | village-mesh | village.md (events half) | packages/village/src/{adapter,sources,mesh-view,cutscene,a11y,overlay-bridge}/** | adapter command list in docs/village-events.md |
| 8 | motion | motion.md | packages/village/src/motion/**, packages/web/src/motion/**, apps/web-host/src/lab/motion/** | docs/motion-api.md |
| 9 | brain-answers | brain.md (answers half) | packages/brain/src/{ingest,dean,experts,citations,captions}/**, packages/brain/src/skills/{doubt,behind,hwpolicy}/**, packages/brain/fixtures/**, packages/brain/src/index.ts | docs/brain-api.md |
| 10 | brain-quiz | brain.md (quiz half) | packages/brain/src/{quiz,councils,feynman,stepdiff,studyplan,mastery}/**, packages/brain/src/skills/{quiz,feynman,stepdiff,studyplan}/** | quiz payload types |
| 11 | mesh-crypto | mesh.md (crypto half) | packages/mesh/src/{crypto,psi,secretshare,gate,ledger,protocol,mediator}/** | docs/mesh-api.md |
| 12 | mesh-flows | mesh.md (flows half) | apps/agent/**, packages/mesh/src/{flows,query,bouncer,scripted}/** | none |
| 13 | media-art | media.md (art half) | packages/media/src/{personas,sprites,portraits,gif}/**, assets/pixel/composed/** (after the design foundation lead finishes), assets/sprites/** | docs/sprite-api.md (atlas format, anchors, frame names) |
| 14 | media-audio | media.md (audio half) | packages/media/src/{voices,tts,call,podcast,explainer,delivery}/** | docs/audio-api.md |
| 15 | demo | demo.md | apps/hub/sim/replays/**, scripts/demo/**, docs/demo/**, docs/submission/**, root README sections | none |

Shared-file rules: `packages/brain/src/index.ts` is owned by brain-answers; brain-quiz sends one export line by adding it to `packages/brain/src/quiz/index.ts` and asking main to wire it at merge. `apps/web-host/src/lab/index.ts` is owned by web-shell; motion adds only its own file under lab/motion and one registration line. package.json dependency additions are allowed in your own package only.
Start order: spine, hub, web-shell, village-world, motion, mesh-crypto, brain-answers and media-art publish their API docs first; consumers read them from origin/ws/<name> and stub until merged.
