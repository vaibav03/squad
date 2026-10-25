import { describe, expect, it } from 'vitest';
import { PLAN_OPEN_EVENT, PLAN_TABLE_H, PLAN_TABLE_W, paintPlanTable } from './plan';
import { createLayout } from '../world/layout';

describe('study plan table', () => {
  it('has a slot, a stable event name and a painted raster', () => {
    expect(createLayout().slot('plan-table').kind).toBe('plan-board');
    expect(PLAN_OPEN_EVENT).toBe('squad:plan-open');
    const r = paintPlanTable(0, true);
    expect([r.w ?? PLAN_TABLE_W, r.h ?? PLAN_TABLE_H]).toEqual([PLAN_TABLE_W, PLAN_TABLE_H]);
    expect(r.hash()).toBe(paintPlanTable(900, true).hash());
  });
});
