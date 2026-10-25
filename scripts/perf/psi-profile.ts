/**
 * Profiles the mesh PSI and secret-share cost (the "0.8 s per trip" note).
 *   pnpm perf:psi            # prints JSON, writes docs/perf/data/psi.json
 * Breaks one ring PSI down into hash-to-curve, scalar multiply, decode/encode and the measured end-to-end time,
 * and compares against a precomputed-hash and a fixed-base-window variant (what a speed-up would look like).
 */
import {
  ristretto255,
  ristretto255_hasher,
} from '../../packages/mesh/node_modules/@noble/curves/ed25519.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { runRingPsi, psiKeygen, PSI_DST } from '../../packages/mesh/src/psi/index.ts';
import { secureSum } from '../../packages/mesh/src/secretshare/index.ts';
import { seededRng } from '../../packages/mesh/src/crypto/rng.ts';

/** min-of-5 batch means: the dev box is shared and noisy, the minimum is the stable estimate. */
const ms = (f: () => void, n: number) => {
  f();
  let best = Infinity;
  for (let b = 0; b < 5; b++) {
    const t = performance.now();
    for (let i = 0; i < Math.ceil(n / 5); i++) f();
    best = Math.min(best, (performance.now() - t) / Math.ceil(n / 5));
  }
  return Math.round(best * 1000) / 1000;
};
const enc = new TextEncoder();
const rng = seededRng('perf');
const k = psiKeygen(rng);
const P = ristretto255.Point;
const base = ristretto255_hasher.hashToCurve(enc.encode('slot:1'), {
  DST: PSI_DST,
}) as InstanceType<typeof P>;
const hex = base.multiply(k).toHex();

const prim = {
  hashToCurveMs: ms(
    () => ristretto255_hasher.hashToCurve(enc.encode('slot:' + Math.random()), { DST: PSI_DST }),
    200,
  ),
  scalarMultMs: ms(() => base.multiply(k), 200),
  decodeMs: ms(() => P.fromHex(hex), 500),
  encodeMs: ms(() => base.toHex(), 500),
};

function trip(parties: number, items: number, padTo: number) {
  let best = Infinity;
  for (let r = 0; r < 3; r++) best = Math.min(best, tripOnce(parties, items, padTo));
  return best;
}
function tripOnce(parties: number, items: number, padTo: number) {
  const ps = Array.from({ length: parties }, (_, i) => ({
    id: 'p' + i,
    items: Array.from({ length: items }, (_, j) => `slot:${(j * (i + 2)) % 60}`).filter(
      (v, ix, a) => a.indexOf(v) === ix,
    ),
  }));
  const t = performance.now();
  runRingPsi(ps, { padTo, seed: 's' });
  return Math.round(performance.now() - t);
}
const ring = {
  'trip n=4 pad=64': trip(4, 40, 64),
  'trip n=6 pad=64': trip(6, 40, 64),
  'study n=4 pad=168': trip(4, 100, 168),
  'study n=6 pad=168': trip(6, 100, 168),
};
const mults = (n: number, pad: number) => n * pad * n; // each party's pad points get n multiplies (1 prepare + n-1 apply)
const inputs = Object.fromEntries(
  ['a', 'b', 'c', 'd'].map((m) => [m, Array.from({ length: 168 }, (_, i) => i % 7)]),
);
const ss = ms(() => secureSum(inputs, seededRng('ss')), 20);
const out = {
  node: process.version,
  primitivesMs: prim,
  ringPsiMs: ring,
  scalarMultsPerTrip_n4_pad64: mults(4, 64),
  modelledMultTotalMs_n4_pad64: Math.round(mults(4, 64) * prim.scalarMultMs),
  secureSum_4x168_ms: ss,
};
mkdirSync('docs/perf/data', { recursive: true });
writeFileSync('docs/perf/data/psi.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

// Speed-up candidates (measured, not applied; mesh is owned by another lead).
const unsafe = ms(() => base.multiplyUnsafe(k), 300);
const hashCached = new Map<string, unknown>();
const cachedHash = ms(() => {
  const l = 'slot:7';
  if (!hashCached.has(l))
    hashCached.set(l, ristretto255_hasher.hashToCurve(enc.encode(l), { DST: PSI_DST }));
}, 5000);
const candidates = {
  multiplyMs: prim.scalarMultMs,
  multiplyUnsafeMs: unsafe,
  unsafeSpeedup: Math.round((prim.scalarMultMs / unsafe) * 100) / 100,
  hashLabelCachedMs: cachedHash,
  note: 'multiplyUnsafe gives no consistent win in noble 2.x (negative result, do not adopt). Real levers: fewer multiplies (smaller padTo, cache label hashes) and worker_threads over the n*n*pad independent multiplies.',
};
console.log(JSON.stringify(candidates, null, 2));
writeFileSync('docs/perf/data/psi.json', JSON.stringify({ ...out, candidates }, null, 2));
