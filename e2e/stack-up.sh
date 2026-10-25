#!/bin/sh
# Starts the e2e dev stack in the background (demo mode) for use with E2E_REUSE=1. Stop: e2e/stack-down.sh
cd "$(dirname "$0")/.." || exit 1
mkdir -p e2e/.tmp
INTERNAL_EVENTS_SECRET=dev-internal-secret DEV_ALL_HUB_PORT=${E2E_HUB_PORT:-8851} DEV_ALL_WEB_PORT=${E2E_WEB_PORT:-5251} \
  DB_PATH="$PWD/e2e/.tmp/hub.db" FORCE_FAKE_LLM=${FORCE_FAKE_LLM:-1} nohup pnpm dev:all > e2e/.tmp/stack.log 2>&1 &
