# Runbook

Status page: `/squad/status` (admin only). Raw: `GET /v1/admin/status`, `/metrics`, `/ready`.
Admin access: `x-nook-internal` secret, `HUB_ADMIN_TOKEN` (Bearer or `x-admin-token`), or a student listed in `HUB_ADMINS`. Non-admins get 403 (signed in) or 404.

## Hub down
Check: `curl :8788/health`. Fix: `pnpm dev:all` (or restart the service); read the last JSON log lines for `unhandled`/`uncaught exception`; `GET /v1/admin/errors` after restart.

## Answers are scripted (demo mode / 402)
Check: Status page, "Language model" and "Credits" panels, or `curl :8788/v1/status` (`reason`). 402/credits_depleted: top up Google AI Studio billing; the hub rechecks every 60 s, no restart. invalid_key: fix `GEMINI_API_KEY` in `.env`, restart. no_key or forced_fake: set the key / unset `FORCE_FAKE_LLM`, restart. 429: wait or lower load.

## SSE stalls
Check: `squad_sse_subscribers`, `squad_sse_queue_drops_total`, `squad_event_log_seq` flat. Clients reconnect with `Last-Event-ID`; a proxy that buffers responses stalls streams (disable buffering, keep `ping`). Drops mean slow clients; raise `sse.maxQueue` only if needed.

## Mesh agent offline
Check: `/ready` (`checks.agents`), Status "Processes", `squad_agent_up`. Agents are listed in `AGENT_PEERS`; probe is `GET <url>/healthz`. Fix: restart that agent; verify URL and `INTERNAL_EVENTS_SECRET`.

## Database locked / not writable
Check: `/ready` returns 503, `checks.db: fail`. Fix: ensure one hub process owns `DB_PATH`, the directory is writable, disk not full; restart the hub.

## Disk full
Check: `df -h`, size of `DB_PATH` and `logs/`. Fix: rotate or delete logs, free space, restart; then confirm `/ready`.

## Follow one chat message
See `docs/ops/TRACING.md`: `node scripts/obs/trace.mjs <corr-id> logs/*.log`.
