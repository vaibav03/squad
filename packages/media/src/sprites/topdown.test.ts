import { describe, expect, it } from 'vitest';
import { getPersona, upsertPersona } from '../personas/index.js';
import { DIRECTIONS, FramesFileSchema, animKey, loadFrames } from './index.js';
import { resolveSprites } from './source.js';

const anim = (p: string) => ({ frames: [`${p}/0`], frameRate: 8, repeat: -1 });
const topdown = () => {
  const anims: Record<string, ReturnType<typeof anim>> = {};
  const frames: Record<string, unknown> = {};
  for (const d of DIRECTIONS)
    for (const a of ['idle', 'walk']) {
      anims[`${a}/${d}`] = anim(`${a}/${d}`);
      frames[`${a}/${d}/0`] = { strip: `${a}-${d}.png`, x: 0, y: 0, w: 32, h: 32 };
    }
  return {
    version: 3,
    id: 'x',
    view: 'topdown4',
    directions: [...DIRECTIONS],
    cell: { w: 32, h: 32 },
    anchors: { feet: { x: 16, y: 31 }, head: { x: 16, y: 4 }, bubble: { x: 16, y: 1 } },
    portrait: 'portrait.png',
    frames,
    anims,
  };
};

describe('direction-ready atlas and sprite sources', () => {
  it('shipped v2 side files still parse and default to view side', () => {
    const f = loadFrames('cubbie');
    expect(f.view).toBe('side');
    expect(animKey(f, 'walk', 'left')).toBe('walk');
  });
  it('accepts a 4-direction v3 file and keys anims per direction', () => {
    const f = FramesFileSchema.parse(topdown());
    expect(animKey(f, 'walk', 'up')).toBe('walk/up');
  });
  it('rejects a topdown file missing a direction', () => {
    const t = topdown();
    delete (t.anims as Record<string, unknown>)['walk/left'];
    expect(FramesFileSchema.safeParse(t).success).toBe(false);
  });
  it('persona defaults to generated; missing vendor pack falls back', () => {
    expect(resolveSprites('cubbie').fellBack).toBe(false);
    const p = getPersona('cubbie');
    upsertPersona({
      ...p,
      spriteSource: {
        kind: 'imported',
        view: 'topdown4',
        path: 'assets/vendor/nope',
        framesFile: 'frames.json',
      },
    });
    const r = resolveSprites('cubbie', getPersona('cubbie').spriteSource);
    expect(r.fellBack).toBe(true);
    expect(r.framesPath).toBe('assets/sprites/cubbie/frames.json');
    upsertPersona(p);
  });
  it('imported sources must live under assets/vendor', () => {
    expect(() =>
      upsertPersona({
        ...getPersona('cubbie'),
        spriteSource: {
          kind: 'imported',
          view: 'topdown4',
          path: 'assets/sprites/x',
          framesFile: 'f.json',
        },
      }),
    ).toThrow();
  });
});
