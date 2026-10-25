#!/bin/sh
# Starts the e2e stack (demo mode) in the background for use with E2E_REUSE=1. Stop: e2e/stack-down.sh
cd "$(dirname "$0")/.." && exec pnpm exec tsx e2e/lib/stack-cli.ts up
