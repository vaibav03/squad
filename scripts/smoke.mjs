#!/usr/bin/env node
// Usage: pnpm test:smoke <ws>   (ws = bot|agent|hub|web-host|core|brain|mesh|media|village|web, or "all")
import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';

const all = ['apps', 'packages'].flatMap((d) => readdirSync(d).map((n) => `${d}/${n}`));
const ws = process.argv[2];
if (!ws) {
  console.error(
    `usage: pnpm test:smoke <ws|all>\nworkspaces: ${all.map((p) => p.split('/')[1]).join(', ')}`,
  );
  process.exit(2);
}
const dirs = ws === 'all' ? all : all.filter((p) => p.split('/')[1] === ws);
if (dirs.length === 0) {
  console.error(`unknown workstream "${ws}"`);
  process.exit(2);
}
let code = 0;
for (const d of dirs) {
  if (!existsSync(`${d}/package.json`)) continue;
  const r = spawnSync('pnpm', ['--dir', d, 'run', 'test:smoke'], { stdio: 'inherit' });
  code ||= r.status ?? 1;
}
process.exit(code);
