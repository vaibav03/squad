import { describe, expect, it } from 'vitest';
import { createHttpCoordinator, createMeshScheduler } from './scheduler';
import { createTestMesh, demoProfiles } from './testkit';
import { parseSlot } from './time';

const ids = ['s_ana', 's_ben', 's_cam', 's_dev'];
const NOW = Date.parse('2026-11-02T00:30:00Z'); // window 2026-11-02T01 .. 2026-11-05T01
const WIN = { from: '2026-11-02T01', to: '2026-11-05T01' };

describe('createMeshScheduler', () => {
  it('maps a scheduled study to one slot of the requested duration', async () => {
    const direct = await createTestMesh().agents.s_ana!.startStudy({
      taskId: 'direct',
      members: ids,
      window: WIN,
    });
    expect(direct).toMatchObject({ status: 'scheduled' });
    const m = createTestMesh();
    const s = createMeshScheduler({ coordinator: m.agents.s_ana!, now: () => NOW });
    const slots = await s.findSlots(ids, 90);
    const slot = (direct as { slot: string }).slot;
    expect(slots).toEqual([{ start: parseSlot(slot), end: parseSlot(slot) + 90 * 60_000 }]);
    expect(slots[0]!.end - slots[0]!.start).toBe(90 * 60_000);
  });

  it('accepts a coordinator factory and structural typing', async () => {
    const m = createTestMesh();
    const s: {
      findSlots(students: string[], durationMin: number): Promise<{ start: number; end: number }[]>;
    } = createMeshScheduler({
      coordinator: () => m.agents.s_ana!,
      now: () => NOW,
      taskId: () => 'x1',
    });
    expect((await s.findSlots(ids, 60)).length).toBe(1);
  });

  it('returns [] for fewer than 2 students and for offline peers', async () => {
    const m = createTestMesh({ offline: ['s_cam'] });
    const s = createMeshScheduler({ coordinator: m.agents.s_ana!, now: () => NOW });
    expect(await s.findSlots(['s_ana'], 60)).toEqual([]);
    expect(await s.findSlots(ids, 60)).toEqual([]);
  });

  it('no common slot yields the hybrid slot or [] per the flow outcome', async () => {
    const profiles = demoProfiles();
    profiles[3]!.calendar = [
      { start: '2026-11-01T00:00:00Z', end: '2026-11-06T00:00:00Z', title: 'away' },
    ];
    const direct = await createTestMesh({ profiles }).agents.s_ana!.startStudy({
      taskId: 'direct',
      members: ids,
      window: WIN,
    });
    expect(direct.status).toBe('no_slot');
    const hybrid = (direct as { hybrid: string | null }).hybrid;
    const m = createTestMesh({ profiles: structuredClone(profiles) });
    const slots = await createMeshScheduler({
      coordinator: m.agents.s_ana!,
      now: () => NOW,
    }).findSlots(ids, 60);
    expect(slots).toEqual(
      hybrid ? [{ start: parseSlot(hybrid), end: parseSlot(hybrid) + 3_600_000 }] : [],
    );
  });

  it('default task ids satisfy the agent id pattern and the window is clamped', async () => {
    const seen: { taskId: string; window: { from: string; to: string } }[] = [];
    const s = createMeshScheduler({
      coordinator: {
        async startStudy(a) {
          seen.push(a);
          return { flow: 'study', status: 'no_slot', hybrid: null };
        },
      },
      now: () => NOW,
      windowDays: 30,
    });
    await s.findSlots(ids, 60);
    expect(seen[0]!.taskId).toMatch(/^[A-Za-z0-9_.:-]{1,64}$/);
    expect(seen[0]!.window).toEqual({ from: '2026-11-02T01', to: '2026-11-09T01' });
  });
});

describe('createHttpCoordinator', () => {
  it('POSTs to /internal/start/study with the internal header', async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const c = createHttpCoordinator({
      url: 'http://agent:1/',
      secret: 'k',
      fetch: (async (url: string, init: RequestInit) => {
        call = { url, init };
        return new Response(
          JSON.stringify({ flow: 'study', status: 'scheduled', slot: '2026-11-03T14' }),
        );
      }) as unknown as typeof fetch,
    });
    const s = createMeshScheduler({ coordinator: c, now: () => NOW });
    const slots = await s.findSlots(ids, 60);
    expect(call!.url).toBe('http://agent:1/internal/start/study');
    expect((call!.init.headers as Record<string, string>)['X-Nook-Internal']).toBe('k');
    expect(slots[0]!.start).toBe(parseSlot('2026-11-03T14'));
  });
});
