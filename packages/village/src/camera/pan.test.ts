import { describe, expect, it } from 'vitest';
import { createCamera } from './index';
import { createLayout } from '../world/layout';
import { createBus } from '../scene-manager/bus';

function fake() {
  const cam = {
    width: 427,
    height: 240,
    scrollX: 0,
    scrollY: 0,
    setRoundPixels() {},
    removeBounds() {},
    setZoom() {},
    setScroll(x: number, y: number) {
      this.scrollX = x;
      this.scrollY = y;
    },
  };
  const store = new Map<string, unknown>();
  const registry = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => void store.set(k, v),
  };
  const scene = { cameras: { main: cam } };
  const player = { x: 1300, isWalking: false };
  const c = createCamera(scene as never, {
    layout: createLayout(),
    player,
    bus: createBus(),
    motion: { easeOut: (t) => t, easeInOut: (t) => t, easeDrawer: (t) => t },
    calm: () => true,
    registry: registry as never,
  });
  return { cam, c };
}

describe('camera.panTo restores the exact previous preset', () => {
  it('returns to the Right preset (mode and fixed centre), not follow', async () => {
    const { cam, c } = fake();
    c.setMode('right');
    c.update(0, 16);
    const rightScroll = cam.scrollX;
    const done = c.panTo(900, { holdMs: 0 });
    for (let i = 0; i < 40; i++) c.update(i * 16, 16);
    await done;
    for (let i = 0; i < 10; i++) c.update(1000 + i * 16, 16);
    expect(c.mode).toBe('right');
    expect(cam.scrollX).toBe(rightScroll);
  });
  it('a pan interrupting a pan still restores the original preset', async () => {
    const { cam, c } = fake();
    c.setMode('left');
    c.update(0, 16);
    const leftScroll = cam.scrollX;
    void c.panTo(900);
    c.update(16, 16);
    const done = c.panTo(1500, { holdMs: 0 });
    for (let i = 0; i < 40; i++) c.update(i * 16, 16);
    await done;
    for (let i = 0; i < 10; i++) c.update(2000 + i * 16, 16);
    expect(c.mode).toBe('left');
    expect(cam.scrollX).toBe(leftScroll);
  });
});
