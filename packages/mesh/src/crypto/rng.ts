import { createHash, randomBytes } from 'node:crypto';

/** Byte source. Production uses `secureRng`; tests and scripted runs use `seededRng`. */
export type Rng = (n: number) => Uint8Array;

export function secureRng(): Rng {
  return (n) => new Uint8Array(randomBytes(n));
}

/** Deterministic SHA-256 counter DRBG. NOT for production secrets: for scripted replays and tests. */
export function seededRng(seed: string): Rng {
  let counter = 0;
  let buf = new Uint8Array(0);
  return (n) => {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      if (buf.length === 0) {
        buf = new Uint8Array(createHash('sha256').update(`${seed}|${counter++}`).digest());
      }
      const take = Math.min(buf.length, n - filled);
      out.set(buf.subarray(0, take), filled);
      buf = buf.subarray(take);
      filled += take;
    }
    return out;
  };
}

/** Unbiased integer in [0, maxExclusive) by rejection sampling. */
export function randomInt(rng: Rng, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32) {
    throw new RangeError('maxExclusive must be an integer in [1, 2^32]');
  }
  const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
  for (;;) {
    const b = rng(4);
    const v = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    if (v < limit) return v % maxExclusive;
  }
}

export function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Stable JSON with sorted keys (replay hashing, deterministic output). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}
