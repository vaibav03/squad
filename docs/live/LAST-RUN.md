# Live verification: last run

- Started: 2026-10-25T09:07:22.674Z
- Finished: 2026-10-25T09:07:24.714Z
- Mode: real
- Outcome: **PASS** (exit code 0)
- Models: fast `gemini-3.5-flash-lite`, main `gemini-3.8-flash`, chair `gemini-3.8-flash`
- Checks: 1 PASS, 0 FAIL, 8 SKIP

## Spend

| Meter | Used | Cap |
| --- | ---: | ---: |
| Provider calls (HTTP attempts) | 2 | 150 |
| Billed tokens | 3677 | 120000 |
| ElevenLabs characters | 0 | 800 |
| Estimated USD | 0.00207 | 0.5 |

Tokens in/out/cached: 3585 / 92 / 0. Latency of successful model calls: p50 728 ms, p95 887 ms (n=2).

USD is an estimate from LIVE_PRICE_* placeholders, not a bill.

## Checks

| # | Check | Result | Calls | Tokens | Chars | ms |
| ---: | --- | --- | ---: | ---: | ---: | ---: |
| 0 | preflight probe | SKIP | 0 | 0 | 0 | 0 |
| 1 | model ids, tiers, structured JSON per skill family | SKIP | 0 | 0 | 0 | 0 |
| 2 | grounding: golden answers, refusals, injection, citation strike rate, latency | SKIP | 0 | 0 | 0 | 0 |
| 3 | vision: step diff on handwritten images, scanned PDF page ingest | SKIP | 0 | 0 | 0 | 0 |
| 4 | quiz: generation, quiz-key council verification, key never leaks | SKIP | 0 | 0 | 0 | 0 |
| 6 | gemini: context cache, tool loop + thought signatures, rate-limit retry | SKIP | 0 | 0 | 0 | 0 |
| 5 | councils and room flows: council, course plan, debate, oracle, rubric, devil TA, oral | PASS | 2 | 3677 | 0 | 1970 |
| 7 | elevenlabs: voices, design, tts + timestamps, dialogue, loudness | SKIP | 0 | 0 | 0 | 0 |
| 8 | end to end: hub + bot + web chat, demo-off, cited answer | SKIP | 0 | 0 | 0 | 0 |

### 0. preflight probe: SKIP

- SKIP probe: one tiny Gemini call
  - not selected (LIVE_STEP)

### 1. model ids, tiers, structured JSON per skill family: SKIP

Skipped: not selected (LIVE_ONLY)


### 2. grounding: golden answers, refusals, injection, citation strike rate, latency: SKIP

Skipped: not selected (LIVE_ONLY)


### 3. vision: step diff on handwritten images, scanned PDF page ingest: SKIP

Skipped: not selected (LIVE_ONLY)


### 4. quiz: generation, quiz-key council verification, key never leaks: SKIP

Skipped: not selected (LIVE_ONLY)


### 6. gemini: context cache, tool loop + thought signatures, rate-limit retry: SKIP

Skipped: not selected (LIVE_ONLY)


### 5. councils and room flows: council, course plan, debate, oracle, rubric, devil TA, oral: PASS

- SKIP council: 3 members, 3 rankings, chair verdict, planted dissenter is named
  - not selected (LIVE_STEP)
- SKIP course plan council respects prerequisites and credit limits (checked in code)
  - not selected (LIVE_STEP)
- SKIP debate: pro/con, chair winner, outcome well formed, no verdict-as-grade
  - not selected (LIVE_STEP)
- SKIP oracle: asks one study question, never an answer key
  - not selected (LIVE_STEP)
- SKIP rubric: per-criterion feedback with verified quotes and no grade numbers
  - not selected (LIVE_STEP)
- SKIP devil's TA: planted error location is judged in code, feedback has no score
  - not selected (LIVE_STEP)
- PASS oral examiner: greeting, question, feedback-only reply, no grade
  - 3 lines, done=false; How does changing the standard deviation affect the shape of a normal distribution curve?

### 7. elevenlabs: voices, design, tts + timestamps, dialogue, loudness: SKIP

Skipped: not selected (LIVE_ONLY)


### 8. end to end: hub + bot + web chat, demo-off, cited answer: SKIP

Skipped: not selected (LIVE_ONLY)

