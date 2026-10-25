import type { Rng } from '../crypto/rng.js';

export const SHARE_MODULUS: bigint = (1n << 127n) - 1n;
const P = SHARE_MODULUS;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const HEX_RE = /^[0-9a-f]{32}$/;

function mod(x: bigint): bigint {
  const r = x % P;
  return r < 0n ? r + P : r;
}

function randomFe(rng: Rng): bigint {
  // 24 bytes (192 bits) mod p: bias ~2^-65
  let x = 0n;
  for (const b of rng(24)) x = (x << 8n) | BigInt(b);
  return x % P;
}

function toFe(value: number | bigint): bigint {
  let v: bigint;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError('share: value must be a non-negative safe integer');
    v = BigInt(value);
  } else {
    v = value;
    if (v < 0n || v >= P) throw new RangeError('share: value out of range');
  }
  return v;
}

export function splitSecret(value: number | bigint, n: number, rng: Rng): bigint[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('share: n must be a positive integer');
  const v = toFe(value);
  const shares: bigint[] = [];
  let acc = 0n;
  for (let i = 0; i < n - 1; i++) {
    const s = randomFe(rng);
    shares.push(s);
    acc += s;
  }
  shares.push(mod(v - acc));
  return shares;
}

export function splitVector(values: readonly number[], n: number, rng: Rng): bigint[][] {
  const out: bigint[][] = Array.from({ length: n }, () => []);
  for (const v of values) splitSecret(v, n, rng).forEach((s, j) => out[j]!.push(s));
  return out;
}

export function sumShareVectors(vs: readonly (readonly bigint[])[]): bigint[] {
  if (vs.length === 0) return [];
  const len = vs[0]!.length;
  const out = new Array<bigint>(len).fill(0n);
  for (const v of vs) {
    if (v.length !== len) throw new Error('share: vector length mismatch');
    for (let i = 0; i < len; i++) out[i] = mod(out[i]! + v[i]!);
  }
  return out;
}

export function combineSums(sums: readonly (readonly bigint[])[]): number[] {
  const totals = sumShareVectors(sums);
  return totals.map((t) => {
    if (t > MAX_SAFE) throw new RangeError('share: total is not a count (>= 2^53)');
    return Number(t);
  });
}

export function encodeShares(v: readonly bigint[]): string[] {
  return v.map((x) => {
    if (x < 0n || x >= P) throw new RangeError('share: element out of range');
    return x.toString(16).padStart(32, '0');
  });
}

export function decodeShares(h: readonly string[]): bigint[] {
  return h.map((s) => {
    if (typeof s !== 'string' || !HEX_RE.test(s)) throw new Error('share: invalid share encoding');
    const x = BigInt(`0x${s}`);
    if (x >= P) throw new RangeError('share: element >= modulus');
    return x;
  });
}

export function secureSum(
  inputs: Record<string, number[]>,
  rng: Rng,
): { totals: number[]; wire: { from: string; to: string; share: string[] }[] } {
  const members = Object.keys(inputs);
  const n = members.length;
  if (n === 0) return { totals: [], wire: [] };
  const len = inputs[members[0]!]!.length;
  const received: bigint[][][] = Array.from({ length: n }, () => []);
  const wire: { from: string; to: string; share: string[] }[] = [];
  members.forEach((m) => {
    const vec = inputs[m]!;
    if (vec.length !== len) throw new Error('share: input length mismatch');
    const parts = splitVector(vec, n, rng);
    parts.forEach((p, j) => {
      received[j]!.push(p);
      if (members[j] !== m) wire.push({ from: m, to: members[j]!, share: encodeShares(p) });
    });
  });
  const sums = received.map((r) => sumShareVectors(r));
  return { totals: combineSums(sums), wire };
}
