import { describe, expect, it, vi } from 'vitest';
import { createOverlayBridge } from './bridge';
import type { OverlayEvent } from './bridge';

const mk = () => {
  const events: OverlayEvent[] = [];
  const pause = vi.fn();
  const resume = vi.fn();
  const focus = vi.fn();
  const b = createOverlayBridge({
    onOverlay: (e) => events.push(e),
    pauseInput: pause,
    resumeInput: resume,
    focusCanvas: focus,
  });
  return { b, events, pause, resume, focus };
};

describe('overlay bridge', () => {
  it('opens each overlay type once and pauses input', () => {
    const { b, events, pause } = mk();
    b.handle({ overlay: 'openCall', agent: 'expert:ch5', callId: 'c1' });
    expect(events).toEqual([{ type: 'openCall', agent: 'expert:ch5', callId: 'c1' }]);
    expect(pause).toHaveBeenCalledTimes(1);
    b.closed();
    b.handle({ overlay: 'openQuiz', quizId: 'q', chapter: 'ch5' });
    b.closed();
    b.handle({ overlay: 'openLedger', taskId: 't' });
    b.closed();
    b.handle({ overlay: 'openConfirm', taskId: 't', question: 'Share?' });
    expect(events.map((e) => e.type)).toEqual([
      'openCall',
      'openQuiz',
      'openLedger',
      'openConfirm',
    ]);
  });
  it('dedupes while open and queues FIFO without stacking', () => {
    const { b, events } = mk();
    b.handle({ overlay: 'openCall', agent: 'a', callId: 'c1' });
    b.handle({ overlay: 'openCall', agent: 'a', callId: 'c1' });
    b.handle({ overlay: 'openQuiz', quizId: 'q', chapter: 'c' });
    b.handle({ overlay: 'openQuiz', quizId: 'q', chapter: 'c' });
    b.handle({ overlay: 'openConfirm', taskId: 't', question: '?' });
    expect(events).toHaveLength(1);
    b.closed('call');
    expect(events.map((e) => e.type)).toEqual(['openCall', 'openQuiz']);
    b.closed('quiz');
    expect(events.map((e) => e.type)).toEqual(['openCall', 'openQuiz', 'openConfirm']);
  });
  it('resumes input and refocuses the canvas when the last overlay closes', () => {
    const { b, resume, focus } = mk();
    b.handle({ overlay: 'openLedger', taskId: 't' });
    expect(resume).not.toHaveBeenCalled();
    b.closed('ledger');
    expect(resume).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });
  it('close request tells the host and drops queued overlays of that kind', () => {
    const { b, events } = mk();
    b.handle({ overlay: 'openCall', agent: 'a', callId: 'c1' });
    b.handle({ overlay: 'openQuiz', quizId: 'q', chapter: 'c' });
    b.handle({ overlay: 'close', which: 'call', callId: 'c1' });
    expect(events.map((e) => e.type)).toEqual(['openCall', 'closeOverlay', 'openQuiz']);
  });
  it('notice board and Enter entry points; dispose is final', () => {
    const { b, events } = mk();
    b.openLedger('t1');
    b.closed();
    b.openFromAgent('expert:ch1');
    expect(events.map((e) => e.type)).toEqual(['openLedger', 'focusAgent']);
    b.dispose();
    b.openLedger('t2');
    expect(events).toHaveLength(2);
  });
  it('never invents requests', () => {
    const { b, events } = mk();
    b.closed();
    b.closed('call');
    expect(events).toEqual([]);
  });
});
