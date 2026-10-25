# Tracking

Continuous change tracking for Squad. Everything here except `SESSION-LOG.md` is generated from git by `scripts/track/track.sh` and committed to `main` by a background loop, so the files are always a faithful, rebuildable view of the many branches that leads push concurrently.

## Files

| File | What it is | Source |
|---|---|---|
| `BRANCHES.md` | One row per remote branch: tip sha and subject, author date, commits ahead of and behind `origin/main`, last-commit age, whether it is merged into `integration/final` (`yes` ancestor, `patch` cherry-picked or rebased, `n/m` partial, `no`), its local worktree path with dirty-file count, and local commits not yet pushed. A second table lists local branches that are not on origin. | `git fetch --all --prune`, `git worktree list`, `git -C <wt> status --short` |
| `CHANGELOG.md` | Newest first, grouped by day and by branch: every commit on any remote branch that is not on `origin/main` (sha, time, subject, author, files changed, Co-Authored-By), then the commits that landed on `main`. | `git log` |
| `AGENTS.md` | Per branch-prefix and per workstream branch: commit counts, files changed, authors, Co-Authored-By trailers, and main commits by area. | commit metadata only |
| `SESSION-LOG.md` | Hand-written, chronological history of the project with decisions, who did what on which branch, and what is verified versus not. Append new phases by hand. | git history and the docs |

### Determinism

The generated files contain no wall-clock values, so running the generator twice on the same git state produces identical bytes, and the loop only commits when something really changed. Ages are measured against the newest commit on any branch. The `track: ...` commits themselves are excluded from the changelog and from behind counts so the tracker does not feed on its own output. Dirty-file counts and unpushed counts reflect the working copies on this machine, so they change when leads edit files; that is intended, it shows work that is not yet committed or pushed.

A commit that is reachable from several branches is listed once, under the branch with the fewest commits ahead of main. Rebased or cherry-picked copies have different shas and are listed separately.

## Run it once

```
scripts/track/track.sh                    # fetch, then rewrite the three generated files in the current checkout
TRACK_NO_FETCH=1 scripts/track/track.sh   # no fetch
```

This only rewrites files under `docs/tracking/` of the checkout you run it in. It prints `branches=<n> commits=<m>`. It does not commit.

## The loop

```
scripts/track/autotrack.sh start     # background loop, every 10 minutes (AUTOTRACK_INTERVAL seconds)
scripts/track/autotrack.sh status    # pid, last log lines, last tracker commit on origin/main
scripts/track/autotrack.sh stop      # stop it and release the lock
scripts/track/autotrack.sh once      # one cycle in the foreground
```

- Log: `/tmp/squad-autotrack.log`. Pid: `/tmp/squad-autotrack.pid`. Lock: `/tmp/squad-autotrack.lock` (a directory; stale locks of dead pids are reclaimed). Overlapping runs skip.
- Each cycle works in a dedicated detached worktree, `squad-wt/tracker` (created on first use with `git worktree add --detach <path> origin/main`), which it resets to `origin/main`. It never touches the main checkout or any lead's worktree, so uncommitted changes elsewhere are safe.
- If `docs/tracking/` changed it runs `git add docs/tracking` (never `git add -A`), refuses to commit if anything outside that folder is staged, commits `track: <n> branches, <m> new commits` with a `Co-Authored-By: Claude Sonnet 5.5` trailer, runs `git fetch && git rebase origin/main`, then `git push origin HEAD:main`. It retries a rejected push after another rebase and never force-pushes.
- The running copy of the loop is `/tmp/squad-autotrack-run.sh`, copied from the repo at `start`; restart after changing the script.
- Requires git push access to `origin`. No keys are read, logged or stored.

## package.json scripts

Not added. `package.json` is being edited on about a dozen branches (chat, council, integration, qa, rooms, ux, wire, ws/demo), so a root script here would just create another conflict. Use the shell commands above. If wanted later:

```
"track": "bash scripts/track/track.sh",
"track:start": "bash scripts/track/autotrack.sh start"
```

Your own main checkout does not update itself; run `git pull --ff-only` there to see these files.
