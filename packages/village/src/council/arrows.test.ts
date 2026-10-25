import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARROW_CALM_ALPHA,
  ARROW_LIFE_MS,
  ARROW_WIDTH,
  arrowHead,
  councilRole,
  planArrows,
  seatPositions,
  type ArrowLink,
  type Pt,
} from './arrows';
import { KIND_LABEL } from './model';
import type { A2aKind } from './types';

const pos = new Map<string, Pt>([
  ['council:ask-chair', { x: 0, y: 0 }],
  ['council:ask-skeptic', { x: 60, y: 0 }],
  ['council:ask-teacher', { x: 30, y: 40 }],
  ['council:ask-practitioner', { x: 90, y: 40 }],
]);
const ids = [...pos.keys()];
const link = (i: number, at: number, kind: A2aKind = 'ask'): ArrowLink => ({
  messageId: `m${i}`,
  from: ids[i % 4]!,
  to: ids[(i + 1) % 4]!,
  kind,
  at,
});

describe('planArrows', () => {
  it('shows at most 3 arrows, newest win', () => {
    const links = [0, 1, 2, 3, 4].map((i) => link(i, 1000 + i * 20));
    const a = planArrows(links, pos, { calm: false, now: 1200 });
    expect(a).toHaveLength(3);
    expect(a.map((x) => x.key)).toEqual(['m2', 'm3', 'm4']);
  });

  it('fades in over 160 ms and out over 600 ms after settle', () => {
    const l = [link(0, 0)];
    const at = (now: number) => planArrows(l, pos, { calm: false, now })[0]?.alpha ?? 0;
    expect(at(0)).toBe(0);
    expect(at(80)).toBeGreaterThan(0.3); // ease-out is front loaded
    expect(at(160)).toBeCloseTo(0.7, 2);
    expect(at(480 + 600)).toBeCloseTo(0.7, 2); // held until 600 ms after settle
    expect(at(480 + 600 + 300)).toBeLessThan(0.7);
    expect(planArrows(l, pos, { calm: false, now: ARROW_LIFE_MS })).toHaveLength(0);
  });

  it('packet travels 320 ms after the arc is in, one per arrow', () => {
    const l = [link(0, 0)];
    const pk = (now: number) => planArrows(l, pos, { calm: false, now })[0]?.packetT ?? null;
    expect(pk(100)).toBeNull();
    expect(pk(160)).toBe(0);
    const mid = pk(320)!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(pk(480)).toBe(1);
    expect(pk(481)).toBeNull();
  });

  it('caps packets below 3 per second', () => {
    const links = [0, 1, 2].map((i) => link(i, i * 100));
    const a = planArrows(links, pos, { calm: false, now: 400 });
    expect(a.filter((x) => x.packetT !== null).length).toBeLessThanOrEqual(2);
  });

  it('is static in calm mode with no packet and steady alpha', () => {
    for (const now of [0, 100, 500, 1200]) {
      const a = planArrows([link(0, 0)], pos, { calm: true, now });
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ static: true, packetT: null, alpha: ARROW_CALM_ALPHA });
    }
  });

  it('labels with the kind word and never leaks raw ids', () => {
    const a = planArrows([link(0, 0, 'ask'), link(1, 10, 'critique')], pos, {
      calm: true,
      now: 50,
    });
    expect(a.map((x) => x.label)).toEqual([KIND_LABEL.ask, KIND_LABEL.critique]);
    for (const x of a) {
      expect(x.title).not.toMatch(/council:|ask-/);
      expect(x.label).not.toMatch(/:/);
    }
  });

  it('has one width and no per-kind or per-importance field', () => {
    expect(ARROW_WIDTH).toBe(1);
    const a = planArrows(
      (Object.keys(KIND_LABEL) as A2aKind[]).map((k, i) => link(i, 0, k)),
      pos,
      { calm: true, now: 10, max: 8 },
    );
    expect(a.length).toBeGreaterThan(1);
    const keys = new Set(a.flatMap((x) => Object.keys(x)));
    expect([...keys].some((k) => /width|color|colour|weight|importance|score/i.test(k))).toBe(
      false,
    );
    expect(new Set(a.map((x) => x.alpha)).size).toBe(1);
  });

  it('skips links whose ends have no position', () => {
    const l: ArrowLink = { ...link(0, 0), to: 'council:ask-ghost' };
    expect(planArrows([l], pos, { calm: true, now: 10 })).toHaveLength(0);
  });

  it('arrowhead sits at the target', () => {
    expect(arrowHead({ x: 0, y: 0 }, { x: 60, y: 0 })[0]).toEqual({ x: 60, y: 0 });
  });
});

describe('seatPositions', () => {
  const seats = [
    { who: 'solver-a', x: 50, y: 103 },
    { who: 'solver-b', x: 112, y: 121 },
    { who: 'solver-c', x: 174, y: 103 },
    { who: 'chair', x: 112, y: 89 },
  ];
  it('maps chair and members, skipping other councils', () => {
    const links = [
      { ...link(0, 0), from: 'council:quizkey-chair', to: 'council:quizkey-solver-b' },
      { ...link(1, 0), from: 'council:ask-chair', to: 'council:ask-skeptic' },
    ];
    const r = seatPositions(links, seats, 'council:quizkey');
    expect(r.links).toHaveLength(1);
    expect(r.positions.get('council:quizkey-chair')).toEqual({ x: 112, y: 89 });
    expect(r.positions.get('council:quizkey-solver-b')).toEqual({ x: 112, y: 121 });
  });
  it('gives unseated roles a free member seat', () => {
    const l = { ...link(0, 0), from: 'council:ask-skeptic', to: 'council:ask-teacher' };
    const r = seatPositions([l], seats, 'council:ask');
    expect(r.positions.size).toBe(2);
    expect(councilRole('council:ask-skeptic')).toEqual({ council: 'ask', role: 'skeptic' });
  });
});

describe('world-agnostic', () => {
  it('arrows.ts is pure (no phaser, no web code)', () => {
    const src = readFileSync(new URL('./arrows.ts', import.meta.url), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      '',
    );
    expect(src).not.toMatch(/from ['"]phaser['"]/);
    expect(src).not.toMatch(/@squad\/web|packages\/web/);
  });
  it('module.ts does not import web code', () => {
    const src = readFileSync(new URL('./module.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/@squad\/web|packages\/web|\.\.\/\.\.\/web/);
  });
});
