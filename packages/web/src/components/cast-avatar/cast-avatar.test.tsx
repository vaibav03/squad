// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CastAvatar } from './CastAvatar';
import { castName } from './busts';

afterEach(cleanup);

const ROOT = resolve(__dirname, '../../../../../assets/pixel/composed/characters');
const IDS = ['cast-chill', 'cast-grind', 'cast-advisor', 'cast-chair'];
const png = (p: string) => {
  const b = readFileSync(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

describe('council cast art', () => {
  const atlas = JSON.parse(readFileSync(`${ROOT}/atlas.json`, 'utf8'));
  const { w: aw, h: ah } = png(`${ROOT}/atlas.png`);
  it('atlas size matches the png and every frame is inside it', () => {
    expect(atlas.meta.size).toEqual({ w: aw, h: ah });
    for (const id of IDS) {
      for (const k of Object.keys(atlas.frames).filter((f) => f.startsWith(`${id}/`))) {
        const f = atlas.frames[k].frame;
        expect(f.x + f.w).toBeLessThanOrEqual(aw);
        expect(f.y + f.h).toBeLessThanOrEqual(ah);
      }
    }
  });
  it('has the promised frame counts and strips match them', () => {
    const want = { idle: 4, talk: 4, think: 4, walk: 4, sit: 2, wave: 2 } as const;
    for (const id of IDS) {
      for (const [anim, n] of Object.entries(want)) {
        expect(atlas.animations[id][anim].frames).toHaveLength(n);
        expect(png(`${ROOT}/${id}/${anim}.png`)).toEqual({ w: 32 * n, h: 32 });
      }
      expect(png(`${ROOT}/${id}/bust.png`)).toEqual({ w: 128, h: 96 });
    }
  });
});

describe('CastAvatar', () => {
  it('renders a labelled, pixelated, integer-scaled bust with state text', () => {
    render(<CastAvatar name="Chairman" state="talk" size={3} />);
    const el = screen.getByRole('img', { name: 'Chairman, speaking' });
    expect(el.getAttribute('data-cast')).toBe('chair');
    expect(el.style.getPropertyValue('--ca-s')).toBe('3');
    expect(el.style.getPropertyValue('--ca-row')).toBe('1');
  });
  it('rounds a fractional size and ignores unknown names', () => {
    const { container, rerender } = render(<CastAvatar name="chill" size={2.6} />);
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--ca-s')).toBe('3');
    rerender(<CastAvatar name="nobody" />);
    expect(container.firstChild).toBeNull();
    expect(castName('GRIND')).toBe('grind');
  });
  it('marks calm so CSS shows the static first frame', () => {
    render(<CastAvatar name="advisor" calm />);
    expect(screen.getByRole('img').getAttribute('data-calm')).toBe('true');
  });
  it('stylesheet stops the loop under reduced motion and calm', () => {
    const css = readFileSync(resolve(__dirname, 'cast-avatar.css'), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*\.ca\s*{\s*animation: none/);
    expect(css).toMatch(/data-calm='true'\]/);
    expect(css).toMatch(/image-rendering: pixelated/);
    expect(css).not.toMatch(/transition:\s*all/);
  });
});
