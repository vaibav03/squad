# Hub on Railway (demo deployment)

`railway.json` (repo root) builds `deploy/railway/Dockerfile.hub` (the `hub` target of `/Dockerfile`, cache mounts removed) and health-checks `/health`.
The web app is deployed separately on Vercel (`vercel.json`). No secrets are committed: set everything below in the Railway service Variables.

## Service setup
1. New project -> Deploy from GitHub repo `vaibav03/squad` (branch `main`). Railway reads `railway.json`.
2. Add a Volume mounted at `/data` (SQLite lives at `/data/squad.db`; without a volume the data resets on every deploy).
3. Settings -> Networking -> Generate Domain, target port `8788`.

## Variables (names; values noted where they are not secret)
| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT`, `HUB_PORT` | `8788` |
| `DB_PATH` | `/data/squad.db` |
| `HUB_SEED` | `1` (demo students and fixture data; required for dev-login) |
| `HUB_SIM` | `1` (simulated classmates, so votes and confirms complete in the demo) |
| `HUB_DEV_LOGIN` | `1` (anyone can sign in as a demo student; fixture data only. Remove for real accounts) |
| `HUB_BASE_URL` | the Railway public URL, e.g. `https://<service>.up.railway.app` |
| `HUB_CORS_ORIGINS` | the Vercel URL, e.g. `https://<project>.vercel.app` (comma separated for several) |
| `HUB_WEB_URL` | the same Vercel URL (OAuth and invite return origin) |
| `INTERNAL_EVENTS_SECRET` | SECRET: long random string (`openssl rand -hex 32`) |
| `HUB_AUTH_SECRET` | SECRET: long random string (`openssl rand -hex 32`) |
| `GEMINI_API_KEY` | SECRET, optional: without it replies are labelled Demo |

Not needed for the demo, and blocked without credentials: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (live Google), `SENDBLUE_*` and `IMESSAGE_*` (iMessage), `ELEVENLABS_API_KEY` (voices), Canvas (signed-in extension session or `.ics` feed).
Student agents (`AGENT_PEERS`) are not part of this single-service deployment: the hub runs without them and the demo answers come from the hub itself.

## Frontend
Vercel project `squad` (this repo, root `vercel.json`): set `VITE_HUB_URL` to the Railway public URL and redeploy.

## Smoke
`curl https://<service>.up.railway.app/health` and `curl https://<service>.up.railway.app/v1/status` (the `gitSha` is the deployed commit).
