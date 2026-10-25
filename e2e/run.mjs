#!/usr/bin/env node
// pnpm e2e [playwright args]   |   LIVE=1 pnpm e2e   |   E2E_REUSE=1 pnpm e2e (use an already running stack)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, stdio: 'inherit', env: process.env });
if (!existsSync(join(dir, 'node_modules/.bin/playwright'))) {
  if (run('pnpm', ['install', '--ignore-workspace']).status !== 0) process.exit(1);
}
run('pnpm', ['exec', 'playwright', 'install', 'chromium']);
const r = run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)]);
process.exit(r.status ?? 1);
