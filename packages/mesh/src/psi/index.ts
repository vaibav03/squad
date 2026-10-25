import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';
import { seededRng, shuffle, type Rng } from '../crypto/rng.js';

export const PSI_DST = 'squad-mesh/psi/v1/ristretto255_XMD:SHA-512_R255MAP_RO_';
export const PSI_PAD_STUDY = 168;
export const PSI_PAD_TRIP = 64;
/** 64 lowercase hex chars, canonical ristretto255 encoding. */
export type HexPoint = string;

type Point = InstanceType<typeof ristretto255.Point>;
const ORDER: bigint = ristretto255.Point.Fn.ORDER;
const enc = new TextEncoder();
const HEX_RE = /^[0-9a-f]{64}$/;

function bytesToBigint(b: Uint8Array): bigint {
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x;
}

function decode(h: HexPoint): Point {
  if (typeof h !== 'string' || !HEX_RE.test(h)) throw new Error('psi: invalid point encoding');
  let p: Point;
  try {
    p = ristretto255.Point.fromHex(h);
  } catch {
    throw new Error('psi: invalid point encoding');
  }
  if (p.is0()) throw new Error('psi: identity point rejected');
  return p;
}

function encode(p: Point): HexPoint {
  return p.toHex();
}

function hashLabel(label: string): Point {
  return ristretto255_hasher.hashToCurve(enc.encode(label), { DST: PSI_DST }) as Point;
}

export function psiKeygen(rng: Rng): bigint {
  // 64 bytes mod (ORDER-1), +1: negligible bias, range [1, ORDER-1]
  return (bytesToBigint(rng(64)) % (ORDER - 1n)) + 1n;
}

function checkSecret(secret: bigint): void {
  if (typeof secret !== 'bigint' || secret < 1n || secret >= ORDER) throw new RangeError('psi: secret out of range');
}

export function psiPrepare(
  secret: bigint,
  items: readonly string[],
  o: { padTo: number; rng: Rng },
): { blinded: HexPoint[]; index: (string | null)[] } {
  checkSecret(secret);
  if (!Number.isInteger(o.padTo) || o.padTo < 0) throw new RangeError('psi: invalid padTo');
  if (items.length > o.padTo) throw new RangeError('psi: padTo smaller than item count');
  const seen = new Set<string>();
  for (const it of items) {
    if (typeof it !== 'string' || it.length === 0) throw new Error('psi: items must be non-empty strings');
    if (seen.has(it)) throw new Error('psi: duplicate item');
    seen.add(it);
  }
  const entries: { label: string | null; point: HexPoint }[] = items.map((label) => ({
    label,
    point: encode(hashLabel(label).multiply(secret)),
  }));
  while (entries.length < o.padTo) {
    const pad = ristretto255_hasher.hashToCurve(o.rng(32), { DST: PSI_DST }) as Point;
    entries.push({ label: null, point: encode(pad.multiply(secret)) });
  }
  const shuffled = shuffle(o.rng, entries);
  return { blinded: shuffled.map((e) => e.point), index: shuffled.map((e) => e.label) };
}

export function psiApply(secret: bigint, points: readonly HexPoint[]): HexPoint[] {
  checkSecret(secret);
  return points.map((h) => encode(decode(h).multiply(secret)));
}

export function psiTokens(finalPoints: readonly HexPoint[]): HexPoint[] {
  return [...new Set(finalPoints)].sort();
}

export function psiIntersect(tokenSets: readonly (readonly HexPoint[])[]): HexPoint[] {
  if (tokenSets.length === 0) return [];
  let acc = new Set(tokenSets[0]!);
  for (const s of tokenSets.slice(1)) {
    const next = new Set(s);
    acc = new Set([...acc].filter((t) => next.has(t)));
  }
  return [...acc].sort();
}

export function psiResolve(
  index: (string | null)[],
  finalPoints: readonly HexPoint[],
  common: readonly HexPoint[],
): string[] {
  if (index.length !== finalPoints.length) throw new Error('psi: index/points length mismatch');
  const c = new Set(common);
  const out: string[] = [];
  index.forEach((label, i) => {
    if (label !== null && c.has(finalPoints[i]!)) out.push(label);
  });
  return out;
}

export function runRingPsi(
  parties: { id: string; items: string[] }[],
  o: { padTo: number; seed: string },
): {
  common: Record<string, string[]>;
  mediatorView: { tokenCounts: Record<string, number>; common: HexPoint[] };
  wire: { from: string; to: string; points: HexPoint[] }[];
} {
  const n = parties.length;
  const ids = new Set(parties.map((p) => p.id));
  if (ids.size !== n) throw new Error('psi: duplicate party id');
  const rng = seededRng(o.seed);
  const keys = parties.map(() => psiKeygen(rng));
  const wire: { from: string; to: string; points: HexPoint[] }[] = [];
  const finals: HexPoint[][] = [];
  const indexes: (string | null)[][] = [];
  parties.forEach((p, i) => {
    const prep = psiPrepare(keys[i]!, p.items, { padTo: o.padTo, rng });
    indexes.push(prep.index);
    let pts = prep.blinded;
    let holder = i;
    for (let h = 1; h < n; h++) {
      const next = (i + h) % n;
      wire.push({ from: parties[holder]!.id, to: parties[next]!.id, points: pts });
      pts = psiApply(keys[next]!, pts);
      holder = next;
    }
    if (n > 1) wire.push({ from: parties[holder]!.id, to: p.id, points: pts });
    finals.push(pts);
  });
  const tokenSets = finals.map(psiTokens);
  const common = psiIntersect(tokenSets);
  const out: Record<string, string[]> = {};
  const tokenCounts: Record<string, number> = {};
  parties.forEach((p, i) => {
    out[p.id] = psiResolve(indexes[i]!, finals[i]!, common);
    tokenCounts[p.id] = tokenSets[i]!.length;
  });
  return { common: out, mediatorView: { tokenCounts, common }, wire };
}

