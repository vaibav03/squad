// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import {
  CallPanel,
  ConfirmSheet,
  QuizCard,
  callPanelFixtures,
  callReducer,
  confirmSheetFixtures,
  initialCallState,
  quizCardFixtures,
} from './index';
import type { VillageEvent } from '@squad/core';

afterEach(cleanup);
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
};

describe('callReducer', () => {
  const ev = (e: VillageEvent) => e;
  it('opens on call.start, appends captions with citations, ends', () => {
    let s = callReducer(
      initialCallState,
      ev({ t: 'call.start', agent: 'expert:ch5', callId: 'c1', student: 's_ana' }),
      1000,
    );
    expect(s.open).toBe(true);
    s = callReducer(
      s,
      ev({
        t: 'call.caption',
        agent: 'expert:ch5',
        callId: 'c1',
        text: 'Hello',
        cite: { courseId: 'b', chapter: 'Ch5', file: 'f.pdf', page: 12 },
      }),
    );
    s = callReducer(
      s,
      ev({
        t: 'call.caption',
        agent: 'expert:ch5',
        callId: 'c1',
        text: 'Hi back',
        student: 's_ana',
      }),
    );
    expect(s.captions.map((c) => [c.id, c.speaker])).toEqual([
      ['c1:0', 'agent'],
      ['c1:1', 'you'],
    ]);
    expect(s.captions[0]?.cite?.page).toBe(12);
    s = callReducer(s, ev({ t: 'call.end', agent: 'expert:ch5', callId: 'c1' }));
    expect(s.status).toBe('ended');
    expect(s.open).toBe(true);
  });
  it('ignores other call ids and unrelated events', () => {
    const s = callReducer(initialCallState, { t: 'call.start', agent: 'dean', callId: 'a' });
    expect(callReducer(s, { t: 'call.caption', agent: 'dean', callId: 'b', text: 'x' })).toBe(s);
    expect(callReducer(s, { t: 'agent.state', agent: 'dean', state: 'idle' })).toBe(s);
  });
});

describe('ConfirmSheet', () => {
  it('reports the chosen option once and has a labelled dialog', async () => {
    const onChoose = vi.fn();
    render(<ConfirmSheet {...confirmSheetFixtures['yes-no']} onChoose={onChoose} />);
    await settle();
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-labelledby')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onChoose).toHaveBeenCalledWith('Yes', 0);
  });
  it('Esc closes and double activation is blocked while submitting', async () => {
    const onClose = vi.fn();
    const onChoose = vi.fn();
    const { rerender } = render(
      <ConfirmSheet {...confirmSheetFixtures['yes-no']} onClose={onClose} onChoose={onChoose} />,
    );
    await settle();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    rerender(<ConfirmSheet {...confirmSheetFixtures.submitting} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onChoose).not.toHaveBeenCalled();
  });
  it('labels private and shared details with words', async () => {
    render(<ConfirmSheet {...confirmSheetFixtures.details} />);
    await settle();
    expect(screen.getAllByText('Shares').length).toBeGreaterThan(0);
    expect(screen.getByText('Keeps private')).toBeTruthy();
  });
});

describe('QuizCard', () => {
  it('submits the chosen choice with number keys and Enter, never shows a score', async () => {
    const onSubmit = vi.fn();
    render(<QuizCard {...quizCardFixtures['answering-choices']} onSubmit={onSubmit} />);
    await settle();
    expect(
      (screen.getByRole('button', { name: /submit answer/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: '2' });
    fireEvent.click(screen.getByRole('button', { name: /submit answer/i }));
    expect(onSubmit).toHaveBeenCalledWith({ choice: 'b' });
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/score|points|streak|xp/);
  });
  it('free text submits {text} with Ctrl+Enter', async () => {
    const onSubmit = vi.fn();
    render(<QuizCard {...quizCardFixtures['answering-free-text']} onSubmit={onSubmit} />);
    await settle();
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'Oxygen takes the electrons' } });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith({ text: 'Oxygen takes the electrons' });
  });
  it('hides correctness unless the result carries it', async () => {
    const { rerender } = render(<QuizCard {...quizCardFixtures['done-recorded']} />);
    await settle();
    expect(screen.getByText('Answer recorded')).toBeTruthy();
    expect(screen.queryByText(/not quite/i)).toBeNull();
    rerender(<QuizCard {...quizCardFixtures['done-incorrect']} />);
    expect(screen.getByText('Not quite')).toBeTruthy();
  });
  it('error keeps typed text and offers retry', async () => {
    const onRetry = vi.fn();
    render(<QuizCard {...quizCardFixtures['error']} onRetry={onRetry} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('CallPanel', () => {
  it('renders captions in a polite log with citation chips and wires controls', async () => {
    const onMute = vi.fn();
    const onHand = vi.fn();
    const onLeave = vi.fn();
    const onCite = vi.fn();
    render(
      <CallPanel
        {...callPanelFixtures['hand-raised']}
        onMuteChange={onMute}
        onHandRaiseChange={onHand}
        onLeave={onLeave}
        onOpenCitation={onCite}
      />,
    );
    await settle();
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: /mute/i }));
    expect(onMute).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /hand up/i }));
    expect(onHand).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getAllByRole('button', { name: /Ch5 p1[23]/ })[0]!);
    expect(onCite).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(onLeave).toHaveBeenCalled();
  });
  it('shows retry on error and only Close when ended', async () => {
    const { rerender } = render(<CallPanel {...callPanelFixtures.error} />);
    await settle();
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(<CallPanel {...callPanelFixtures.ended} />);
    expect(screen.queryByRole('button', { name: /leave/i })).toBeNull();
  });
  it('traps focus: Tab from the last control wraps to the first', async () => {
    render(<CallPanel {...callPanelFixtures['live-empty']} />);
    await settle();
    const leave = screen.getByRole('button', { name: /leave/i });
    leave.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).not.toBe(leave);
  });
});
