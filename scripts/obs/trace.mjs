#!/usr/bin/env node
// usage: node scripts/obs/trace.mjs <corr-id> <logfile...>   prints JSON log lines carrying the id, in time order
import { readFileSync } from 'node:fs';
const [id, ...files] = process.argv.slice(2);
if (!id || files.length === 0) {
  console.error('usage: trace.mjs <corr-id> <logfile...>');
  process.exit(2);
}
const rows = [];
for (const f of files)
  for (const l of readFileSync(f, 'utf8').split('\n')) if (l.includes(id)) rows.push(l);
rows.sort();
console.log(rows.join('\n'));
