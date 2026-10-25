# Live verification: last run

- Started: 2026-10-25T07:18:11.210Z
- Finished: 2026-10-25T07:18:11.544Z
- Mode: real
- Outcome: **ABORTED** (exit code 3)
- Models: fast `gemini-3.5-flash-lite`, main `gemini-3.8-flash`, chair `gemini-3.8-flash`
- Checks: 0 PASS, 1 FAIL, 8 SKIP

## Run aborted

- Provider: gemini, HTTP 402
- What happened: gemini credits_depleted (HTTP 402): {"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay. ","status":"RESOURCE_EXHAUSTED"}}
- Exact fix: Gemini prepay credits are depleted (HTTP 402 RESOURCE_EXHAUSTED). Top up at https://ai.studio/projects (open the project, Billing, add prepay credits). Wait about a minute for it to apply, then rerun `SQUAD_LIVE=1 pnpm live:verify`.

## Spend

| Meter | Used | Cap |
| --- | ---: | ---: |
| Provider calls (HTTP attempts) | 1 | 150 |
| Billed tokens | 0 | 120000 |
| ElevenLabs characters | 0 | 800 |
| Estimated USD | 0 | 0.5 |

Tokens in/out/cached: 0 / 0 / 0. Latency of successful model calls: p50 0 ms, p95 0 ms (n=0).

USD is an estimate from LIVE_PRICE_* placeholders, not a bill.

## Checks

| # | Check | Result | Calls | Tokens | Chars | ms |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 0 | preflight probe | FAIL | 1 | 0 | 0 | 294 |
| 1 | model ids, tiers, structured JSON per skill family | SKIP | 0 | 0 | 0 | 0 |
| 2 | grounding: golden answers, refusals, injection, citation strike rate, latency | SKIP | 0 | 0 | 0 | 0 |
| 3 | vision: step diff on handwritten images, scanned PDF page ingest | SKIP | 0 | 0 | 0 | 0 |
| 4 | quiz: generation, quiz-key council verification, key never leaks | SKIP | 0 | 0 | 0 | 0 |
| 6 | gemini: context cache, tool loop + thought signatures, rate-limit retry | SKIP | 0 | 0 | 0 | 0 |
| 5 | councils and room flows: council, course plan, debate, oracle, rubric, devil TA, oral | SKIP | 0 | 0 | 0 | 0 |
| 7 | elevenlabs: voices, design, tts + timestamps, dialogue, loudness | SKIP | 0 | 0 | 0 | 0 |
| 8 | end to end: hub + bot + web chat, demo-off, cited answer | SKIP | 0 | 0 | 0 | 0 |

### 0. preflight probe: FAIL

- FAIL probe: one tiny Gemini call
  - threw: gemini credits_depleted (HTTP 402): {"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#prepay. ","status":"RESOURCE_EXHAUSTED"}}

### 1. model ids, tiers, structured JSON per skill family: SKIP

Skipped: aborted earlier: credits_depleted


### 2. grounding: golden answers, refusals, injection, citation strike rate, latency: SKIP

Skipped: aborted earlier: credits_depleted


### 3. vision: step diff on handwritten images, scanned PDF page ingest: SKIP

Skipped: aborted earlier: credits_depleted


### 4. quiz: generation, quiz-key council verification, key never leaks: SKIP

Skipped: aborted earlier: credits_depleted


### 6. gemini: context cache, tool loop + thought signatures, rate-limit retry: SKIP

Skipped: aborted earlier: credits_depleted


### 5. councils and room flows: council, course plan, debate, oracle, rubric, devil TA, oral: SKIP

Skipped: aborted earlier: credits_depleted


### 7. elevenlabs: voices, design, tts + timestamps, dialogue, loudness: SKIP

Skipped: aborted earlier: credits_depleted


### 8. end to end: hub + bot + web chat, demo-off, cited answer: SKIP

Skipped: aborted earlier: credits_depleted

