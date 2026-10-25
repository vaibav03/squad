import { describe, expect, it, vi } from 'vitest';
import { createOverlayBridge } from './bridge';
import type { OverlayEvent } from './bridge';

const mk = () => {
  let t = 1000;
  const events: OverlayEvent[] = [];
  const pause = vi.fn();
  const resume = vi.fn();
  const focus = vi.fn();
  const b = createOverlayBridge({
    onOverlay: (e) => events.push(e),
    pauseInput: pause,
    resumeInput: resume,
    focusCanvas: focus,
    now: () => t,
  });
  const tick = (ms: number) => (t += ms);
  return { b, events, pause, resume, focus, tick };
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
  it("close for someone else's call neither closes mine nor drops my queued calls", () => {
    const { b, events } = mk();
    b.handle({ overlay: 'openCall', agent: 'a', callId: 'mine' });
    b.handle({ overlay: 'openCall', agent: 'b', callId: 'mine2' });
    b.handle({ overlay: 'close', which: 'call', callId: 'theirs' });
    expect(events.map((e) => e.type)).toEqual(['openCall']);
    expect(b.open).toBe('call');
    b.closed('call');
    expect(events.map((e) => (e as { callId?: string }).callId)).toEqual(['mine', 'mine2']);
    // a matching close drops only the matching queued entry
    b.handle({ overlay: 'openCall', agent: 'c', callId: 'q1' });
    b.handle({ overlay: 'close', which: 'call', callId: 'q1' });
    expect(events.filter((e) => e.type === 'closeOverlay')).toHaveLength(0);
  });
  it('close honours taskId for confirm', () => {
    const { b, events } = mk();
    b.handle({ overlay: 'openConfirm', taskId: 't1', question: '?' });
    b.handle({ overlay: 'close', which: 'confirm', taskId: 't2' });
    expect(b.open).toBe('confirm');
    b.handle({ overlay: 'close', which: 'confirm', taskId: 't1' });
    expect(events.map((e) => e.type)).toEqual(['openConfirm', 'closeOverlay']);
    expect(b.open).toBeUndefined();
  });
  it('ignores a host closed() echo right after a programmatic close', () => {
    const { b, events, tick } = mk();
    b.handle({ overlay: 'openCall', agent: 'a', callId: 'c1' });
    b.handle({ overlay: 'openQuiz', quizId: 'q', chapter: 'c' });
    b.handle({ overlay: 'close', which: 'call', callId: 'c1' });
    expect(b.open).toBe('quiz');
    tick(100);
    b.closed(); // echo of our closeOverlay: must not close the quiz
    expect(b.open).toBe('quiz');
    tick(300);
    b.closed(); // a real close
    expect(b.open).toBeUndefined();
    expect(events.map((e) => e.type)).toEqual(['openCall', 'closeOverlay', 'openQuiz']);
  });
  it('programmatic close with nothing queued resumes input and focuses the canvas', () => {
    const { b, resume, focus } = mk();
    b.handle({ overlay: 'openCall', agent: 'a', callId: 'c1' });
    b.handle({ overlay: 'close', which: 'call', callId: 'c1' });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });
  it('focusAgent never locks input or becomes the current overlay', () => {
    const { b, events, pause } = mk();
    b.openFromAgent('expert:ch1');
    expect(events).toEqual([{ type: 'focusAgent', agent: 'expert:ch1' }]);
    expect(pause).not.toHaveBeenCalled();
    expect(b.open).toBeUndefined();
  });
});
