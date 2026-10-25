// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPending,
  healFromTrips,
  isPlayed,
  markPlayed,
  nextPending,
  readPending,
  runGate,
  type GateDeps,
} from './trip-cutscene';
import { isStaleConfirm } from './OverlayHost';

const V = 'u1';
const NOW = 1_800_000_000_000;
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
beforeEach(() => mem.clear());

describe('pending / played store', () => {
  it('records pending durably and marks played once', () => {
    addPending(V, { taskId: 'task_a', confirmedAt: NOW });
    expect(nextPending(V, NOW)?.taskId).toBe('task_a');
    markPlayed(V, 'task_a');
    expect(isPlayed(V, 'task_a')).toBe(true);
    expect(readPending(V)).toEqual([]);
    expect(nextPending(V, NOW)).toBeUndefined();
  });
  it('self-heals from GET /v1/trips: recent, confirmed, unplayed only; newest wins', () => {
    markPlayed(V, 'task_done');
    healFromTrips(
      V,
      {
        trips: [
          { tripId: 'old', taskId: 'task_old', status: 'confirmed', confirmedAt: NOW - 25 * 3600e3 },
          { tripId: 'done', taskId: 'task_done', status: 'confirmed', confirmedAt: NOW - 1000 },
          { tripId: 'voting', taskId: 'task_v', status: 'voting' },
          { tripId: 'a', taskId: 'task_a', status: 'confirmed', confirmedAt: NOW - 2000 },
          { tripId: 'b', taskId: 'task_b', status: 'confirmed', confirmedAt: NOW - 500 },
        ],
      },
      NOW,
    );
    expect(readPending(V).map((p) => p.taskId).sort()).toEqual(['task_a', 'task_b']);
    expect(nextPending(V, NOW)?.taskId).toBe('task_b');
  });
});

describe('gate', () => {
  const mk = (o: Partial<GateDeps> = {}) => {
    const start = vi.fn(() => true);
    const deps: GateDeps = {
      next: () => nextPending(V, NOW),
      ready: () => true,
      blocking: () => false,
      visible: () => true,
      start,
      onStarted: (p) => markPlayed(V, p.taskId),
      ...o,
    };
    return { deps, start };
  };
  beforeEach(() => addPending(V, { taskId: 'task_a', confirmedAt: NOW }));

  it('does not consume while not ready, hidden, or a modal is open', () => {
    for (const o of [{ ready: () => false }, { visible: () => false }, { blocking: () => true }]) {
      const { deps, start } = mk(o);
      expect(runGate(deps)).toBe(false);
      expect(start).not.toHaveBeenCalled();
      expect(readPending(V)).toHaveLength(1);
    }
  });
  it('consumes once when ready and the modal closes', () => {
    let open = true;
    const { deps, start } = mk({ blocking: () => open });
    expect(runGate(deps)).toBe(false);
    open = false;
    expect(runGate(deps)).toBe(true);
    expect(runGate(deps)).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
    expect(isPlayed(V, 'task_a')).toBe(true);
  });
  it('stays pending if the world did not actually start it', () => {
    const { deps } = mk({ start: () => false });
    expect(runGate(deps)).toBe(false);
    expect(readPending(V)).toHaveLength(1);
  });
});

describe('stale confirm', () => {
  it('expired or answered prompts are dropped; live ones open', () => {
    expect(isStaleConfirm({ taskId: 't', closed: 'expired' })).toBe(true);
    expect(isStaleConfirm({ taskId: 't', closed: 'answered' })).toBe(true);
    expect(isStaleConfirm({ taskId: 't', expiresAt: Date.now() - 1 })).toBe(true);
    expect(isStaleConfirm({ taskId: 't', expiresAt: Date.now() + 60_000 })).toBe(false);
    expect(isStaleConfirm({ taskId: 't' })).toBe(false);
  });
});
