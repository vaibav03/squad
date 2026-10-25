# Performance report (hackathon scope)

Measured on a production build, `vite preview`, headless Chromium 1280x800 and 390x844, 1x CPU, demo replay path
(hub booted on a free port, web built against it). Raw data: `docs/perf/data/*.json`, screenshots `docs/perf/data/village-*.png`.
Caveat: the dev box was heavily loaded (load average above 100) and headless Chromium renders WebGL in software
(SwiftShader), so fps numbers are pessimistic and noisy. Re-run on a GPU machine with `STRICT_FPS=1 pnpm perf:check`.

## Run

    pnpm --filter @squad/web-host build
    pnpm perf:check            # bundle + runtime vs scripts/perf/budgets.json (exit 1 on FAIL)
    pnpm perf:bundle | perf:runtime | perf:hub | perf:psi

## Bundle (gzip)

| Item | Size |
|---|---|
| Total JS | 632 kB gzip / 530 kB brotli (2.3 MB raw) |
| Phaser chunk (lazy) | 328 kB gzip (1.45 MB raw) |
| Largest app chunk | 184 kB gzip (560 kB raw) |
| CSS | 22 kB gzip |
| Source maps (shipped, `sourcemap: true`) | 13.7 MB |

Phaser isolation: confirmed. Phaser loads only on `/squad/village`; `/squad`, ledger, mastery, personas load about 565-585 kB JS raw, no Phaser. Village route loads 2.24 MB JS raw.

## Village (demo replay)

| | 1280x800 | 390x844 |
|---|---|---|
| Ready (loading text gone) | 1.2-3.6 s | 1.3-3.8 s |
| LCP | 0.55-1.4 s | 0.8-1.2 s |
| CLS | 0.47 | 0.19 |
| TBT | about 4.0 s (software GL, loaded box) | about 1.7 s |
| fps p5 / p50 | 5 / 30 (software GL, not representative) | 4 / 30 |
| Heap growth in 6-8 s window | under 3 MB | under 3 MB |
| Draw calls per frame | 7-8 | 7-8 |

Heap growth over 10 minutes was not run (scope trim); the check only covers the short window.

## Backend (in-process hub, 16 concurrent, 1500 req/route)

Every route: p50 about 1 ms, p99 under 14 ms (replay routes 8.6 ms), 6k-15k rps. SQLite plans use indexes, except
`hub_events` filtered by `squad_id` (full SCAN; no current hot path uses it) and the startup ledger scan (expected).
SSE: 50 clients at 10x event rate lost no events, dropped all slow clients; p99 delivery 11 ms.
Finding: a reconnect storm that resumes with `Last-Event-ID` replays up to 5000 buffered events per client (p50 time to first byte 425 ms for 200 clients vs 81 ms fresh).
macOS caps accept backlog at 128 (somaxconn), so 200 simultaneous connects reset in the kernel; the script uses waves of 100.

## PSI / secret share (per trip)

Ring PSI with 4 parties and padTo 64 does 1024 ristretto scalar multiplications, about 0.7-0.8 ms each, so about 0.9-1.0 s
(matches the 0.8 s note). Hash-to-curve is 0.14 ms, decode/encode 0.06 ms, so multiplies are about 75 percent.
Secret-share sum (4 x 168) is 3 ms: irrelevant. `multiplyUnsafe` gave no win (negative result).

## Top wins, ranked by impact / cost

| # | Win | Owner | Cost |
|---|---|---|---|
| 1 | Drop `sourcemap: true` from prod build (13.7 MB), or `hidden`, and do not deploy `.map` | deploy lead (`apps/web-host/vite.config.ts`) | trivial |
| 2 | Fix village CLS 0.47 (reserve canvas/HUD/overlay space; the loading status and canvas swap) | web/village owner (`packages/village/src/boot/mount.ts`, `village.css`) | small |
| 3 | PSI: fewer multiplies (smaller `padTo` for trips, 64 to 32 halves cost) or run the n*n*pad multiplies in `worker_threads`; run PSI off the request path | mesh owner (`packages/mesh/src/psi`) | small-medium |
| 4 | Long tasks on village load (TBT): split `world-scene` init / texture upload across frames; verify 160-230 MB texture upload count (atlas size, reuploads) on a real GPU | village owner | medium |
| 5 | Serve gzip/brotli and `cache-control: immutable` for hashed `/assets/*` and `no-cache` for index.html (Vercel does this by default; confirm for the hub-hosted path) | deploy lead | trivial |
| 6 | Cap SSE resume replay (send a snapshot plus `x.resync` beyond N events instead of up to 5000) | hub owner (`apps/hub/src/broker.ts`) | small |
| 7 | Add `hub_events(squad_id, seq)` index only if per-squad event queries get added | hub owner | trivial |
| 8 | Phaser is 328 kB gzip: use a custom Phaser build (disable unused plugins) if village load matters | village owner | medium |
| 9 | Preload Phaser chunk on hover/focus of the Village nav link | web owner | small |
| 10 | Fonts: 155 kB woff2 total, subset Inter latin-ext away if unused | web owner | trivial |

## Repo issue found

`.gitignore` on main contained merge conflict markers (`<<<<<<< HEAD`) when this branch was cut; check it is resolved.
Root `package.json` got `perf:*` scripts (outside the owned paths, required for `pnpm perf:check`).

## Not done (trimmed by request)

10-minute leak run, 4x CPU and Slow 4G sweeps (supported via `CPU=4` env in `perf:runtime`), CDP tracing/flamegraphs, chat render with 2,000 messages, per-agent process memory.
