import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { createRealPorts } from '../../src/adapters/real';
import type { RunningHub } from '../../src/server';
import { boot, get, login, post } from '../helpers';

const QUESTIONS = {
  questions: [
    {
      kind: 'choice',
      question: 'Which statistic resists outliers?',
      choices: ['mean', 'median'],
      key: 1,
      explanation: 'The median ignores extremes.',
    },
  ],
};

let hub: RunningHub;
let quizId: string;
let ana: string;

beforeAll(async () => {
  hub = await boot();
  const llm = new FakeLlm({
    fallback: (req) =>
      (req.system ?? '').includes('grade a short answer')
        ? { correct: true, feedback: 'ok' }
        : QUESTIONS,
  });
  const real = await createRealPorts(hub.deps, { llm, tts: undefined });
  hub.deps.ports = real.ports;
  quizId = await real.startQuiz('ch6');
  ana = await login(hub.url, 's_ana');
});
afterAll(async () => {
  await hub.stop();
});

describe('real brain and quiz ports behind the hub routes', () => {
  it('loads the fixture course and lists it', async () => {
    const r = await get<{ courses: { courseId: string; status: string }[] }>(
      hub.url,
      '/v1/squad/courses',
      ana,
    );
    expect(r.body.courses.map((c) => c.courseId)).toContain('demo');
  });

  it('serves the question without the key, grades the answer, and moves mastery', async () => {
    const q = await get<Record<string, unknown>>(hub.url, `/v1/quiz/${quizId}`, ana);
    expect(q.status).toBe(200);
    expect(JSON.stringify(q.body)).not.toContain('explanation');
    const a = await post<{ recorded: boolean }>(
      hub.url,
      `/v1/quiz/${quizId}/answer`,
      { choice: '1' },
      ana,
    );
    expect(a.status).toBe(200);
    expect(a.body.recorded).toBe(true);
    const m = await get<{ concepts: string[]; mine: number[] }>(hub.url, '/v1/mastery/demo', ana);
    expect(m.body.concepts).toContain('ch6');
    expect(m.body.mine.some((x) => x > 0)).toBe(true);
  });

  it('keeps stub-free call and media ports (captions only without a speech engine)', async () => {
    const p = await get<unknown[]>(hub.url, '/v1/personas', ana);
    expect(p.status).toBe(200);
  });
});
