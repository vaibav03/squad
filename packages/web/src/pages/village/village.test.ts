import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentPortrait, callAgent } from './agents';
import { callSocketUrl, openStubCall } from './call-session';
import {
  answerQuiz,
  chapterLabel,
  fetchQuiz,
  previewConfirm,
  resolveConfirm,
  confirmErrorMessage,
  userMessage,
  HubError,
} from './hub';
import { loadWorld, registerWorld, worldIds } from './worlds';

const ctx = { hubUrl: 'http://hub.test/', token: 'tok' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('hub helpers', () => {
  it('maps the hub quiz shape to the QuizCard payload and sends the bearer token', async () => {
    const f = vi.fn().mockResolvedValue(
      reply(200, {
        quizId: 'q1',
        chapter: 'ch5',
        question: 'Why?',
        choices: [{ id: 'a', text: 'Because' }],
      }),
    );
    vi.stubGlobal('fetch', f);
    const q = await fetchQuiz(ctx, 'q1');
    expect(q).toEqual({
      quizId: 'q1',
      chapter: 'Ch5',
      question: 'Why?',
      choices: [{ id: 'a', label: 'Because' }],
    });
    expect(f.mock.calls[0]![0]).toBe('http://hub.test/v1/quiz/q1');
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok',
    });
    expect(chapterLabel('Reading')).toBe('Reading');
  });
  it('posts {choice} or {text} and treats 409 as recorded', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { recorded: true, correct: true }))
      .mockResolvedValueOnce(reply(409, {}));
    vi.stubGlobal('fetch', f);
    expect(await answerQuiz(ctx, 'q1', { choice: 'a' })).toEqual({ recorded: true, correct: true });
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      choice: 'a',
    });
    expect(await answerQuiz(ctx, 'q1', { text: 'x' })).toEqual({ recorded: true });
  });
  it('confirms the leading unvetoed trip option', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(404, {})) // no generic preview: falls back to the trip lookup by task id
      .mockResolvedValueOnce(
        reply(200, {
          tripId: 'trip_x',
          options: [{ id: 'o1' }, { id: 'o2' }],
          vetoed: [{ optionId: 'o2' }],
          tallies: { o2: 5, o1: 1 },
        }),
      )
      .mockResolvedValueOnce(reply(200, {}));
    vi.stubGlobal('fetch', f);
    const target = await previewConfirm(ctx, 'task_trip_x');
    expect(target).toMatchObject({ taskId: 'task_trip_x', tripId: 'trip_x', optionId: 'o1' });
    await resolveConfirm(ctx, target, true);
    expect(f.mock.calls[1]![0]).toBe('http://hub.test/v1/trips/trip_x');
    expect(f.mock.calls[2]![0]).toBe('http://hub.test/v1/confirms/task_trip_x');
    expect(JSON.parse((f.mock.calls[2]![1] as RequestInit).body as string)).toEqual({
      optionId: 'o1',
      yes: true,
    });
  });
  it('a non-trip confirm never needs a trip and a 404 preview does not block answering', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(404, {}))
      .mockResolvedValueOnce(reply(200, { ok: true }));
    vi.stubGlobal('fetch', f);
    const target = await previewConfirm(ctx, 'task_debate_1', {
      question: 'Debate: x?',
      options: ['For: a', 'Against: b'],
    });
    expect(target).toEqual({
      taskId: 'task_debate_1',
      question: 'Debate: x?',
      options: ['For: a', 'Against: b'],
    });
    expect(f).toHaveBeenCalledTimes(1); // no /v1/trips lookup
    await resolveConfirm(ctx, target, true, 'For: a');
    expect(f.mock.calls[1]![0]).toBe('http://hub.test/v1/confirms/task_debate_1');
    expect(JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string)).toEqual({
      yes: true,
      optionId: 'For: a',
    });
  });
  it('uses the hub confirm preview (options, question) when it exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reply(200, {
          taskId: 't1',
          question: 'Q?',
          options: ['A', 'B'],
          kind: 'bot',
          mode: 'pick',
        }),
      ),
    );
    expect(await previewConfirm(ctx, 't1')).toEqual({
      taskId: 't1',
      question: 'Q?',
      options: ['A', 'B'],
    });
  });
  it.each([
    [401, 'Your session ended. Sign in again.'],
    [404, 'This question expired: ask again.'],
    [409, 'Already answered.'],
    [500, 'The village could not pass your answer on. Try again. Nothing was shared yet.'],
  ])('maps a %i answer to its own message', async (status, text) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status, {})));
    const e = await resolveConfirm(ctx, { taskId: 't' }, true).catch((x: unknown) => x);
    expect(confirmErrorMessage(e)).toBe(text);
  });
  it('a network failure says it could not reach the village', () => {
    expect(confirmErrorMessage(new TypeError('fetch failed'))).toMatch(/Could not reach/);
  });
  it('never shows status lines or schema errors to the student', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { nonsense: true })));
    const err = await fetchQuiz(ctx, 'q1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(userMessage(err, 'The question did not load.')).toBe('The question did not load.');
    expect(userMessage(new HubError(409, 'busy', 'You are already on a call.'), 'x')).toBe(
      'You are already on a call.',
    );
    expect(userMessage(new HubError(401, 'tok'), 'x')).toBe('Your session ended. Sign in again.');
  });
});

describe('call session', () => {
  it('keeps the hub path but joins on the origin the page already reaches', () => {
    expect(callSocketUrl('https://hub.test/', 'ws://localhost:8788/v1/call/ws/c1', 'a b')).toBe(
      'wss://hub.test/v1/call/ws/c1?st=a%20b',
    );
  });
  it('plays the scripted stub call and ends cleanly', () => {
    vi.useFakeTimers();
    const status: string[] = [];
    const caps: string[] = [];
    const s = openStubCall('expert:ch5', {
      status: (x) => status.push(x),
      caption: (c) => caps.push(c.speaker),
      level: () => {},
    });
    vi.advanceTimersByTime(7000);
    expect(status).toEqual(['connecting', 'live']);
    expect(caps).toEqual(['agent', 'you', 'agent']);
    s.leave();
    s.leave();
    expect(status.at(-1)).toBe('ended');
    expect(status.filter((x) => x === 'ended')).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('world registry and agents', () => {
  it('resolves registered worlds and falls back to the default', async () => {
    const mount = vi.fn();
    registerWorld('interior', async () => mount);
    expect(worldIds()).toContain('village');
    expect(await loadWorld('interior')).toBe(mount);
  });
  it('gives every agent kind a pixel portrait', () => {
    for (const id of ['expert:ch5', 'dean', 'mediator', 'council:q1', 'student:ana'])
      expect(agentPortrait(id)).toBeTruthy();
    expect(callAgent('expert:ch5').name).toBe('Ch5 Expert');
  });
});
