# Phase 0 notes (scaffold decisions and spec deviations)

- **Core entry split.** `@squad/core` is browser-safe (no better-sqlite3, dotenv, or @google/genai) so `@squad/web` and `@squad/village` can import contracts. Node-only pieces (`openDb`, `openMemoryDb`, `loadConfig`, `GeminiLlm`) are in `@squad/core/node`. Spec 02 listed them as one package.
- **Llm is provider-agnostic and Gemini-default** (DECISIONS.md), replacing spec 02/00's Anthropic wording. API: `complete`, `json` (zod), `createCache`; tiers `fast|main|chair` map to `gemini-2.5-flash-lite|flash|pro` (override with `GEMINI_MODEL_FAST/MAIN/CHAIR`). Spec 02's `{cache?: string[]}` became a `CacheHandle` from `createCache`.
- **Internal events secret env var.** `.env.example` has `INTERNAL_EVENTS_SECRET`; WORKFLOW.md mentions `NOOK_INTERNAL_SECRET`. `postEvent` reads `INTERNAL_EVENTS_SECRET` and falls back to `NOOK_INTERNAL_SECRET`. The hub should do the same.
- **`postEvent` never throws on network failure** (returns `{ok:false}`) so a missing hub cannot crash a bot; it throws only for an invalid event. Retries: 2 on network error, 5xx and 429; none on other 4xx. `emitEvent` is an alias.
- **Strict schemas.** Every VillageEvent member (and the replay script) rejects unknown keys, so a stray withheld value on `ledger.entry` fails validation instead of being passed through. `ledger.entry.withheld` is only `'hidden'`.
- **`LedgerEntry` (internal) keeps `withheld?: string`** per spec 00; it is a server-side record, never an event.
- **Replay schema** adds checks beyond 09: `version` is literal `1`, `events` ordered by `at`, checkpoints not after the last event, `cast.me` required (extra cast keys must be strings). Sample at `@squad/core/fixtures/sample-replay.json` contains all 16 event types.
- **No tsconfig project references.** WORKFLOW.md asked for them; packages export TypeScript source (`exports` -> `src/*.ts`), so each package typechecks with `tsc --noEmit` and vitest resolves workspaces without a build step.
- **`pnpm check` = typecheck + lint + test.** `lint` is `eslint . && prettier --check .` (docs/ and assets/ are excluded from both).
- **Smoke tests:** `test/smoke/*.test.ts` per workspace; `pnpm test:smoke <ws|all>`.
- Agent id grammar: `student:<id> | expert:<chapter> | council:<id> | dean | mediator`, enforced by `AgentIdSchema`.
