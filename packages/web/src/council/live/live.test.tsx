// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { councilLiveReducer, initialCouncilLive, mergeCaption } from './reducer';
import { CouncilCaptions } from './CouncilCaptions';

const sp = { t: 'speaker', agent: 'council:ask-chair', name: 'Chair', turn: 1 } as const;
const run = (...evs: Parameters<typeof councilLiveReducer>[1][]) =>
  evs.reduce(councilLiveReducer, initialCouncilLive);

describe('council live reducer', () => {
  it('streams captions per turn, then completes with audio stats', () => {
    const s = run(
      sp,
      { t: 'caption', agent: sp.agent, name: 'Chair', turn: 1, text: 'Let us' },
      { t: 'caption', agent: sp.agent, name: 'Chair', turn: 1, text: 'Let us begin.' },
    );
    expect(s.speaker?.name).toBe('Chair');
    expect(s.turns[0]).toMatchObject({ text: 'Let us begin.', state: 'streaming' });
    expect(s.transcript).toBe('streaming');
    const done = councilLiveReducer(s, {
      t: 'turn_end',
      agent: sp.agent,
      turn: 1,
      chars: 13,
      audioChunks: 4,
      audioMs: 900,
    });
    expect(done.speaker).toBeNull();
    expect(done.turns[0]).toMatchObject({ state: 'complete', audioChunks: 4, audioMs: 900 });
  });
  it('an interruption cuts the turn and frees the floor, later captions keep it cut', () => {
    let s = run(sp, { t: 'caption', agent: sp.agent, name: 'Chair', turn: 1, text: 'Well' });
    s = councilLiveReducer(s, { t: 'interrupted', agent: sp.agent, turn: 1 });
    expect(s.speaker).toBeNull();
    expect(s.turns[0]!.state).toBe('cut');
    s = councilLiveReducer(s, {
      t: 'caption',
      agent: sp.agent,
      name: 'Chair',
      turn: 1,
      text: 'Well, then',
    });
    expect(s.turns[0]!.state).toBe('cut');
  });
  it('audio events carry no state and the transcript state is set by the hub', () => {
    const s = run(
      { t: 'audio', agent: 'a', turn: 1, seq: 0, pcm: 'AAAA' },
      { t: 'transcript', state: 'complete' },
    );
    expect(s.turns).toEqual([]);
    expect(s.transcript).toBe('complete');
  });
  it('mergeCaption accepts running text and deltas', () => {
    expect(mergeCaption('', 'Hi')).toBe('Hi');
    expect(mergeCaption('Hi', 'Hi there')).toBe('Hi there');
    expect(mergeCaption('Hi', ' there')).toBe('Hi there');
  });
});

describe('CouncilCaptions', () => {
  it('shows the speaker chip, the mode badge and the streaming words', () => {
    const live = run(sp, {
      t: 'caption',
      agent: sp.agent,
      name: 'Chair',
      turn: 1,
      text: 'Welcome all.',
    });
    render(<CouncilCaptions live={live} mode="live" />);
    expect(screen.getByTestId('caption-speaker').textContent).toBe('Chair');
    expect(screen.getByTestId('caption-text').textContent).toBe('Welcome all.');
    expect(screen.getByTestId('council-captions').getAttribute('data-state')).toBe('streaming');
    expect(screen.getByText('Live')).toBeTruthy();
  });
  it('Fixture mode is labelled and the fallback line is used without a live channel', () => {
    render(
      <CouncilCaptions
        live={initialCouncilLive}
        mode="demo"
        fallback={{ name: 'Skeptic', text: 'Not so fast.' }}
      />,
    );
    expect(screen.getByTestId('caption-speaker').textContent).toBe('Skeptic');
    expect(screen.getByTestId('caption-text').textContent).toBe('Not so fast.');
    expect(screen.getByText(/Fixture/)).toBeTruthy();
  });
});

afterEach(cleanup);
