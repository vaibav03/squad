#!/usr/bin/env node
// pnpm gate [playwright args]   |   pnpm gate:live (LIVE=1: real Gemini only if the key has credit, ~1 USD cap)
// Starts its own stack (hub 8927, web 5327, agents 4771-4774, fakes 8940-8949), runs the journey and the variants,
// tears down ONLY the processes it started (exact PIDs), then writes docs/qa/RELEASE-GATE-REPORT.md + .json.
// Exit: 0 no BUILT step failed | 1 a BUILT step failed | 2 harness error | 3 GATE_STRICT=1 and something is NOT_BUILT/BLOCKED.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const e2e = dirname(here);
const root = dirname(e2e);
const run = (cwd, cmd, args, env = process.env) => spawnSync(cmd, args, { cwd, stdio: 'inherit', env });

if (!existsSync(join(e2e, 'node_modules/.bin/playwright'))) {
  if (run(e2e, 'pnpm', ['install', '--ignore-workspace']).status !== 0) process.exit(2);
}
run(e2e, 'pnpm', ['exec', 'playwright', 'install', 'chromium']);
const pw = run(e2e, 'pnpm', ['exec', 'playwright', 'test', '--config', 'gate/playwright.config.ts', ...process.argv.slice(2)]);
const rep = run(root, 'pnpm', ['exec', 'tsx', 'e2e/gate/report.ts']);
const code = rep.status ?? 2;
process.exit(code === 0 && pw.status ? 1 : code);
