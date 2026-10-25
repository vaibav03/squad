# Submission checklist

Rules: the repo `vaibav03/squad` stays PRIVATE until the owner says to flip it. Nobody but the owner runs `--yes`. Sign-in to `hackathon.py` is done by the owner (the kit currently reports "Not signed in").

## Gates (each gated on the previous one)

1. Dry runs
   - [ ] `pnpm demo:preflight` passes (add `--live` for the Live run)
   - [ ] Two clean Replay dry runs in a row: `pnpm demo:replay track2`, `pnpm demo:replay track3`
   - [ ] Two clean Live dry runs in a row (phones, hotspot backup, Focus off)
   - [ ] Both videos recorded from `docs/demo/video/track2.md` and `track3.md`, uploaded unlisted
2. Repo
   - [ ] `pnpm check` green on `main`; branches merged and pushed
   - [ ] READMEs: root, `docs/demo/track2/README.md`, `docs/demo/track3/README.md`; GIFs in `docs/demo/media/`
   - [ ] No `.env`, keys or Cubbie assets in the repo; credits complete
   - [ ] Visibility set per owner decision (flip to public only on the owner's word)
3. Fresh clone
   - [ ] Clean clone in a temp directory runs the Replay from the README in under 5 minutes
   - [ ] Repo opens for judges in an incognito window (only after any visibility change)
   - [ ] Video plays logged out
4. Previews
   - [ ] Owner signs in: `python3 scripts/hackathon.py login --email <email>` (or `--google`)
   - [ ] Preview Track 3 and Track 2 using `docs/submission/PREVIEWS.md` (no `--yes`); review every field
5. Submit
   - [ ] Owner runs the same commands with `--yes`; `hackathon.py mine` shows both entries
6. After
   - [ ] Check the gallery (`hackathon.py gallery --track agents`, `--track groupchat`); fix and resubmit while the track is open (entries are editable until the track closes)

## Field limits

- `--team` and `--name`: 60 characters max. `--pitch`: 140 max. `--member "Name <email>"`: 1-4. `--repo`: `https://github.com/...`, may include a subpath. `--website`, `--video`: optional, https only. There is no post or platform field for Tracks 2 and 3.
