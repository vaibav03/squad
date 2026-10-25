# syntax=docker/dockerfile:1.7
# Squad production images. One file, four targets: hub, agent, bot, web.
#   docker build --target hub   -t squad-hub .
#   docker build --target agent -t squad-agent .
#   docker build --target bot   -t squad-bot .
#   docker build --target web   -t squad-web .
# Workspace packages export TypeScript sources, so Node services run through tsx (no tsc emit step).
# No secrets are baked: everything comes from the runtime environment. assets/vendor is excluded by .dockerignore.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.23.0

# ---------- base: toolchain for installs (native modules: better-sqlite3, sharp) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/agent/package.json apps/agent/
COPY apps/bot/package.json apps/bot/
COPY apps/hub/package.json apps/hub/
COPY apps/web-host/package.json apps/web-host/
COPY packages/brain/package.json packages/brain/
COPY packages/core/package.json packages/core/
COPY packages/interior/package.json packages/interior/
COPY packages/media/package.json packages/media/
COPY packages/mesh/package.json packages/mesh/
COPY packages/village/package.json packages/village/
COPY packages/web/package.json packages/web/
COPY scripts/demo/package.json scripts/demo/

# ---------- runtime base: slim, non-root, no build tools ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENTRYPOINT ["/usr/bin/tini", "--"]

# ================= hub =================
FROM base AS hub-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@squad/hub..." --filter .
COPY packages/core packages/core
COPY packages/mesh packages/mesh
COPY packages/brain packages/brain
COPY packages/media packages/media
COPY apps/hub apps/hub
COPY assets/sprites assets/sprites
COPY assets/fluent-characters assets/fluent-characters

FROM runtime AS hub
# ffmpeg: podcast / audio mixing in packages/media. Verified by preflight and the CI smoke job.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=hub-deps --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
ENV HUB_PORT=8788 DB_PATH=/data/squad.db
VOLUME ["/data"]
USER node
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${HUB_PORT:-8788}/health || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "apps/hub/src/main.ts"]

# ================= agent (mesh peer, one container per student) =================
FROM base AS agent-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@squad/agent..." --filter .
COPY packages/core packages/core
COPY packages/mesh packages/mesh
COPY apps/agent apps/agent

FROM runtime AS agent
COPY --from=agent-deps --chown=node:node /app /app
RUN mkdir -p /app/apps/agent/data && chown node:node /app/apps/agent/data
VOLUME ["/app/apps/agent/data"]
ENV PORT=4101
USER node
EXPOSE 4101
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-4101}/healthz || exit 1
CMD ["node", "--import", "tsx", "apps/agent/src/main.ts"]

# ================= bot (Discord / chat process; optional compose profile) =================
FROM base AS bot-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@squad/bot..." --filter .
COPY packages/core packages/core
COPY packages/mesh packages/mesh
COPY packages/brain packages/brain
COPY packages/media packages/media
COPY apps/bot apps/bot
COPY assets/sprites assets/sprites
COPY assets/fluent-characters assets/fluent-characters

FROM runtime AS bot
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=bot-deps --chown=node:node /app /app
RUN mkdir -p /app/apps/bot/data /app/apps/bot/logs && chown -R node:node /app/apps/bot/data /app/apps/bot/logs
VOLUME ["/app/apps/bot/data"]
ENV TRANSPORT=discord
USER node
EXPOSE 8790
CMD ["node", "--import", "tsx", "apps/bot/src/main.ts"]

# ================= web: build static assets, serve with unprivileged nginx =================
FROM base AS web-build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@squad/web-host..."
COPY packages/core packages/core
COPY packages/village packages/village
COPY packages/web packages/web
COPY apps/web-host apps/web-host
COPY tsconfig.base.json ./
COPY assets assets
# The hub origin is a runtime sentinel, swapped by the entrypoint (one image works for any domain).
ENV VITE_HUB_URL=http://__SQUAD_PUBLIC_ORIGIN__
RUN pnpm --filter @squad/web-host build
COPY deploy/nginx/gen-csp.mjs /tmp/gen-csp.mjs
RUN node /tmp/gen-csp.mjs apps/web-host/dist/index.html /tmp/security-headers.conf

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
USER root
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/nginx/40-squad-origin.sh /docker-entrypoint.d/40-squad-origin.sh
COPY --from=web-build /app/apps/web-host/dist /usr/share/nginx/html
COPY --from=web-build /tmp/security-headers.conf /etc/nginx/security-headers.conf
# Repo art (generated sprites, fluent art, fonts). assets/vendor is excluded by .dockerignore.
COPY assets /usr/share/nginx/html/assets
RUN chmod +x /docker-entrypoint.d/40-squad-origin.sh \
  && chown -R nginx:nginx /usr/share/nginx/html /etc/nginx/conf.d
USER nginx
ENV PUBLIC_ORIGIN=http://localhost:8080 HUB_UPSTREAM=hub:8788
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
