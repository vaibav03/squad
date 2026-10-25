// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AGENT_ALIASES } from '@squad/core';
import { createRoomSession, publishRoomSession, ROOM_SLOTS } from '@squad/village/rooms';
import type { RoomSnapshot } from '@squad/village/rooms';
import { RoomLayer } from '../overlays/room-info';
import { ChatDock } from '../pages/chat/ChatDock';
import { GROUP_ID, ME, createFakeChatApi } from '../pages/chat/fixtures';
import { HallLayer } from './HallLayer';
import {
  AVAILABILITY_LABEL,
  HALL_AGENTS,
  availabilityOf,
  hallAgent,
  resolveRoomParam,
} from './roster';
import { focusHallAgent, getHallFocus, resetHallFocus } from './store';

const memStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
};
beforeEach(() => {
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('sessionStorage', memStorage());
  resetHallFocus();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  (globalThis as Record<string, unknown>)['__squadRoomSession'] = undefined;
});

const snap = (extra: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  entered: 'council-hall',
  transcripts: {},
  outcomes: {},
  ...extra,
});

describe('hall roster', () => {
  it('seats every agent you can @mention, Cubbie included', () => {
    const seated = HALL_AGENTS.map((a) => a.alias).sort();
    expect(seated).toEqual(AGENT_ALIASES.map((a) => a.aliases[0]!).sort());
    for (const need of [
      'cubbie',
      'tutor',
      'skeptic',
      'planner',
      'examiner',
      'chair',
      'feynman',
      'quiz',
      'debate',
      'oracle',
      'rubric',
      'devilta',
    ])
      expect(seated).toContain(need);
  });

  it('former room ids and every alias resolve to a seat (deep links never break)', () => {
    const expected: Record<string, string | null> = {
      'council-hall': null,
      'feynman-porch': 'feynman',
      'debate-stage': 'debate',
      'round-table': 'planner',
      'panic-booth': 'stepdiff',
      'exam-oracle': 'oracle',
      'oral-exam-hut': 'examiner',
      'rubric-courthouse': 'rubric',
      'devils-ta': 'devilta',
      feynman: 'feynman',
      debate: 'debate',
      devilta: 'devilta',
      tutor: 'tutor',
      cubbie: 'cubbie',
    };
    for (const [id, alias] of Object.entries(expected)) {
      const r = resolveRoomParam(id);
      expect(r, id).not.toBeNull();
      expect(r!.agent?.alias ?? null, id).toBe(alias);
    }
    for (const slot of ROOM_SLOTS) expect(resolveRoomParam(slot), slot).not.toBeNull();
    expect(resolveRoomParam('chapter-2')).toMatchObject({
      agent: { alias: 'quiz' },
      seed: '@quiz quiz me on ch2',
    });
    expect(resolveRoomParam('nowhere')).toBeNull();
  });

  it('availability replaces the locked rooms: honest labels, locked until first use', () => {
    const feynman = hallAgent('feynman')!;
    expect(availabilityOf(feynman, [])).toBe('locked');
    expect(availabilityOf(feynman, ['feynman-porch'])).toBe('available');
    expect(availabilityOf(hallAgent('cubbie')!, [])).toBe('available');
    expect(AVAILABILITY_LABEL.locked).toBe('Locked until first use');
    expect(AVAILABILITY_LABEL.available).toBe('Available');
  });
});

describe('HallLayer', () => {
  it('seats everyone; names show on hover only (the tag is decorative, the button is named)', () => {
    render(<HallLayer snap={snap()} />);
    const seats = screen.getAllByRole('button', { name: /Press to message/ });
    expect(seats).toHaveLength(HALL_AGENTS.length);
    for (const s of seats) {
      const tag = s.querySelector('.hall-seat__tag')!;
      expect(tag.getAttribute('aria-hidden')).toBe('true');
    }
    expect(screen.getByRole('heading', { name: 'Agent Hall' })).toBeTruthy();
  });

  it('aims at the agent the viewer came for, with an honest availability chip', async () => {
    render(<HallLayer snap={snap({ focus: { alias: 'feynman', n: 1 }, used: [] })} />);
    const card = await screen.findByTestId('hall-card');
    await waitFor(() => expect(within(card).getByText('Feynman')).toBeTruthy());
    expect(within(card).getByText('Locked until first use')).toBeTruthy();
    expect(getHallFocus().alias).toBe('feynman');
    expect(getHallFocus().seed).toBe('@feynman ');
    cleanup();
    resetHallFocus();
    render(
      <HallLayer snap={snap({ focus: { alias: 'feynman', n: 1 }, used: ['feynman-porch'] })} />,
    );
    expect(await screen.findByText('Available')).toBeTruthy();
  });

  it('pressing a seat aims the chat at that agent', async () => {
    render(<HallLayer snap={snap()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Debate,/ }));
    expect(getHallFocus().alias).toBe('debate');
    expect(getHallFocus().seed).toBe('@debate ');
  });

  it('a debate-stage ask carries a drafted prompt', () => {
    render(<HallLayer snap={snap({ focus: { alias: 'debate', seed: '@debate ', n: 1 } })} />);
    expect(getHallFocus().seed).toBe('@debate ');
  });
});

describe('the hall appears only inside the hall', () => {
  const mount = (s: ReturnType<typeof createRoomSession>) => render(<RoomLayer session={s} />);

  it('open village: nothing; other rooms: no hall; hall: hall and (once there is talk) the strip', async () => {
    const s = createRoomSession();
    const { container } = mount(s);
    expect(container.querySelector('[data-testid="agent-hall"]')).toBeNull();
    expect(screen.queryByRole('log')).toBeNull();
    for (const slot of ['round-table', 'feynman-porch', 'debate-stage', 'chapter-1']) {
      await act(async () => s.enter(slot));
      expect(container.querySelector('[data-testid="agent-hall"]'), slot).toBeNull();
      expect(screen.queryByRole('log'), slot).toBeNull();
    }
    await act(async () => s.enter('council-hall'));
    expect(container.querySelector('[data-testid="agent-hall"]')).not.toBeNull();
    // no talk yet: no empty strip, no Run it button
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run it' })).toBeNull();
    await act(async () =>
      s.record(
        'council-hall',
        { t: 'council.opinion', councilId: 'c', member: 'chill', text: 'Keep it light.' },
        1,
      ),
    );
    expect(screen.getByRole('log', { name: 'What they are saying' })).toBeTruthy();
    await act(async () => s.leave());
    expect(container.querySelector('[data-testid="agent-hall"]')).toBeNull();
    expect(screen.queryByRole('log')).toBeNull();
  });

  it('every former room is the hall now: entering one with a target aims the hall at its agent', async () => {
    const s = createRoomSession();
    mount(s);
    await act(async () => s.enter('council-hall', { focus: 'oracle' }));
    await waitFor(() => expect(getHallFocus().alias).toBe('oracle'));
    await act(async () => s.setFocus?.({ focus: 'rubric', seed: '@rubric ' }));
    await waitFor(() => expect(getHallFocus().alias).toBe('rubric'));
  });
});

describe('one chat for all agents', () => {
  const setup = async () => {
    const api = createFakeChatApi({ bot: false });
    const s = createRoomSession();
    publishRoomSession(s);
    render(<ChatDock enabled api={api} me={ME} />);
    await act(async () => s.enter('council-hall'));
    return { api, s };
  };

  it('the hall docks the squad group chat: same thread, no pill, composer with agent-aware suggestions', async () => {
    const { api } = await setup();
    const panel = await screen.findByRole('dialog', { name: 'Agent Hall chat' });
    await screen.findAllByTestId('chat-message');
    expect(panel.querySelector('[data-chat-kind="group"]')).not.toBeNull();
    // the one conversation: the hub thread of the selected group, nothing parallel
    expect(api.sent).toHaveLength(0);
    expect(screen.queryByTestId('chat-dock-open')).toBeNull();
    const chips = await screen.findAllByTestId('chat-suggestion');
    expect(chips.map((c) => c.textContent)).toEqual(
      expect.arrayContaining([
        '@cubbie quiz me on ch2',
        '@feynman explain z-scores',
        '@debate should exams be open book?',
      ]),
    );
    void GROUP_ID;
  });

  it('typing @ suggests Cubbie first, then every agent alias', async () => {
    await setup();
    const box = (await screen.findByTestId('chat-composer-input')) as HTMLTextAreaElement;
    await userEvent.type(box, '@');
    const list = await screen.findByRole('listbox', { name: 'Tag an agent' });
    const aliases = within(list)
      .getAllByRole('option')
      .map((o) => o.getAttribute('data-alias'));
    expect(aliases[0]).toBe('cubbie');
    await userEvent.clear(box);
    for (const [typed, want] of [
      ['@fey', 'feynman'],
      ['@deb', 'debate'],
      ['@dev', 'devilta'],
      ['@rub', 'rubric'],
      ['@ora', 'oracle'],
      ['@ex', 'examiner'],
      ['@tu', 'tutor'],
      ['@ske', 'skeptic'],
      ['@pla', 'planner'],
      ['@cha', 'chair'],
      ['@qu', 'quiz'],
    ] as const) {
      await userEvent.clear(box);
      await userEvent.type(box, typed);
      const l = screen.queryByRole('listbox', { name: 'Tag an agent' });
      expect(l, typed).not.toBeNull();
      expect(
        within(l!)
          .getAllByRole('option')
          .map((o) => o.getAttribute('data-alias')),
        typed,
      ).toContain(want);
    }
  });

  it('a seat press fills the composer; one thread shows who addressed whom, with portraits', async () => {
    const { api } = await setup();
    const box = (await screen.findByTestId('chat-composer-input')) as HTMLTextAreaElement;
    act(() => focusHallAgent('feynman', '@feynman '));
    await waitFor(() => expect(box.value).toBe('@feynman '));
    await userEvent.type(box, 'explain z-scores{Enter}');
    await waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]!.text).toBe('@feynman explain z-scores');
    await waitFor(() =>
      expect(screen.getAllByTestId('chat-addressed').at(-1)!.textContent).toContain('Feynman'),
    );
    // a second agent in the same thread
    await userEvent.type(box, '@debate should exams be open book?{Enter}');
    await waitFor(() => expect(api.sent).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getAllByTestId('chat-addressed').at(-1)!.textContent).toContain('Debate'),
    );
    expect(screen.getAllByTestId('chat-addressed').map((n) => n.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Feynman'),
        expect.stringContaining('Debate'),
      ]),
    );
  });

  it('outside the hall the dock is the usual launcher and has no suggestions', async () => {
    const api = createFakeChatApi({ bot: false });
    render(<ChatDock enabled api={api} me={ME} />);
    expect(screen.getByTestId('chat-dock-open')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('chat-suggestions')).toBeNull();
  });
});
