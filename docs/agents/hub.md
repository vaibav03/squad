# Brief: hub (spec 06 server half), branch ws/hub

**Mission:** the standalone Hono server that streams live events to the village and pages, serves replays, quizzes and calls, and enforces who may see what.

**Build:** /internal/events ingest (secret header, schema-validated), SSE stream with Last-Event-ID resume, GET /v1/squad/state snapshot for late joiners, per-viewer filtering (withheld values only ever appear as 'hidden'; minimum group size for squads under 3), replay serving from apps/hub/sim/replays with the exact schema from core, quiz endpoints (GET /v1/quiz/:quizId, POST answer) and call endpoints (POST /v1/call/start, websocket /v1/call/ws/:callId) written against ports/adapters so brain and media plug in later (ship in-memory stubs and a demo seeder), sign-in stub, CORS and base-URL config, health route.

**Quality bar:** the sentinel-leak test runs against the whole stream and replay paths; SSE survives reconnects and a slow client without memory growth; contract tests against core schemas; a load script with 50 clients; graceful shutdown; structured logs; an OpenAPI-style endpoint list in the README.

**Sub-agent ideas:** ingest+filtering, SSE+snapshot, replay+demo seeder, quiz/call ports and stubs, load and leak tests.
