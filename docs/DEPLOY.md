# Deploying Squad

Nothing here has been run against a hosting provider. Everything in "Verified" below was run locally with Docker Desktop.
You decide where it goes live.

## What ships

| Piece | Image / artifact | Notes |
|---|---|---|
| hub | `squad-hub` (Dockerfile target `hub`) | Node 22, non-root (`node`), tini as PID 1, healthcheck `GET /health`, graceful SIGTERM (exits 0 in under a second), SQLite at `/data/squad.db` (volume), ffmpeg included |
| agents | `squad-agent` (target `agent`), 4 containers | one per student (`s_ana`, `s_ben`, `s_cam`, `s_dev`), SQLite in `/app/apps/agent/data` (volume) |
| web | `squad-web` (target `web`) | Vite static build + repo art behind unprivileged nginx. Also the reverse proxy: `/v1/*` and `/health` go to the hub, `/internal` and `/__sim` are blocked |
| bot | `squad-bot` (target `bot`, compose profile `bot`) | Discord transport only in containers (iMessage needs macOS) |

One origin: browsers only talk to `web` (port 8080). The hub derives its call-websocket URL from `HUB_BASE_URL`, which compose sets to `PUBLIC_ORIGIN`. CORS is not involved.

Web build facts: `pnpm build` builds the web host (the only workspace with a build step; the TypeScript packages are executed by `tsx`). Hashed bundles live in `/static` (cached one year, immutable), repo art in `/assets` (one day), `index.html` is `no-cache`. Phaser is a lazy chunk (about 330 KiB gzip) loaded when the village opens. Source maps are off unless `SQUAD_SOURCEMAP=1`. The licensed Modern Interiors pack (`assets/vendor/`) is excluded by `.gitignore` and `.dockerignore`, and CI/preflight fail if vendor art appears in dist; the image only carries the generated fallback art.

Headers on the web container: CSP (script hash for the one inline theme script, `connect-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies, gzip. Brotli is not in stock nginx; use a CDN or Caddy in front if you want it.

Bundle budgets live in `deploy/bundle-budgets.json` (entry 260 KiB gzip, largest lazy chunk 380, total JS 800, CSS 60, dist 8 MiB). Today: entry 184, Phaser 330, total JS 634. Check with `pnpm build && pnpm bundle:report`.

## Configuration

`cp .env.example .env`. Required: `INTERNAL_EVENTS_SECRET` (random, not `change-me`; compose refuses to start without it). Strongly advised: `HUB_AUTH_SECRET`, `PUBLIC_ORIGIN` (the URL users type, e.g. `https://squad.example.com`). Providers: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`; leaving them blank serves the demo model and `/v1/status` says so. `HUB_SEED=1` (default in compose) keeps the demo roster and dev-login alive because real accounts do not exist yet; set `HUB_SEED=0` once they do. Env is injected at runtime only; `.env` is in `.dockerignore`.

Readiness checklist (never prints secrets, never spends credits):

```
pnpm preflight                                   # secrets, origin, sim off, DB dir writable, dist has no maps/vendor art
pnpm preflight --image squad-hub:local           # ffmpeg exists inside the image
pnpm preflight --hub https://squad.example.com   # /health, /v1/status (Gemini real or demo), /internal blocked
pnpm preflight --strict                          # warnings fail too
```

## Path 1: single VM with compose (recommended)

The hub holds long-lived SSE and WebSocket connections and a SQLite file, so a plain VM with a volume is the least surprising host.

```
# on a fresh Ubuntu 24.04 VM (2 vCPU / 4 GB is plenty), as a sudo user
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER && newgrp docker
git clone https://github.com/vaibav03/squad.git && cd squad        # private repo: use a deploy key or token
cp .env.example .env && sed -i "s/^INTERNAL_EVENTS_SECRET=.*/INTERNAL_EVENTS_SECRET=$(openssl rand -hex 32)/" .env
# edit .env: PUBLIC_ORIGIN=https://squad.example.com, GEMINI_API_KEY=..., ELEVENLABS_API_KEY=..., HUB_AUTH_SECRET=$(openssl rand -hex 32)
pnpm dlx tsx scripts/deploy/preflight.ts || true     # optional, needs Node; otherwise skip
docker compose up -d --build --wait
docker compose ps
```

TLS: the stack speaks plain HTTP on `127.0.0.1:8080`. Put Caddy on the host in front (automatic HTTPS, SSE and WebSocket work out of the box):

```
sudo apt install -y caddy
printf 'squad.example.com {\n  reverse_proxy 127.0.0.1:8080 {\n    flush_interval -1\n  }\n}\n' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Open ports 80 and 443 only. Do not publish 8788 or 41xx.

### Logs

All containers log JSON or lines to stdout; compose rotates them (10 MB x 5 per container).

```
docker compose logs -f hub            # also: web, agent-ana ...
docker compose logs --since 1h hub | grep '"level":"error"'
```

### Backups (SQLite)

Hub data is `/data/squad.db` in the `squad_hub-data` volume (WAL mode, so use the online backup API, not `cp`):

```
mkdir -p backups
docker compose exec -T -w /app/packages/core hub node -e "const D=require('better-sqlite3');new D('/data/squad.db').backup('/data/backup.db').then(()=>console.log('ok'))" \
 && docker run --rm -v squad_hub-data:/d -v "$PWD/backups:/b" alpine sh -c 'cp /d/backup.db /b/squad-$(date +%F-%H%M).db && rm /d/backup.db'
# nightly: 15 3 * * * cd /home/ubuntu/squad && <the two lines above>   (and rsync backups/ off the box)
```

Agent databases (`squad_agent-data`) hold the mesh ledger; back up the same way with `docker run --rm -v squad_agent-data:/d -v "$PWD/backups:/b" alpine tar czf /b/agents-$(date +%F).tgz -C /d .` after `docker compose stop agent-ana agent-ben agent-cam agent-dev` (or accept a crash-consistent copy).

Restore: `docker compose stop hub`, copy a backup over `/data/squad.db` via a throwaway container (`docker run --rm -v squad_hub-data:/d -v "$PWD/backups:/b" alpine cp /b/<file> /d/squad.db`; delete stale `squad.db-wal` and `-shm`), `docker compose start hub`.

### Upgrade and rollback

```
git fetch && git checkout <tag-or-sha>
SQUAD_TAG=$(git rev-parse --short HEAD) docker compose build        # new images get a new tag; old ones stay
SQUAD_TAG=$(git rev-parse --short HEAD) docker compose up -d --wait
# rollback: previous tag is still local
git checkout <previous-sha> && SQUAD_TAG=<previous-short-sha> docker compose up -d --wait
```

Take a backup before upgrading; schema migrations (if any) run on hub start and are not reversible by image rollback alone.

### Cost note

One small VM: about 6 to 12 USD/month (Hetzner CX22 or a comparable 2 vCPU / 4 GB), plus the domain. Gemini and ElevenLabs usage is the variable part: the demo model costs nothing, real keys bill per call.

## Path 2: Fly.io or Render for hub + agents, Vercel or Netlify for the static web host

Works, but it splits one origin into two, so CORS, absolute URLs and SSE/WebSocket limits become your problem. Not verified here.

Constraints to respect:
- The hub needs SSE (`/v1/squad/stream`) and WebSocket (`/v1/call/ws/*`) with idle timeouts of an hour or more, a persistent disk for `/data`, and exactly one instance (SQLite, in-memory SSE broker). Do not autoscale it or use scale-to-zero.
- Vercel and Netlify rewrites buffer or time out long-lived streams, so the browser must call the hub's own domain directly (`https://api.squad.example.com`), not through a rewrite.
- Agents and hub must reach each other over a private network (Fly 6PN `*.internal`, Render private services). The hub calls agents via `AGENT_PEERS`, agents call the hub via `HUB_BASE_URL`.

Web host build (Vercel or Netlify): build command `pnpm install --frozen-lockfile && pnpm build:web`, output directory `apps/web-host/dist`, env `VITE_HUB_URL=https://api.squad.example.com`. Repo art must also be published at `/assets`: add a build step `cp -r assets apps/web-host/dist/assets && rm -rf apps/web-host/dist/assets/vendor`. Add an SPA rewrite (`/* -> /index.html`) and the headers from `deploy/nginx/gen-csp.mjs` (change `connect-src` to include the hub origin, `https://api.squad.example.com`, and `wss:` for it).

Hub on Fly.io (one app, volume, no scale-to-zero):

```
fly launch --no-deploy --name squad-hub --dockerfile Dockerfile --build-target hub --internal-port 8788
fly volumes create squad_data --size 3 --region <region>
# fly.toml: [mounts] source="squad_data" destination="/data"; [http_service] auto_stop_machines=false min_machines_running=1
#           [[http_service.checks]] path="/health"; [env] NODE_ENV="production" DB_PATH="/data/squad.db" HUB_PORT="8788"
fly secrets set INTERNAL_EVENTS_SECRET=$(openssl rand -hex 32) HUB_AUTH_SECRET=$(openssl rand -hex 32) \
  GEMINI_API_KEY=... ELEVENLABS_API_KEY=... HUB_BASE_URL=https://api.squad.example.com \
  HUB_CORS_ORIGINS=https://squad.example.com AGENT_PEERS=s_ana=http://squad-agent-ana.internal:4101,...
fly deploy
```

Repeat per agent with `--build-target agent`, a small volume at `/app/apps/agent/data`, `AGENT_ID`, `PORT`, `PEERS`, `HUB_BASE_URL=http://squad-hub.internal:8788`, and the same `INTERNAL_EVENTS_SECRET` (use `fly secrets import` or the same value). On Render: create one Docker Web Service per container with the Dockerfile target set to `hub` or `agent`, a disk at `/data` for the hub, health check `/health`, and Private Services for the agents (not verified).

Cost: Fly hub (shared-cpu-1x 512 MB) plus 4 agents plus a volume is roughly 15 to 25 USD/month; Render's persistent-disk services start around 7 USD each (so 35+ for hub plus agents); Vercel or Netlify static hosting is free at demo scale. The single VM is cheaper and simpler.

## Path 3: local-network demo mode

Same stack, reachable from phones and laptops on the same Wi-Fi, no TLS:

```
cp .env.example .env     # set INTERNAL_EVENTS_SECRET
IP=$(ipconfig getifaddr en0)                       # macOS; Linux: hostname -I | cut -d' ' -f1
PUBLIC_ORIGIN=http://$IP:8080 BIND_ADDR=0.0.0.0 docker compose up -d --build --wait
open http://$IP:8080
```

Without Docker (Node 22 and pnpm only):

```
pnpm install --frozen-lockfile
VITE_HUB_URL=http://$IP:8080 pnpm build:web
HUB_SEED=1 INTERNAL_EVENTS_SECRET=demo-secret-change-me-0123456789 HUB_BASE_URL=http://$IP:8080 pnpm --filter @squad/hub start &
PORT=8080 pnpm tsx scripts/deploy/local-proxy.ts
```

Use an https origin if you need the camera or microphone on phones (browsers only allow them on secure origins or localhost); `PUBLIC_ORIGIN=https://...` plus a tunnel or Caddy covers it.

## CI

`.github/workflows/deploy.yml` (separate from `ci.yml`): builds the web bundle and fails on budget overruns, uploads the bundle report, runs `docker compose config`, hadolint (errors only), builds all four images without pushing, checks ffmpeg in the hub image, smoke-tests the hub container (SIGTERM must exit 0), then boots the full compose stack and curls the web host, SPA fallback, `/health`, `/v1/status`, CSP header, and the blocked `/internal` route through the proxy.

## Known gaps

- Hub image is large (about 1.3 GB) because the workspace is installed with dev dependencies and runs TypeScript through tsx; a compiled bundle would shrink it, but that needs a build step the packages do not have.
- `HUB_SEED=1` is required for any login today (dev-login). Real accounts are another lead's work.
- Brotli, rate limiting and TLS are left to the edge (Caddy or a CDN).
- The bot container was built but not run (needs a Discord token); iMessage cannot run in Linux containers.
