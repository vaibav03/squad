# Tracing-lite

One correlation id follows a request across hops. Header `x-squad-corr` (also accepts `x-request-id`); ids are `^[A-Za-z0-9_-]{8,64}$`, anything else is replaced.

- Hub: middleware reads or mints the id, echoes it in the response headers, stores it in AsyncLocalStorage; every hub log line carries `corr`. `/internal/events` calls made with the header are logged under the same id (`event ingested`).
- Outbound: `getObs(deps).propagateTo([agentUrls, BOT_URL])` (wired in `apps/hub/src/main.ts`) adds the header to fetches to those origins.
- Bot, brain, agents: use `corrFromHeaders`, `corrHeaders`, and `createLogger` from `@squad/core` (redacting logger) and send `corrHeaders(corr)` on calls back to the hub. Adopting this in the bot and agent servers is a one-line change per server, owned by their leads.
- Find a trail: `node scripts/obs/trace.mjs <corr-id> <log files...>`.

Logs redact keys, tokens, secrets, withheld values; free text becomes `[text:N]`; student ids are salted hashes.
