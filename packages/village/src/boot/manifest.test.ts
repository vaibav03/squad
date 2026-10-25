import { describe, expect, it } from 'vitest';
import { mergeSpecs, parseManifest } from './manifest';

describe('parseManifest', () => {
  it('maps kinds, variants and skips fonts and bad entries', () => {
    const { specs, skipped } = parseManifest({
      assets: [
        {
          id: 'house.hut',
          kind: 'image',
          file: 'assets/a/hut_lit.png',
          variants: { lit: 'assets/a/hut_lit.png', dark: 'assets/a/hut_dark.png' },
        },
        {
          id: 'vehicle.van',
          kind: 'spritesheet',
          file: 'assets/v.png',
          frame: { w: 10, h: 8, count: 2 },
        },
        { id: 'atlas.characters', kind: 'atlas', file: 'assets/c.png', atlasJson: 'assets/c.json' },
        { id: 'font.x', kind: 'font', file: 'assets/f.ttf' },
        { id: 'broken', kind: 'spritesheet', file: 'assets/b.png' },
        { nonsense: true },
      ],
    });
    expect(specs.map((s) => s.key)).toEqual([
      'house.hut',
      'house.hut:dark',
      'vehicle.van',
      'atlas.characters',
    ]);
    expect(skipped).toBe(2);
  });
  it('tolerates garbage', () => {
    expect(parseManifest(null).specs).toEqual([]);
    expect(parseManifest('x').specs).toEqual([]);
  });
  it('later lists win by key', () => {
    const out = mergeSpecs(
      [{ type: 'image', key: 'a', path: 'old' }],
      [{ type: 'image', key: 'a', path: 'new' }],
    );
    expect(out).toEqual([{ type: 'image', key: 'a', path: 'new' }]);
  });
});
