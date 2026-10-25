# Contributing

Squad is built by parallel workstreams, each in its own git worktree. This page is the short version; the full rules are in [docs/WORKFLOW.md](WORKFLOW.md). Where they differ, this page wins on the merge policy (no squash, see below).

## Setup

Node 20 or newer (`.nvmrc` pins 22) and pnpm 10.

```sh
git clone https://github.com/vaibav03/squad.git && cd squad
pnpm install
cp .env.example .env      # never commit .env; keys are optional (demo mode)
pnpm dev:all              # hub + agents + web host, see the README quickstart
```

## Worktrees workflow

One agent or person per worktree and branch. Never check out the same branch twice.

```sh
git fetch
git worktree add -b ws/<area> ../squad-wt/<area> origin/main
cd ../squad-wt/<area> && pnpm install
```

- A workstream edits only the directories it owns; ask the orchestrator before touching another's files.
- Contract changes (event shapes, shared types, `Llm`, `Ctx`, endpoint paths, replay format) go only through `packages/core`, with the spec text they affect.
- Use only a package's `index.ts` exports; no deep imports into another package's `src`.
- Link `.env` into a worktree instead of copying it (`ln -s ../../squad/.env .env`). Never print or paste key values.

## Commits and pushing

- Small commits, one step each. Subject style: `<area>: <imperative summary>` (docs: `docs: <summary>`).
- Every commit message ends with a blank line and this trailer:

  ```
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  ```

- Push your branch at least every 20 minutes (`git push -u origin <branch>`). Unpushed work does not exist.
- Never push to `main`; only the orchestrator lands branches.

## Merge policy: no squash, no rebase of published history

Land work with merge commits so every commit stays reachable and the tracker can tell what is merged:

```sh
git fetch
git merge --no-ff origin/main     # bring main into your branch, often
```

Never squash-merge and never rebase a branch that has been pushed. If `main` moved, merge it in; resolve conflicts in the merge commit. (Lockfile conflicts: re-run `pnpm install`.)

## Testing

| Command | What it runs |
| --- | --- |
| `pnpm check` | typecheck, lint (eslint and `prettier --check`) and all unit tests; CI runs this on every push |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | the three parts of `check` separately |
| `pnpm test:smoke <ws>` | one workspace's smoke tests (`bot`, `agent`, `hub`, `web-host`, `core`, `brain`, `mesh`, `media`, `village`, `web`, `interior`, or `all`) |
| `pnpm --filter @squad/mesh test` | one package's unit tests (includes the property tests and the red-team suite) |
| `pnpm demo:preflight` | replay validity and the sentinel check (`$180`, `therapy` must not appear anywhere) |
| `pnpm exec tsx scripts/docs/gen-api.ts --check` | the Hub API endpoint table matches the routes in the code |
| `pnpm exec tsx scripts/docs/check-links.ts` | relative links, anchors and screenshots in the product docs exist; scans for key-like strings |
| `pnpm format` | prettier write |

Tests use `FakeLlm` by default. Real-key tests are opt-in with `SQUAD_LIVE=1`.

## How to add a skill

1. Create `packages/brain/src/skills/<name>/` (or `apps/bot/src/skills/` for transport-level skills) exporting a `Skill`: `{ name, match(msg, ctx) -> score 0..1, handle(msg, ctx) -> OutboundMessage[] }` (type in `packages/core/src/types.ts`).
2. `match` must return 0 on unaddressed chatter. The bot only speaks when mentioned or a skill scores at least 0.8; personal things go to a DM.
3. Emit any village events through `ctx`/the injected `emit`, never invent shapes.
4. Register it in `createSkills` in `apps/bot/src/skills/index.ts`; order is the tie-break priority.
5. Add unit tests (use `packages/brain/src/skills/testkit.ts`) including a banter case. Add the phrase to [docs/guide/USER-GUIDE.md](guide/USER-GUIDE.md).

## How to add an event

1. Add a strict zod member to the `VillageEvent` union in `packages/core/src/events.ts` (strict: unknown keys are errors) and a test in `events.test.ts`.
2. Decide who may see it: add the case in `apps/hub/src/filter.ts`. An event carrying owner-only data must never reach other viewers; add a sentinel test.
3. Make the village or web consume it; routing of agent and council ids to buildings is in `packages/village/src/scenes/routing.ts`.
4. Update the replay schema consumers if needed and re-run `pnpm demo:preflight`.
5. This is a contract change: it goes through `packages/core` and the spec (`docs/specs/00-OVERVIEW.md`).

## How to add a room

1. Choose a layout slot: the 13 slots are `ROOM_SLOTS` in `packages/village/src/scenes/roomTypes.ts`; placement is in `registry.ts`.
2. Give the room an id mapping in `routing.ts` (which agent or council id lands there) and the scene code under `packages/village/src/scenes/`.
3. Write its student-facing copy in `roomInfo.ts` (second person, no jargon, no grades). Set `how.phrase` only when a chat skill really matches that phrase today.
4. Build the chat skill and emit the events the room listens for (see `docs/qa/ROOMS-AUDIT.md` for the pattern and the current status of each room).
5. Update [docs/guide/ROOMS.md](guide/ROOMS.md).

## Docs

Product docs live in `README.md`, `docs/guide/`, `docs/architecture/`, `docs/api/`, `docs/FAQ.md`, `docs/CREDITS.md` and `docs/SUBMISSION-STORY.md`. Tracking docs belong to the tracker, security docs to the security lead, QA docs to QA, deploy docs to the deploy lead. After editing, regenerate the API table (`pnpm exec tsx scripts/docs/gen-api.ts`) and run the link checker.
