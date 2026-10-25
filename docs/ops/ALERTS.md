# Alert rules

Scrape `GET /metrics` (header `x-nook-internal: <secret>` or `Authorization: Bearer <HUB_ADMIN_TOKEN>`). Probe `/health` (liveness) and `/ready` (readiness; 503 only when the database is not writable).

| Alert | Condition | For | Severity |
|---|---|---|---|
| Hub down | `/health` fails | 1 min | page |
| Not ready | `/ready` returns 503 | 1 min | page |
| 5xx rate | `rate(squad_http_requests_total{status=~"5.."}[5m]) / rate(squad_http_requests_total[5m]) > 0.02` | 5 min | page |
| Slow API | p95 of `squad_http_request_duration_seconds` > 1 s | 10 min | warn |
| Demo mode | `squad_llm_demo_mode == 1` | 10 min | warn (page if a real demo is scheduled) |
| Credits depleted | `squad_llm_calls_total{outcome="402"}` increasing | 2 min | warn |
| Bad key | `squad_llm_calls_total{outcome="401"}` increasing | 1 min | page |
| LLM failures | `rate(squad_llm_calls_total{outcome=~"timeout\|error"}[5m]) > 0.1` | 5 min | warn |
| Agent offline | `squad_agent_up == 0` | 3 min | warn |
| SSE drops | `increase(squad_sse_queue_drops_total[10m]) > 5` | none | warn |
| SSE silent | `squad_sse_subscribers > 0` and `squad_event_log_seq` flat | 15 min | info |
| Errors | `increase(squad_errors_total[10m]) > 0` | none | warn |
| Memory | `squad_process_memory_rss_bytes > 1.5e9` | 10 min | warn |
| Disk | host disk free < 10% (node exporter) | 10 min | page |
| LLM spend | `increase(squad_llm_cost_usd_total[24h]) > <budget>` | none | warn |

Dropped, invalid events: `squad_events_total{outcome!="accepted"}` is expected to be near zero.
