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
    it('an expired task says so, not "Nothing was shared"', async () => {
      await open(404);
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      await wait(50);
      expect(screen.getByRole('alert').textContent).toMatch(/expired/);
    });
  });
});
