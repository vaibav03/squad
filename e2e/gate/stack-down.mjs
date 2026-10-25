#!/usr/bin/env node
// pnpm gate:down: stops the gate stack left running by GATE_KEEP=1. Exact PIDs recorded by lib/stack.ts only.
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const f = join(dirname(fileURLToPath(import.meta.url)), '.tmp/stack.pids');
try {
  for (const pid of Object.values(JSON.parse(fs.readFileSync(f, 'utf8'))))
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  console.log('gate stack stopped');
} catch {
  console.log('no gate stack recorded');
}
