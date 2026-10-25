# Squad

Study-group agents for iMessage: an @squad bot in the group chat, private per-student agents that coordinate without exposing schedules or budgets, and a walkable pixel village that shows it all happening.

Specs live in `docs/specs/` (start with `00-OVERVIEW.md`). Decisions are in `docs/DECISIONS.md`. Art credits are in `assets/*/LICENSES.md`.

## Dev guide

Requires Node >= 20 (`.nvmrc` pins 22) and pnpm 10 (`corepack enable` or `npm i -g pnpm`).

```sh
pnpm install            # install all workspaces
pnpm check              # typecheck + lint (eslint + prettier --check) + unit tests; CI runs this
pnpm test:smoke <ws>    # one workstream's smoke tests (bot|agent|hub|web-host|core|brain|mesh|media|village|web|all)
pnpm format             # prettier --write
pnpm dev                # runs each app's `dev` script (stubs until the app lands)
cp .env.example .env    # then fill in keys; .env is git-ignored
```

Layout: `apps/{bot,agent,hub,web-host}`, `packages/{core,brain,mesh,media,village,web}` (all `@squad/<name>`).
Unit tests live in `src/**/*.test.ts`, smoke tests in `test/smoke/*.test.ts` of each workspace.

`@squad/core` is the shared contract package. `@squad/core` (browser-safe): types, `VillageEvent` zod schema, replay schema, `postEvent`, `Llm` + `FakeLlm`, sentinel test util. `@squad/core/node`: sqlite helper, config loader, `GeminiLlm`. Contract changes go only through `packages/core` (see `docs/WORKFLOW.md`).
