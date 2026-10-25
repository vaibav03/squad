# Parallel build workflow (git worktrees, private repo vaibav03/squad)

Specs are in `docs/specs/`. Contracts and layout are in `00-OVERVIEW.md`. This file says how several AI build agents work at the same time without colliding. The repo is private and stays private.

Layout: `apps/{bot,agent,hub,web-host}` and `packages/{core,brain,mesh,media,village,web}`.

## 1. Phase 0 (one agent, nothing else starts)
One agent scaffolds the monorepo and merges it to `main`. No worktree is forked until this is on `main`.
- pnpm workspace (`pnpm-workspace.yaml`, root `package.json`), Node 20+, `tsconfig.base.json` with project references, ESLint + Prettier, vitest.
- Root scripts: `pnpm check` = `typecheck && lint && test` across all packages. Also `pnpm test:smoke <ws>` for a workstream's smoke tests.
- `.github/workflows/ci.yml`: install, `pnpm check` on every push and PR.
- Empty package/app skeletons for all ten directories above (name, `tsconfig`, `src/index.ts`, one passing test), so every workstream has a place to land.
- `@squad/core`: `VillageEvent` zod schema (full union from 00), `AgentId`, `Student`, `InboundMessage`, `OutboundMessage`, `Skill`, `Ctx`, `Persona`, `Citation`, `AgentMessage`, `LedgerEntry`; the `Llm` interface plus a fake `Llm` for tests (canned and recorded responses); the `/internal/events` helper (`emitEvent(e)`, header `X-Nook-Internal`, no-op or buffer when no hub); the replay JSON zod schema (`{name, version, loop, cast, events:[{at, event}], checkpoints}`).
- `.env.example`, `.gitignore` (includes `.env`, `*.db`, generated media), `docs/` committed.
- Exit: `pnpm check` green on a clean clone, CI green, tag `phase0`.

## 2. Worktrees
Create from the main checkout, one per workstream:
```
git worktree add -b ws/<workstream> ../squad-wt/<workstream> main
cd ../squad-wt/<workstream> && pnpm install
```
One agent per worktree. Never check out the same branch in two worktrees. Remove with `git worktree remove` only after the branch is merged.

| Workstream | Spec | Branch | Owns (may edit) | Phase-1 tickets | Depends on |
|---|---|---|---|---|---|
| spine | 02 | `ws/spine` | `apps/bot` | A, B (impls inside core are proposed via the core rule), C, D, E, V; F after | Phase 0; hub for V |
| hub | 06 | `ws/hub` | `apps/hub` (incl. `sim/`, seed) | W1, W1b | Phase 0 |
| brain | 03 | `ws/brain` | `packages/brain` | B1-B11, B16, B17 (B12-B15 later) | spine C (Ctx), hub W1 for B9 |
| mesh | 04 | `ws/mesh` | `packages/mesh`, `apps/agent` | T1-T8 (T9-T11 later) | spine C/askConfirm for T7 |
| media | 05 | `ws/media` | `packages/media`, persona seed JSON, sprite output | M1-M10 (M11-M15 later) | spine, brain retrieval (M5, M6), hub (M7), village V0 audit (M4) |
| village | 09 | `ws/village` | `packages/village` (except motion files) | V0-V8 | motion M-1/M-2, hub stream, brain, mesh, media |
| motion | 08 | `ws/motion` | `packages/village/src/motion/*`, motion CSS tokens in `packages/web` | M-1 first, then M-2..M-9 | M-1 has none; others pair with V tickets |
| web | 06 | `ws/web` | `packages/web`, `apps/web-host` | W0, W2-W8 (W9 integration) | Phase 0; builds against hub seed and replays |
| demo | 07 | `ws/demo` | `scripts/demo`, `apps/hub/sim/replays/track2.json`, `track3.json`, READMEs | D1-D6 | everything; starts last |

Ordering follows 00: foundation (spine, hub, village scaffold), then brain/mesh/media/motion, then web and village scenes, then demo. Agents do not wait for the clock, but they do wait for the listed dependency; use the fake `Llm`, seed data and replay files to stub until it lands. If one workstream needs a file in another's directory, it asks the orchestrator.

## 3. Rules
1. Contract changes (event shapes, shared types, `Llm`, `Ctx`, endpoint paths, replay format) go only through `packages/core`. Make a small PR to `main` with only that change plus the spec text it affects. When it merges, every worktree runs `git fetch && git rebase origin/main` before continuing.
2. A workstream edits only the directories in its Owns column. Everything else is read-only to it. Shared root files (`package.json`, lockfile, CI) change only in tiny separate PRs; lockfile conflicts are resolved by re-running `pnpm install`.
3. Assets (`~/Desktop/squad-assets`, `assets/`, sprite sheets, `LICENSES.md`) are read-only except to media and village.
4. Anything a workstream needs from a package must come through that package's `index.ts` exports. No deep imports into another package's `src`.
5. Each workstream keeps its smoke tests (listed in its spec) under its own directory and runs them with `pnpm test:smoke <ws>`.

## 4. Commits, pushes, merges
- Commit small, one ticket step at a time. Format: `<ws>: <ticket> <imperative summary>` (for example `brain: B2 add citation check`). End every commit with:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Push the branch at least every 20 minutes: `git push -u origin ws/<workstream>`. Run it from a loop (`/loop 20m` pushing if there are commits) or a `post-commit` hook running `git push origin HEAD`. Unpushed work does not exist.
- Only the orchestrator merges to `main`, and only after on that branch: rebased on current `main`, `pnpm check` green, and the workstream's smoke tests green.
- Policy: squash-merge each ws branch per ticket group (PR titled `<ws>: tickets A-C`), so `main` reads as one commit per delivered step. Contract PRs are squash-merged immediately. After a merge the agent rebases and continues on the same branch.
- Keep PRs against `main` small enough to review; if a branch grows past roughly one day of work, merge a green slice first.

## 5. Secrets
- `.env` is never committed. `.env.example` is the contract: every variable, with a placeholder and a comment on who uses it (`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `NOOK_INTERNAL_SECRET`, hub base URL, ports, Google OAuth).
- The owner puts real keys in `.env` in the main checkout. Each worktree gets it by symlink: `ln -s ../../squad/.env .env` (or the owner copies it). Agents read keys from `process.env` only.
- Agents never print, log, paste into a doc or commit key values, and never echo `.env`. Logs show only whether a key is set. If a new variable is needed, add it to `.env.example` in a core-style small PR and tell the orchestrator.
- Tests use the fake `Llm` by default; real-key tests are opt-in (`SQUAD_LIVE=1`).

## 6. Definition of done
A workstream is done when:
- All its Phase-1 tickets are merged, with their smoke tests from the spec in CI or `pnpm test:smoke <ws>`.
- It emits or consumes only events from the core schema, and every event it emits is covered by a unit test.
- Withheld values appear only as a label and `'hidden'` in anything it emits or renders.
- Minimum group size rule (squads under 3) is respected where it applies.
- No secrets, no files outside its Owns column, `pnpm check` green on `main` after the merge.

Integration checklist (orchestrator, on `main`):
- [ ] `pnpm check` and CI green on a clean clone.
- [ ] A replay containing every `VillageEvent` type renders a visible change for each one (village screenshot diff).
- [ ] Sentinel test: events carrying a fake budget ("$180") and "therapy" as withheld values never appear in the canvas, the accessible list, the ledger DOM, the hub stream or `GET /v1/trips/:id` for another viewer.
- [ ] Live path: bot (CLI transport), agents, hub and web-host start together; events reach the village over SSE; late joiner resumes with `Last-Event-ID`.
- [ ] Two demo scripts run from Replay with no network: `/squad/village?replay=track2` and `?replay=track3`.
- [ ] `pnpm demo:reset` then `pnpm demo:seed` returns to a known state; `/internal/events` without the secret returns 401.
- [ ] Production build has Phaser only in the `/squad/village` chunk.

## 7. Agents must not
- Force-push to `main`, rewrite its history, or push to `main` directly (the orchestrator merges). Force-pushing your own `ws/` branch after a rebase is allowed with `--force-with-lease`.
- Change the repo's visibility (it is private) or its settings, collaborators, secrets or Actions permissions.
- Delete, rename or reset another workstream's branch or worktree.
- Edit outside the Owns column, or change a contract without the core PR.
- Commit `.env`, keys, databases, or generated media; print secrets anywhere.
- Add Stakes Pact, Handicap League, generated art or an LLM provider other than the one in `docs/DECISIONS.md`.
