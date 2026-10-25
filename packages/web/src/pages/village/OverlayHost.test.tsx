// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { OverlayEvent } from '@squad/village';
import { OverlayHost } from './OverlayHost';

afterEach(cleanup);
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

function setup() {
  const onClosed = vi.fn();
  const view = render(<OverlayHost event={null} mode="replay" hub={null} onClosed={onClosed} />);
  const show = (event: OverlayEvent | null) =>
    view.rerender(<OverlayHost event={event} mode="replay" hub={null} onClosed={onClosed} />);
  return { onClosed, show };
}

describe('OverlayHost', () => {
  it('reports a confirm closing exactly once even if Esc lands during the done tick', async () => {
    const { onClosed, show } = setup();
    show({ type: 'openConfirm', taskId: 'task_trip_x', question: 'Go?' });
    await wait(30);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await wait(1100);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await wait(50);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledWith('confirm');
  });

  it('closes from the world side once and ignores a null event after that', async () => {
    const { onClosed, show } = setup();
    show({ type: 'openQuiz', quizId: 'q1', chapter: 'ch5' });
    await wait(600);
    expect(screen.getByRole('dialog')).toBeTruthy();
    show({ type: 'closeOverlay' });
    await wait(400);
    show(null);
    await wait(10);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('treats the hub echo of a call it just left as already handled, but releases the bridge', async () => {
    const { onClosed, show } = setup();
    show({ type: 'openCall', agent: 'expert:ch5', callId: 'x' });
    await wait(50);
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    await wait(400);
    show({ type: 'openCall', agent: 'expert:ch5', callId: 'hub_call_1' });
    await wait(50);
    expect(onClosed).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('live confirm on a non-trip task', () => {
    const hub = { hubUrl: 'http://hub.test', token: 't' };
    const open = async (answerStatus: number) => {
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push(`${init?.method ?? 'GET'} ${url}`);
          if (url.includes('/v1/trips/')) return new Response('{}', { status: 404 });
          if (init?.method === 'POST') return new Response('{}', { status: answerStatus });
          return new Response('{}', { status: 404 });
        }),
      );
      const onClosed = vi.fn();
      const ev: OverlayEvent = {
        type: 'openConfirm',
        taskId: 'task_debate_1',
        question: 'Debate: should exams be open book? Which side argued better?',
      };
      render(<OverlayHost event={ev} mode="live" hub={hub} onClosed={onClosed} />);
      await wait(60);
      return calls;
    };
    afterEach(() => vi.unstubAllGlobals());

    it('Yes shows the done state even though the preview 404s', async () => {
      const calls = await open(200);
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      await wait(50);
      expect(screen.getByText(/Your answer is in/)).toBeTruthy();
      expect(
        calls.some((c) => c.startsWith('POST') && c.endsWith('/v1/confirms/task_debate_1')),
      ).toBe(true);
    });
    it('a 404 on answering closes the sheet as expired: no buttons, never "Your answer is in"', async () => {
      await open(404);
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      await wait(50);
      expect(screen.getByTestId('confirm-closed').textContent).toMatch(/This question expired\./);
      expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
      expect(screen.queryByText(/Your answer is in/)).toBeNull();
    });
    it('a 409 on answering says Already answered and removes the buttons', async () => {
      await open(409);
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      await wait(50);
      expect(screen.getByTestId('confirm-closed').textContent).toMatch(/Already answered/);
      expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
    });
  });

  describe('closed confirms (hub says expired / answered)', () => {
    const hub = { hubUrl: 'http://hub.test', token: 't' };
    const reask = { chatId: 'group:sq_demo', text: '@cubbie debate: should exams be open book?' };
    const ev: OverlayEvent = {
      type: 'openConfirm',
      taskId: 'task_debate_9',
      question: 'Which side argued better?',
    };
    const mount = async (
      previewRes: () => Response,
      sends: { body: Record<string, unknown> }[] = [],
    ) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === 'POST' && url.endsWith('/v1/chat/send')) {
            sends.push({ body: JSON.parse(String(init.body)) });
            return new Response('{}', { status: 200 });
          }
          if (url.includes('/v1/confirms/')) return previewRes();
          return new Response('{}', { status: 404 });
        }),
      );
      render(<OverlayHost event={ev} mode="live" hub={hub} onClosed={vi.fn()} />);
      await wait(80);
    };
    afterEach(() => vi.unstubAllGlobals());

    it('a stale expired confirm is dropped silently on load: no sheet, the world is told it closed', async () => {
      const onClosed = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ error: { code: 'expired' }, reask }, { status: 404 })),
      );
      render(<OverlayHost event={ev} mode="live" hub={hub} onClosed={onClosed} />);
      await wait(80);
      expect(screen.queryByTestId('confirm-closed')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
      expect(onClosed).toHaveBeenCalledWith('confirm');
    });
    it('an already answered confirm (409) is dropped silently on load', async () => {
      await mount(() =>
        Response.json(
          { error: { code: 'already_answered' }, answer: 'For: open book' },
          { status: 409 },
        ),
      );
      expect(screen.queryByTestId('confirm-closed')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Ask again' })).toBeNull();
    });
    it('a pending preview whose own expiresAt has passed closes as expired', async () => {
      await mount(() =>
        Response.json({
          taskId: 'task_debate_9',
          question: 'Which side argued better?',
          options: ['A', 'B'],
          kind: 'bot',
          mode: 'pick',
          expiresAt: Date.now() + 30,
          reask,
        }),
      );
      await wait(150);
      expect(screen.getByTestId('confirm-closed').textContent).toMatch(/expired/);
      expect(screen.getByRole('button', { name: 'Ask again' })).toBeTruthy();
    });
  });
});
