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
});
