import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VillageEvent } from '@squad/core';
import { BUNDLES } from '../index';
import type { ShotDef } from '../contract';
import { captureBundle } from './capture';

/**
 * Paint a scene from REAL events dumped as JSON (for example by the brain's skill scripts).
 *   pnpm --filter @squad/village exec tsx src/scenes/tools/capture-events.ts <sceneId> <events.json> <outDir> <name>
 * Timing: opinions at 0 (80 ms apart), ranks at 3 s, the verdict / result at 6 s, so each phase is
 * painted after the previous bubbles' dwell.
 */
const [sceneId, file, outDir, name = 'live'] = process.argv.slice(2);
if (!sceneId || !file || !outDir)
  throw new Error('usage: capture-events <sceneId> <events.json> <outDir> [name]');
const events = JSON.parse(readFileSync(resolve(file), 'utf8')) as VillageEvent[];
const bundle = BUNDLES.find((b) => b.def.id === sceneId);
if (!bundle) throw new Error(`unknown scene ${sceneId}`);

const count: Record<string, number> = {};
const at = (e: VillageEvent, i: number): number => {
  const k = e.t;
  const n = (count[k] = (count[k] ?? 0) + 1) - 1;
  if (e.t === 'agent.state') return i === 0 ? 0 : 6000 + 100;
  if (e.t === 'council.opinion' || e.t === 'quiz.question' || e.t === 'call.start') return n * 80;
  if (e.t === 'council.rank') return 3000 + n * 80;
  return 6000 + n * 80;
};
const script = events.map((event, i) => ({ at: at(event, i), event }));
const shot = (nm: string, sample: number[], view: ShotDef['view'], calm = false): ShotDef => ({
  name: nm,
  view,
  script,
  sample,
  calm,
});
const out = captureBundle(
  {
    def: bundle.def,
    shots: [
      shot(`${name}-interior`, [200, 1500, 3300, 6200, 9500], 'interior'),
      shot(`${name}-exterior`, [200, 3300, 6200], 'exterior'),
      shot(`${name}-interior-calm`, [3300, 9500], 'interior', true),
    ],
  },
  resolve(outDir),
);
for (const f of out) console.log(f);
