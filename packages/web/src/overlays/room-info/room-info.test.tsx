// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRoomSession, ROOM_INFO } from '@squad/village/rooms';
import type { RoomInfo, RoomSession, TranscriptEntry } from '@squad/village/rooms';
import { OutcomeCard, RoomInfoPanel, RoomLayer, RoomTranscript, speakerName } from './index';
import { FIXTURE_INFO, FIXTURE_OUTCOME } from './fixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});
const settle = async (ms = 60) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

const entry = (id: number, who: string, text: string, extra: Partial<TranscriptEntry> = {}) =>
  ({
    id,
    slot: 'round-table',
    who,
    kind: 'opinion',
    text,
    at: id,
    holdMs: 1200,
    ...extra,
  }) as TranscriptEntry;

const infoFor = (slot: string): RoomInfo | undefined =>
  slot === 'round-table'
    ? FIXTURE_INFO
    : slot === 'feynman-porch'
      ? {
          ...FIXTURE_INFO,
          slot,
          title: 'Feynman Porch',
          how: { phrase: null, steps: ['Walk in.'] },
        }
      : undefined;

describe('RoomInfoPanel', () => {
  it('renders every section in plain language', async () => {
    render(<RoomInfoPanel info={FIXTURE_INFO} open onClose={() => {}} />);
    await settle();
    const dlg = screen.getByRole('dialog', { name: /Course-Planning Round Table/ });
    for (const h of [
      'What this room is for',
      'Who is in here and what they do for you',
      'How to use it',
      'What you get at the end',
      'Privacy',
    ])
      expect(within(dlg).getByRole('heading', { name: new RegExp(h) })).toBeTruthy();
    expect(within(dlg).getByText(FIXTURE_INFO.tagline)).toBeTruthy();
    expect(within(dlg).getAllByRole('listitem').length).toBeGreaterThanOrEqual(6);
    expect(within(dlg).getByTestId('room-phrase').textContent).toBe('plan my fall term');
    expect(within(dlg).queryByRole('button', { name: 'Run it' })).toBeNull();
  });

  it('Esc closes and focus returns to the opener', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const onClose = vi.fn();
    const { rerender } = render(
      <RoomInfoPanel info={FIXTURE_INFO} open onClose={onClose} returnFocusTo={opener} />,
    );
    await settle();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <RoomInfoPanel info={FIXTURE_INFO} open={false} onClose={onClose} returnFocusTo={opener} />,
    );
    await settle(400);
    expect(document.activeElement).toBe(opener);
    expect(screen.queryByRole('dialog')).toBeNull();
    opener.remove();
  });

  it('Copy writes the phrase; Run it calls onRun with it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onRun = vi.fn();
    render(<RoomInfoPanel info={FIXTURE_INFO} open onClose={() => {}} onRun={onRun} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await settle(10);
    expect(writeText).toHaveBeenCalledWith('plan my fall term');
    expect(screen.getByRole('button', { name: /Copied/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Run it/ }));
    expect(onRun).toHaveBeenCalledWith('plan my fall term');
  });

  it('Run it is disabled while the send is pending, then shows Sent', async () => {
    let done: (v: boolean) => void = () => {};
    const onRun = vi.fn(() => new Promise<boolean>((r) => (done = r)));
    render(<RoomInfoPanel info={FIXTURE_INFO} open onClose={() => {}} onRun={onRun} />);
    await settle();
    const btn = screen.getByRole('button', { name: /Run it/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: /Sending/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    done(true);
    await settle(10);
    expect(screen.getByRole('button', { name: /Sent/ })).toBeTruthy();
  });

  it('survives a clipboard that throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
      configurable: true,
    });
    render(<RoomInfoPanel info={FIXTURE_INFO} open onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await settle(10);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a room without a phrase shows steps only', async () => {
    const info = { ...FIXTURE_INFO, how: { phrase: null, steps: ['Walk in.'] } };
    render(<RoomInfoPanel info={info} open onClose={() => {}} onRun={() => {}} />);
    await settle();
    expect(screen.queryByTestId('room-phrase')).toBeNull();
    expect(screen.queryByRole('button', { name: /Run it/ })).toBeNull();
    expect(screen.getByText('Walk in.')).toBeTruthy();
  });
});

describe('RoomTranscript', () => {
  it('is a polite log, renders in order with names, dots and the disagrees tag', () => {
    render(
      <RoomTranscript
        entries={[
          entry(1, 'chill', 'Keep it light.'),
          entry(2, 'grind', 'Take eighteen.', { dissent: true }),
          entry(3, 'expert:oral', 'Explain it again.', { kind: 'caption' }),
        ]}
      />,
    );
    const log = screen.getByRole('log', { name: 'What they are saying' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    const lines = Array.from(log.querySelectorAll('.rr-line')).map((l) => l.textContent);
    expect(lines[0]).toContain('Chill');
    expect(lines[0]).toContain('Keep it light.');
    expect(lines[1]).toContain('disagrees');
    expect(lines[2]).toContain('Oral Examiner');
    expect(log.querySelectorAll('.rr-dot').length).toBe(3);
  });
  it('shows the empty state with the phrase', () => {
    render(<RoomTranscript entries={[]} info={FIXTURE_INFO} />);
    const log = screen.getByRole('log');
    expect(log.textContent).toContain('Nobody is talking yet. Say');
    expect(log.textContent).toContain('plan my fall term');
    expect(log.textContent).toContain('in chat or press Run it.');
  });
  it('names fall back sensibly', () => {
    expect(speakerName('advisor')).toBe('Advisor');
    expect(speakerName('expert:ch5')).toBe('Ch5 Expert');
    expect(speakerName('some_thing')).toBe('Some thing');
  });
});

describe('OutcomeCard', () => {
  it('renders items, facts, dissent and why', () => {
    render(<OutcomeCard outcome={FIXTURE_OUTCOME} info={FIXTURE_INFO} />);
    expect(screen.getByRole('heading', { name: 'Fall term plan' })).toBeTruthy();
    expect(screen.getByText('CS 201 Data Structures')).toBeTruthy();
    expect(screen.getByText('Core, needed for every later CS course')).toBeTruthy();
    const facts = screen.getByRole('list', { name: 'Key facts' });
    expect(facts.textContent).toContain('Credits');
    expect(facts.textContent).toContain('15');
    expect(facts.textContent).toContain('steady');
    expect(screen.getByRole('note').textContent).toContain('Grind wanted 18 credits');
    expect(screen.getByText('Advisor:')).toBeTruthy();
    expect(screen.getByText('Chill:')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bgrades?\b|\bscores?\b|\bxp\b/i);
  });
});

describe('RoomLayer', () => {
  const mount = (s: RoomSession, onRun?: (p: string) => void) =>
    render(<RoomLayer session={s} onRun={onRun} infoFor={infoFor} />);

  it('shows ? only while a room is entered', async () => {
    const s = createRoomSession();
    mount(s);
    expect(screen.queryByRole('button', { name: 'What does this room do?' })).toBeNull();
    await act(async () => s.enter('round-table'));
    expect(screen.getByRole('button', { name: 'What does this room do?' })).toBeTruthy();
    await act(async () => s.leave());
    expect(screen.queryByRole('button', { name: 'What does this room do?' })).toBeNull();
  });

  it('auto-opens once per room per browser session, ? reopens', async () => {
    const s = createRoomSession();
    mount(s);
    await act(async () => s.enter('round-table'));
    await settle();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await settle(400);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => s.leave());
    await act(async () => s.enter('round-table'));
    await settle(400);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'What does this room do?' }));
    await settle();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // a different room opens on its own first time
    await act(async () => s.enter('feynman-porch'));
    await settle();
    expect(screen.getByRole('dialog', { name: /Feynman Porch/ })).toBeTruthy();
  });

  it('Esc inside the panel does not reach the window; Run it uses onRun and closes', async () => {
    const s = createRoomSession();
    const onRun = vi.fn();
    const winKey = vi.fn();
    window.addEventListener('keydown', winKey);
    mount(s, onRun);
    await act(async () => s.enter('round-table'));
    await settle();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(winKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', winKey);
    fireEvent.click(screen.getByRole('button', { name: 'What does this room do?' }));
    await settle();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Run it/ }));
    expect(onRun).toHaveBeenCalledWith('plan my fall term');
  });

  it('streams the transcript and shows the outcome card with Hide / Show plan', async () => {
    const s = createRoomSession();
    mount(s);
    await act(async () => s.enter('round-table'));
    await act(async () => {
      s.record(
        'round-table',
        { t: 'council.opinion', councilId: 'c', member: 'chill', text: 'Keep it light.' },
        1,
      );
      s.record(
        'round-table',
        {
          t: 'council.verdict',
          councilId: 'c',
          member: 'chair',
          text: 'Fifteen credits it is.',
          outcome: FIXTURE_OUTCOME,
        },
        2,
      );
    });
    expect(screen.getByRole('log').textContent).toContain('Keep it light.');
    expect(screen.getByRole('heading', { name: 'Fall term plan' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Hide/ }));
    expect(screen.queryByRole('heading', { name: 'Fall term plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show plan/ }));
    expect(screen.getByRole('heading', { name: 'Fall term plan' })).toBeTruthy();
  });

  it('picks up a session published late', async () => {
    const s = createRoomSession();
    (globalThis as Record<string, unknown>)['__squadRoomSession'] = undefined;
    render(<RoomLayer infoFor={infoFor} />);
    expect(screen.queryByTestId('council-dock')).toBeNull();
    await act(async () => {
      (globalThis as Record<string, unknown>)['__squadRoomSession'] = s;
      globalThis.dispatchEvent(new Event('squad:room-session'));
    });
    await act(async () => s.enter('round-table'));
    expect(screen.getByTestId('council-dock')).toBeTruthy();
    (globalThis as Record<string, unknown>)['__squadRoomSession'] = undefined;
  });

  it('privacy sentinel: only public text renders, never raw JSON or withheld values', async () => {
    const s = createRoomSession();
    const { container } = mount(s);
    await act(async () => s.enter('round-table'));
    await act(async () => {
      s.record(
        'round-table',
        {
          t: 'council.opinion',
          councilId: 'c',
          member: 'grind',
          text: 'Take more credits.',
          dissent: true,
        },
        1,
      );
      s.record(
        'round-table',
        { t: 'council.rank', councilId: 'c', member: 'advisor', order: ['CS 201', 'MATH 210'] },
        2,
      );
      s.record(
        'round-table',
        {
          t: 'council.verdict',
          councilId: 'c',
          member: 'chair',
          text: 'Done.',
          outcome: FIXTURE_OUTCOME,
        },
        3,
      );
    });
    await settle();
    const text = container.ownerDocument.body.textContent ?? '';
    expect(text).not.toContain('$180');
    expect(text).not.toMatch(/therapy/i);
    expect(text).not.toMatch(/\[object|undefined|"title":|\{"/);
  });
});

describe('real ROOM_INFO', () => {
  const all = Object.values(ROOM_INFO);
  it.skipIf(all.length === 0)('every room renders all sections without raw junk', async () => {
    for (const info of all) {
      const { unmount } = render(
        <RoomInfoPanel info={info} open onClose={() => {}} onRun={() => {}} />,
      );
      await settle(20);
      const dlg = screen.getByRole('dialog');
      expect(within(dlg).getAllByRole('heading').length).toBeGreaterThanOrEqual(6);
      expect(dlg.textContent).not.toMatch(/undefined|\[object|\$\d/);
      unmount();
    }
  });
});
