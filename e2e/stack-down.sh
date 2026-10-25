#!/bin/sh
cd "$(dirname "$0")/.." && exec pnpm exec tsx e2e/lib/stack-cli.ts down
