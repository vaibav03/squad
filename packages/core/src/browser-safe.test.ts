import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The main entry of @squad/core must stay importable in a browser bundle (village, web, web-host).
// Walk every relative import reachable from src/index.ts and fail on any `node:` import.
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const base = resolve(dirname(file), m[1] as string);
      const cand = [`${base}.ts`, `${base}/index.ts`, base].find(
        (c) => existsSync(c) && c.endsWith('.ts'),
      );
      if (cand) stack.push(cand);
    }
  }
  return [...seen];
}

describe('@squad/core main entry is browser-safe', () => {
  it('imports nothing from node: anywhere in its reachable graph', () => {
    const files = reachable(resolve(__dirname, 'index.ts'));
    const offenders = files.filter((f) => /from\s+['"]node:/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
