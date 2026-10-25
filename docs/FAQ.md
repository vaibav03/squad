# FAQ

## Using Squad

**Do I need API keys?** No. Without keys the hub runs stub ports and a scripted stand-in model, labeled "Demo". Add `GEMINI_API_KEY` for real answers and `ELEVENLABS_API_KEY` for voices. Check `GET /v1/status` (`demo: true` means stand-in).

**The answers look scripted. Why?** Open `/v1/status` and read `reason`: `no_key`, `forced_fake`, `credits_depleted` (Gemini 402), `rate_limited` (429) or `invalid_key` (401). The hub re-probes the real model every 60 s (every 10 minutes for an invalid key), so fixing the cause needs no restart. See [README](../README.md#demo-mode-versus-real-keys).

**What can `@cubbie` do?** See the phrase list in the [User guide](guide/USER-GUIDE.md).

**What does my squad see about me?** Labels of what was shared and that something was kept private, never the value. Plain-words promises: [User guide](guide/USER-GUIDE.md); the cryptographic and trust split: [trust table](architecture/OVERVIEW.md).

**Why does the village show a Replay badge?** `?replay=track2` plays scripted `VillageEvent`s through the same code as Live. Offline, no keys.

**Which rooms work today?** [docs/guide/ROOMS.md](guide/ROOMS.md) has a status per room and says which are on unmerged branches.

## Trust and privacy

**Is it zero-knowledge?** No. It is PSI (private set intersection) plus additive secret sharing, in the semi-honest model, with data minimization you trust our code for. We never claim more. Limits are in the README and in `packages/mesh/README.md`.

**Can an agent lie about its own budget?** Yes, and it would not be caught; a range proof would need a committed budget.

**Why do squads of two get no totals?** With two parties a total reveals the other's input, so squads under 3 publish no counts.

## Development

**`pnpm dev:all` says ports already in use.** Another stack is running on 4101-4104 (agents), 8788 (hub) or 5180 (web). Stop it (`lsof -nP -iTCP:<port> -sTCP:LISTEN`), or pass `--no-agents`, or set `DEV_ALL_HUB_PORT` and `DEV_ALL_WEB_PORT`.

**Blank village.** Phaser loads only on `/squad/village`; hard reload there.

**Why no squash merges?** Squashing hides which commits are on `main`, which breaks branch tracking. We merge with `git merge --no-ff` and never rebase pushed history. [Contributing](CONTRIBUTING.md).

**Where do I add a skill, a room or an event?** [CONTRIBUTING](CONTRIBUTING.md).

**How do I know the API doc is current?** The endpoint table is generated from the route registrations: `pnpm exec tsx scripts/docs/gen-api.ts --check`.

**What about the art?** All packs, licenses and credit lines are in [CREDITS](CREDITS.md). Modern Interiors by LimeZu is licensed to the owner and not redistributed here.

**Is the cost per question known?** Not yet measured, so we quote no number.
