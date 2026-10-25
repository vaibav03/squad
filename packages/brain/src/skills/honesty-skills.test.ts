import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUnwrappedScripted } from '@squad/core';

const HELPERS = [
  'stock',
  'fallbackQuestion',
  'pickDemo',
  'defaultWhy',
  'rubricUnavailableReply',
  'fallbackSummary',
];
const ROOT = join(__dirname);

/** Owned by other workstreams (round table, debate); reported, not failing. */
const PENDING = [/^courseplan\//, /^debate\//];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.ts$/.test(n) && !/\.(test|script)\.ts$/.test(n) ? [p] : [];
  });

const offenders = files(ROOT).flatMap((f) =>
  findUnwrappedScripted(readFileSync(f, 'utf8'), HELPERS).map((o) => ({
    file: relative(ROOT, f),
    ...o,
  })),
);

describe('skills honesty lint: scripted text only through scripted()', () => {
  it('single-agent judges (oracle, rubric, devilta, oral) have no unwrapped stock helper', () => {
    const bad = offenders.filter((o) => !PENDING.some((r) => r.test(o.file)));
    expect(bad).toEqual([]);
  });
  it('reports (does not fail on) files owned by other workstreams', () => {
    const pending = offenders.filter((o) => PENDING.some((r) => r.test(o.file)));
    if (pending.length) console.info('unwrapped in pending workstreams:', pending);
    expect(Array.isArray(pending)).toBe(true);
  });
});
