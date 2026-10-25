import { describe, expect, it } from 'vitest';
import { PALETTE } from './pixel/palette';
import { Raster } from './pixel/raster';
import { easeInOut, easeOut, minHoldMs } from './curves';
import { initBase, reduceBase, visibleBubbles } from './model/base';
import { routeAgent, routeCouncil } from './routing';
import { bubble } from './art/bubble';
import { npc } from './art/npc';
import { offPalette } from './testkit';
import palette from '../../../../docs/design/palette.json';

describe('scene foundation', () => {
  it('palette matches the master palette', () => {
    expect(PALETTE).toEqual(palette);
  });
  it('curves hit endpoints and are monotone-ish', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.8);
    expect(easeInOut(0.5)).toBeGreaterThan(0.4);
  });
  it('bubbles hold 1.2s per 20 chars and never go below scale 0.95', () => {
    expect(minHoldMs('x'.repeat(41))).toBe(3600);
    let s = initBase();
    s = reduceBase(s, { c: 'bubble', bubble: { who: 'a', text: 'hi', style: 'speech' } }, 1000);
    const early = visibleBubbles(s, { t: 1010, calm: false })[0]!;
    expect(early.scale).toBeGreaterThanOrEqual(0.95);
    expect(visibleBubbles(s, { t: 1000 + 1200, calm: false })).toHaveLength(1);
    expect(visibleBubbles(s, { t: 1000 + 20000, calm: false })).toHaveLength(0);
    expect(visibleBubbles(s, { t: 1500, calm: true })[0]!.scale).toBe(1);
  });
  it('dissent bubbles stay', () => {
    let s = initBase();
    s = reduceBase(s, { c: 'bubble', bubble: { who: 'm', text: 'no', style: 'dissent' } }, 0);
    expect(visibleBubbles(s, { t: 600000, calm: false })).toHaveLength(1);
  });
  it('routing', () => {
    expect(routeCouncil('council:quizkey')).toBe('council-hall');
    expect(routeCouncil('planner')).toBe('round-table');
    expect(routeAgent('expert:ch5')).toBe('chapter-house');
    expect(routeAgent('expert:feynman')).toBe('feynman-porch');
    expect(routeAgent('student:s_ana')).toBeNull();
  });
  it('shared art is palette-locked', () => {
    expect(offPalette(npc({ hair: 'glow', shirt: 'violet', accessory: 'glasses' }).clone())).toBe(
      0,
    );
    expect(offPalette(bubble('Start with chapter 5', 'dissent').r)).toBe(0);
    const r = new Raster(4, 4).rect(0, 0, 4, 4, 'ink');
    expect(offPalette(r)).toBe(0);
  });
});
