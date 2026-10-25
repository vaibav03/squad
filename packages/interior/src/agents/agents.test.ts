import { describe, expect, it } from 'vitest';
import { fixtureMapJson } from '../test-fixtures';
import { parseTiledMap } from '../tilemap/parse';
import { RoomRegistry } from '../world/rooms';
import { createRng } from '../world/rng';
import { resolveGoal } from '../nav/goals';
import { direct, seatFor } from './director';
import { nearestInteractable, overlayFor } from './interact';
import { createOverlayBridge } from '../shared/overlay-bridge';
import type { OverlayEvent } from '../api';
import { KeyState } from '../scene/input';
import { loadManifest, mergeManifest, parseManifest, pickSkin, joinUrl } from '../assets/manifest';

const reg = () => new RoomRegistry(parseTiledMap(fixtureMapJson()));

describe('director', () => {
  it('sends a studying agent to the library and an idle one to the commons', () => {
    const s = direct({ t: 'agent.state', agent: 'student:ana', state: 'studying' });
    expect(s).toContainEqual({
      type: 'goto',
      agent: 'student:ana',
      goal: { kind: 'room', room: 'library', prefer: 'library.aisle' },
    });
    const i = direct({ t: 'agent.state', agent: 'student:ana', state: 'idle' });
    expect(i).toContainEqual({
      type: 'goto',
      agent: 'student:ana',
      goal: { kind: 'room', room: 'commons' },
    });
  });
  it('waiting agents stand at the council door; confirm.done unlocks it', () => {
    const w = direct({ t: 'agent.state', agent: 'student:ana', state: 'waiting_for_student' });
    expect(w).toContainEqual({ type: 'marker', agent: 'student:ana', marker: 'waiting' });
    const d = direct({ t: 'confirm.done', student: 'ana', taskId: 't', question: 'q' });
    expect(d).toContainEqual({ type: 'lock', door: 'door-commons-council', locked: false });
    expect(d).toContainEqual({ type: 'marker', agent: 'student:ana', marker: 'check' });
  });
  it('council opinions open the door and seat members stably', () => {
    const c = direct({
      t: 'council.opinion',
      councilId: 'council:plan',
      member: 'council:chill',
      text: 'x',
      dissent: true,
    });
    expect(c[0]).toEqual({ type: 'lock', door: 'door-commons-council', locked: false });
    expect(c).toContainEqual({ type: 'marker', agent: 'council:chill', marker: 'alert' });
    expect(seatFor('council:chill', 5)).toBe(seatFor('council:chill', 5));
    expect(seatFor('a', 5)).toBeGreaterThanOrEqual(1);
    expect(seatFor('a', 5)).toBeLessThanOrEqual(5);
  });
  it('ignores events with no spatial meaning', () => {
    expect(direct({ t: 'mastery.changed', student: 'ana', chapter: '1', box: 2 })).toEqual([]);
    expect(direct({ t: 'ledger.entry', taskId: 't', student: 'ana', field: 'f' })).toEqual([]);
  });
});

describe('resolveGoal', () => {
  it('prefers free waypoints and spreads agents', () => {
    const r = reg();
    const rng = createRng(1);
    const a = resolveGoal({ kind: 'room', room: 'left' }, r, new Set(), rng)!;
    const occupied = new Set([`${Math.floor(a.x / 16)},${Math.floor(a.y / 16)}`]);
    const b = resolveGoal({ kind: 'room', room: 'left' }, r, occupied, rng)!;
    expect(b).not.toEqual(a);
  });
  it('resolves named waypoints and door sides, and returns undefined for unknowns', () => {
    const r = reg();
    expect(resolveGoal({ kind: 'waypoint', name: 'left.a' }, r, new Set(), createRng(1))).toEqual({
      x: 40,
      y: 40,
    });
    expect(
      resolveGoal({ kind: 'door', door: 'door-left-right', side: 'b' }, r, new Set(), createRng(1)),
    ).toEqual({ x: 168, y: 56 });
    expect(
      resolveGoal({ kind: 'waypoint', name: 'zzz' }, r, new Set(), createRng(1)),
    ).toBeUndefined();
    expect(resolveGoal({ kind: 'room', room: 'zzz' }, r, new Set(), createRng(1))).toBeUndefined();
  });
});

describe('interactables', () => {
  const list = parseTiledMap(fixtureMapJson()).interactables;
  it('picks the nearest in radius only', () => {
    expect(nearestInteractable(list, 50, 40)?.def.id).toBe('board');
    expect(nearestInteractable(list, 120, 40)).toBeUndefined();
  });
  it('maps kinds to overlay requests', () => {
    expect(overlayFor({ ...list[0]!, kind: 'ledger' })).toEqual({
      type: 'openLedger',
      taskId: 'current',
    });
    expect(overlayFor({ ...list[0]!, id: 'chalkboard', kind: 'x' })?.type).toBe('openQuiz');
    expect(overlayFor({ ...list[0]!, id: 'plant', kind: 'decor' })).toBeUndefined();
  });
});

describe('overlay bridge', () => {
  it('shows one overlay at a time, queues, dedupes and resumes input', () => {
    const shown: OverlayEvent[] = [];
    let paused = 0;
    let resumed = 0;
    const b = createOverlayBridge({
      onOverlay: (e) => shown.push(e),
      pauseInput: () => paused++,
      resumeInput: () => resumed++,
    });
    b.request({ type: 'openLedger', taskId: 'a' });
    b.request({ type: 'openLedger', taskId: 'a' });
    b.request({ type: 'openQuiz', quizId: 'q', chapter: '1' });
    expect(shown).toHaveLength(1);
    expect(b.open).toBe('ledger');
    b.closed('ledger');
    expect(shown.map((e) => e.type)).toEqual(['openLedger', 'openQuiz']);
    b.closed('quiz');
    expect(resumed).toBe(1);
    expect(paused).toBe(2);
    expect(b.open).toBeUndefined();
  });
  it('relays non-modal requests immediately', () => {
    const shown: OverlayEvent[] = [];
    const b = createOverlayBridge({ onOverlay: (e) => shown.push(e) });
    b.request({ type: 'focusAgent', agent: 'student:ana' });
    expect(shown).toHaveLength(1);
    expect(b.open).toBeUndefined();
  });
});

describe('KeyState', () => {
  it('normalises diagonals and prefers the latest axis for facing', () => {
    const k = new KeyState();
    k.press('ArrowRight');
    expect(k.vector()).toEqual({ x: 1, y: 0 });
    k.press('ArrowDown');
    const v = k.vector();
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 9);
    expect(k.facing('left')).toBe('down');
    k.release('ArrowDown');
    expect(k.facing('left')).toBe('right');
    k.release('ArrowRight');
    expect(k.vector()).toEqual({ x: 0, y: 0 });
    expect(k.facing('up')).toBe('up');
  });
  it('opposing keys cancel and unknown keys are ignored', () => {
    const k = new KeyState();
    k.press('KeyA');
    k.press('KeyD');
    k.press('KeyZ');
    expect(k.vector()).toEqual({ x: 0, y: 0 });
  });
});

describe('asset manifest', () => {
  const base = {
    version: 1,
    pack: 'placeholder',
    tileset: { image: 't.png', def: 't.json' },
    props: { image: 'p.png', def: 'p.json' },
    maps: { demo: 'demo.json' },
    characters: {
      frame: { w: 16, h: 16 },
      anchor: { x: 8, y: 15 },
      anims: { 'walk-down': [0, 1] },
      cast: [
        { id: 'boy', image: 'b.png' },
        { id: 'a', image: 'a.png' },
        { id: 'b', image: 'b2.png' },
      ],
      player: 'boy',
    },
  };
  it('validates and defaults fps', () => {
    expect(parseManifest(base).characters.fps).toBe(8);
    expect(() => parseManifest({ ...base, version: 2 })).toThrow();
  });
  it('deep merges a local override (the licensed pack drop-in)', () => {
    const m = parseManifest(
      mergeManifest(base, {
        pack: 'modern-interiors',
        tileset: { image: 'vendor/ts.png' },
        characters: { frame: { w: 16, h: 32 } },
      }),
    );
    expect(m.pack).toBe('modern-interiors');
    expect(m.tileset).toEqual({ image: 'vendor/ts.png', def: 't.json' });
    expect(m.characters.frame).toEqual({ w: 16, h: 32 });
    expect(m.characters.cast).toHaveLength(3);
  });
  it('falls back to the placeholder when the local manifest is invalid, and when it is absent', async () => {
    const logs: string[] = [];
    const io = (local: unknown) => ({
      fetchJson: async (u: string) => (u.endsWith('manifest.json') ? base : local),
    });
    expect((await loadManifest('/assets', io({ version: 9 }), (m) => logs.push(m))).pack).toBe(
      'placeholder',
    );
    expect(logs).toHaveLength(1);
    expect((await loadManifest('/assets', io(undefined))).pack).toBe('placeholder');
    expect((await loadManifest('/assets', io({ pack: 'x' }))).pack).toBe('x');
    await expect(loadManifest('/assets', { fetchJson: async () => undefined })).rejects.toThrow(
      /not found/,
    );
  });
  it('picks stable skins that are never the player sheet', () => {
    const m = parseManifest(base);
    expect(pickSkin(m, 'student:ana')).toBe(pickSkin(m, 'student:ana'));
    for (const id of ['x', 'y', 'z', 'student:ana']) expect(pickSkin(m, id)).not.toBe('boy');
  });
  it('joins urls', () => {
    expect(joinUrl('/assets/', '/x/y.png')).toBe('/x/y.png');
    expect(joinUrl('/assets/', 'x/y.png')).toBe('/assets/x/y.png');
    expect(joinUrl('/assets', 'https://a.b/c')).toBe('https://a.b/c');
  });
});
