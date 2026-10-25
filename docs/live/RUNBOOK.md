# Live verification runbook

Run this the minute Gemini credits (and the ElevenLabs key) are back. It proves every real model path under a hard spend cap and writes `docs/live/LAST-RUN.md` plus `docs/live/last-run.json`. Secrets are read from `.env` and never printed.

## 1. Before you run

1. Gemini: top up prepay credits at https://ai.studio/projects (Billing). Wait about a minute.
2. `.env` at the repo root has `GEMINI_API_KEY` (and `ELEVENLABS_API_KEY` for check 7). In a worktree: `cp ../squad/.env .env` (never commit it).
3. `pnpm run doctor` shows both keys present. `ffmpeg -version` works (check 7 loudness).
4. Fixtures are committed. To regenerate them: `pnpm live:images` (needs Pillow).

## 2. Run

```
SQUAD_LIVE=1 pnpm live:verify                         # checks 1-6 and 8; ElevenLabs is SKIP
SQUAD_LIVE=1 LIVE_ELEVENLABS=1 pnpm live:verify       # also check 7 (about 175 characters and one voice-design preview)
SQUAD_LIVE=1 LIVE_ONLY=1,2 pnpm live:verify           # a subset (cheapest first)
SQUAD_LIVE=1 LIVE_SKIP=5 pnpm live:verify
SQUAD_LIVE=1 LIVE_IMPLICIT=1 pnpm live:verify         # adds the implicit-cache probe (about 12k tokens)
```

Without `SQUAD_LIVE=1` it refuses (exit 2). It probes with ONE tiny call first; a 402/401/429 stops everything right there.

## 3. Spend caps (all env, enforced before each call)

| Env | Default | Meaning |
| --- | --- | --- |
| `LIVE_MAX_CALLS` | 150 | raw provider HTTP attempts, retries included |
| `LIVE_MAX_TOKENS` | 120000 | billed tokens (input minus cached, plus output and thinking) |
| `LIVE_MAX_EL_CHARS` | 800 | ElevenLabs characters |
| `LIVE_MAX_USD` | 0.50 | estimate from `LIVE_PRICE_IN_PER_M` (0.5), `LIVE_PRICE_OUT_PER_M` (3), `LIVE_PRICE_EL_PER_1K_CHARS` (0.3); placeholders, set the real price list to tighten |
| `LIVE_MAX_OUT_PER_CALL` | 3000 | output cap per request |

A full run is planned at about 127 calls, 96k tokens, 175 characters (printed as `plan:` at start; real use is usually lower because estimates are worst case). When a cap is hit the run stops, exit 4, remaining checks SKIP, and the report names the knob. Worst-case overshoot is one call's actual usage above its estimate.

## 4. What good looks like

```
plan: ~127 calls / ~96500 tokens / ~175 chars; caps 150 calls / 120000 tokens / 800 chars / $0.5
PASS   0  preflight probe
PASS   1  model ids, tiers, structured JSON per skill family
PASS   2  grounding: ...
...
spend: 96 calls, 61000 tokens, 0 chars, ~$0.07 (caps ...)
result: PASS  9 pass, 0 fail, 0 skip
```

Exit codes: 0 pass, 1 a check failed, 2 refused (no `SQUAD_LIVE` or no keys), 3 aborted by a provider error, 4 budget cap hit.

## 5. If it aborts

| Output | Meaning | Fix |
| --- | --- | --- |
| `ABORTED (gemini HTTP 402)` | credits depleted | top up at https://ai.studio/projects, wait a minute, rerun |
| `ABORTED (gemini HTTP 401/403)` | key rejected or restricted | new key at https://aistudio.google.com/apikey into `.env`, rerun |
| `ABORTED ... rate_limited` | 429 survived the adapter's 2 retries | wait the `retryDelay`, rerun with `LIVE_ONLY=` a smaller set |
| ElevenLabs 401 / 402 / 429 | key permissions (`text_to_speech`, `voices_read`), plan, or rate | the report prints the exact fix |
| `budget cap hit` | harness cap, not a provider problem | raise the named `LIVE_MAX_*` |

## 6. Reading failures

Each check lists steps as PASS/FAIL/SKIP with evidence (first 400 chars, secrets redacted). Start from the first FAIL.

| Check | Typical FAIL | Meaning and knob |
| --- | --- | --- |
| 1 | `not in the models list` | wrong id. Set `GEMINI_MODEL_FAST/MAIN/CHAIR` in `.env` (defaults: `packages/core/src/llm/gemini.ts:17`) |
| 1 | `empty text` | thinking model spent `maxTokens`; see FINDINGS F-07 |
| 1 | schema parse error | the model's JSON broke a product zod schema; adjust the prompt in the skill that owns the schema |
| 2 | `no citation on <file> p.N` | answered with a quote on the wrong page. The code strikes unverified claims, so this is a recall problem |
| 2 | `refused an answerable question` | all quotes were struck. Compare the strike rate metric |
| 2 | `citation strike rate too high` | over `LIVE_MAX_STRIKE` (default 0.4). Loosen the verbatim match only if quotes differ by punctuation: `MIN_QUOTE_CHARS` (12) and `MIN_QUOTE_WORDS` (3) in `packages/brain/src/citations/check.ts:18-19`. Lowering them admits shorter, weaker quotes; raising them strikes more. Normalisation is in `normalizeText` in the same file |
| 2 | `dean routes ... via=bm25` | the Dean's model call failed silently (FINDINGS F-03); check the model id and prompt |
| 2 | injection steps | the model obeyed the planted page. Strengthen `packages/brain/src/experts/prompts/expert.system.md` |
| 3 | `expected 2` | transcription or equivalence missed the divergence. Look at the transcribed steps in the evidence |
| 4 | council events echo the key | FINDINGS F-04 |
| 5 | `dissent=false` | the contrarian member was not contrarian enough, or the dissent logic regressed |
| 5 | `usedFallback=true` | the course-plan model could not answer and built-in rules wrote the notes |
| 6 | `no cache hit` | cache below the model's minimum (4096 tokens for the default model), or cache model id differs from the request model id. `MIN_CACHE_CHARS` is in `packages/brain/src/experts/context.ts` |
| 7 | HTTP 402 on design or dialogue | needs a paid plan. Drop `LIVE_ELEVENLABS=1` or upgrade |
| 8 | SKIP `apps/hub/src/chat is not on this branch` | the chat batch has not landed; merge `origin/main` and rerun `LIVE_ONLY=8` |

## 7. What to tune, and where

- Model ids: `GEMINI_MODEL_FAST`, `GEMINI_MODEL_MAIN`, `GEMINI_MODEL_CHAIR` in `.env`.
- Quote strictness: `MIN_QUOTE_CHARS`, `MIN_QUOTE_WORDS` (constants, code edit, FINDINGS F-01).
- Timeouts and retries: Gemini 429 retries `GeminiLlm({retries})` default 2, wait capped at 10 s (`packages/core/src/llm/gemini.ts`, `MAX_RETRY_WAIT_MS`); ElevenLabs retries default 1 in this harness; the chat check waits up to 90 s for the reply (`scripts/live/checks/08-e2e.ts`); the resilient wrapper re-probes every 60 s (`packages/core/src/llm/resilient.ts`).
- Golden set size: `LIVE_GOLDEN_IDS=g01,g02,g04` (comma ids from `packages/brain/fixtures/golden.json`), strike bound `LIVE_MAX_STRIKE`.

## 8. Proven offline vs only on a live run

Offline (`pnpm --filter @squad/live-verify test`, 28 tests, no network): 200 / 402 / 429 (retry and persistent) / 401 / slow responses against the real `GeminiLlm` over an injected client; exactly one call on 402/401; budget caps for calls, tokens, characters, USD; redaction of keys in evidence and reports; the grounding check passes an honest scripted expert and FAILS fabricated, wrong-page, cross-chapter and injection-obeying ones; the vision check against a scripted vision model on the committed fixtures; ElevenLabs steps against an injected port with real ffmpeg loudness; every check runs to completion on a useless model.

Only a live run proves answer quality, cache hits, vision accuracy, thought-signature replay, real latency, ElevenLabs endpoints, and check 8.
