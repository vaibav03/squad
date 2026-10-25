/**
 * The Study Plan table landmark (Phaser-free): a planning table with a pinned calendar sheet. Enter opens the
 * in-world Study Plan panel (DOM, in the web host) through `squad:plan-open`. Nothing on it is a score.
 */
import { Raster } from './pixel/raster';
import { drawTextCentered } from './pixel/font';

export const PLAN_OPEN_EVENT = 'squad:plan-open';
export function requestPlanPanel(): void {
  globalThis.dispatchEvent?.(new Event(PLAN_OPEN_EVENT));
}

export const PLAN_TABLE_W = 44;
export const PLAN_TABLE_H = 46;

export function paintPlanTable(t: number, calm: boolean): Raster {
  const r = new Raster(PLAN_TABLE_W, PLAN_TABLE_H);
  // standing sheet on a frame
  r.rect(4, 14, 3, 32, 'wood-dark');
  r.rect(PLAN_TABLE_W - 7, 14, 3, 32, 'wood-dark');
  r.rect(0, 0, PLAN_TABLE_W, 26, 'wood');
  r.frame(0, 0, PLAN_TABLE_W, 26, 'wood-dark');
  r.rect(3, 3, PLAN_TABLE_W - 6, 6, 'ink');
  drawTextCentered(r, PLAN_TABLE_W / 2, 4, 'PLAN', 'cloud-hi');
  // calendar cells
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 5; col++) r.frame(4 + col * 7, 12 + row * 6, 5, 4, 'wall-shade');
  const pulse = calm ? 1 : 0.8 + 0.2 * Math.sin(t / 400);
  r.rect(4 + 7, 12, 5, 4, 'glow', pulse);
  r.rect(4 + 21, 18, 5, 4, 'glow', pulse);
  // table top
  r.rect(0, 32, PLAN_TABLE_W, 4, 'wood-lit');
  r.frame(0, 32, PLAN_TABLE_W, 4, 'wood-dark');
  return r;
}
