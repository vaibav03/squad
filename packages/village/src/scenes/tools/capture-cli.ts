import { resolve } from 'node:path';
import { BUNDLES } from '../index';
import { captureBundle } from './capture';

// usage: pnpm --filter @squad/village capture [sceneId...]
const only = new Set(process.argv.slice(2));
const out = resolve(import.meta.dirname, '../../../../../docs/design/shots/village-scenes');
let n = 0;
for (const b of BUNDLES) {
  if (only.size && !only.has(b.def.id)) continue;
  for (const f of captureBundle(b, out)) {
    console.log(f);
    n++;
  }
}
console.log(`${n} frame sheets -> ${out}`);
