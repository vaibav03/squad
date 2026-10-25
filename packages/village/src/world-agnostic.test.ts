import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/** The seam for a future top-down world: pure layers carry slot ids and agent ids, never pixels. */
describe('world-agnostic contract', () => {
  for (const dir of ['adapter', 'sources', 'overlay-bridge', 'a11y', 'director']) {
    const base = new URL(`./${dir}/`, import.meta.url);
    const files = readdirSync(base).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'module.ts',
    );
    for (const f of files) {
      it(`${dir}/${f} has no phaser import, layout access or pixel fields`, () => {
        const src = readFileSync(new URL(f, base), 'utf8').replace(
          /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
          '',
        );
        expect(src).not.toMatch(/from ['"]phaser['"]/);
        expect(src).not.toMatch(/\blayout\b/);
        expect(src).not.toMatch(/\breadonly (x|y)\??:\s*number/);
        expect(src).not.toMatch(/\b(x|y):\s*\d/);
      });
    }
  }
});
