import { describe, expect, it, vi } from 'vitest';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createSkills } from './skills';
import { buildScheduler } from './wiring';

describe('study plan scheduler wiring', () => {
  it('is the brain stub (undefined) unless MESH_COORDINATOR_URL is set', () => {
    expect(buildScheduler({}, 's')).toBeUndefined();
  });

  it('with MESH_COORDINATOR_URL the scheduler asks the agent over /internal/start/study', async () => {
    const calls: { url: string; secret: string; body: { members: string[] } }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        secret: (init?.headers as Record<string, string>)['X-Nook-Internal']!,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(
        JSON.stringify({ flow: 'study', status: 'scheduled', slot: '2026-11-03T15' }),
      );
    }) as unknown as typeof fetch;
    const sched = buildScheduler(
      { MESH_COORDINATOR_URL: 'http://127.0.0.1:4101/', MESH_SQUAD_ID: 'sq_demo' },
      'sekret',
      fetchMock,
    )!;
    const slots = await sched.findSlots(['s_ana', 's_ben'], 60);
    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:4101/internal/start/study',
      secret: 'sekret',
    });
    expect(calls[0]!.body.members).toEqual(['s_ana', 's_ben']);
    expect(slots).toEqual([
      { start: Date.parse('2026-11-03T15:00:00Z'), end: Date.parse('2026-11-03T16:00:00Z') },
    ]);
  });

  it('createSkills accepts the mesh scheduler for the studyPlan skill', async () => {
    const scheduler = { findSlots: vi.fn(async () => []) };
    const skills = await createSkills({
      llm: new FakeLlm({ fallback: 'x' }),
      db: openMemoryDb(),
      emit: () => {},
      scheduler,
    });
    expect(skills.map((s) => s.name)).toContain('studyPlan');
  });
});
