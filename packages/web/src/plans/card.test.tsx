// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from '@squad/core';
import { PlanCard, planCardText } from './PlanCard';
import { TripChatCard, tripPrivacyLine } from './TripChatCard';
import { PlanActionsContext } from './context';
import { collapsePlanCards, revisionsOf } from './dedupe';
import { tripCardStatus, tripTruth } from '../lib/truth-labels';
import { planModeLine } from './format';
import {
  tripPlanning,
  tripVoting,
  tripVotingCounts,
  tripConfirmed,
  tripWaiting,
} from '../pages/trip/fixtures';

afterEach(cleanup);

const msg = (
  id: string,
  seq: number,
  text: string,
  card: ChatMessage['card'],
): { message: ChatMessage } => ({
  message: {
    id,
    seq,
    chatId: 'group:sq',
    ts: 1_000 * seq,
    sender: { kind: 'persona', id: 'cubbie', name: 'Squad' },
    text,
    private: false,
    attachments: [],
    citations: [],
    demo: false,
    ...(card ? { card } : {}),
  } as unknown as ChatMessage,
});

describe('collapsePlanCards', () => {
  it('keeps one card per plan at the first position with the latest state and a revision list', () => {
    const a = msg('m_1', 1, 'Trip: Cabo\nStarted the plan.\nOpen the plan in Squad: x', {
      type: 'trip',
      tripId: 'trip_ab12cd34',
      rev: 1,
      status: 'planning',
    });
    const chat = msg('m_2', 2, 'hello', undefined);
    const b = msg('m_3', 3, 'Trip: Cabo\nVoting is open.\nOpen the plan in Squad: x', {
      type: 'trip',
      tripId: 'trip_ab12cd34',
      rev: 2,
      status: 'voting',
    });
    const other = msg('m_4', 4, 'Trip: Austin', { type: 'trip', tripId: 'trip_zz99yy88' });
    const out = collapsePlanCards([a, chat, b, other]);
    expect(out.map((i) => i.message.id)).toEqual(['m_1', 'm_2', 'm_4']);
    const card = out[0]!.message.card!;
    expect(card).toMatchObject({ tripId: 'trip_ab12cd34', rev: 2, status: 'voting' });
    expect(revisionsOf(card).map((r) => r.text)).toEqual(['Started the plan.', 'Voting is open.']);
  });
  it('leaves threads without plan cards untouched', () => {
    const items = [msg('m_1', 1, 'hi', undefined)];
    expect(collapsePlanCards(items)).toBe(items);
  });
});

describe('truth and status words', () => {
  it('maps trip state to card status', () => {
    expect(tripCardStatus(tripPlanning)).toBe('Options ready');
    expect(tripCardStatus(tripVoting)).toBe('Voting');
    expect(tripCardStatus(tripConfirmed)).toBe('Agreed');
    expect(tripCardStatus(tripWaiting)).toBe('Needs attention');
    expect(
      tripCardStatus({
        status: 'planning',
        constraints: { ...tripPlanning.constraints, state: 'running' },
      }),
    ).toBe('Checking availability');
  });
  it('never says Live without a live planner, online agents and real calendars', () => {
    const on = ['online', 'online'] as const;
    expect(tripTruth({ planner: 'live', agents: [...on], calendars: ['real', 'real'] }).label).toBe(
      'Live',
    );
    expect(tripTruth({ planner: 'live', agents: [...on] }).label).not.toBe('Live');
    expect(
      tripTruth({ planner: 'demo', agents: [...on], calendars: ['fixture', 'fixture'] }).label,
    ).toBe('Practice mode');
    expect(
      tripTruth({ planner: 'live', agents: [...on], calendars: ['real', 'fixture'] }).label,
    ).toBe('Partly live');
    expect(tripTruth({ planner: null, agents: ['no_agent'], calendars: ['none'] }).label).toBe(
      'Not set up',
    );
  });
  it('privacy line never reveals choices; counts only when the hub did', () => {
    expect(tripPrivacyLine(tripVoting)).toMatch(/secret until the reveal/);
    expect(tripPrivacyLine(tripVotingCounts)).toMatch(/of \d+ voted; choices stay hidden/);
    expect(tripPrivacyLine(tripPlanning)).toBe('Private constraints stay private.');
  });
});

describe('PlanCard', () => {
  it('renders status, provenance, privacy, revisions and Ask Squad', async () => {
    const ask = vi.fn();
    render(
      <PlanCard
        kind="study"
        title="Midterm"
        status="Draft"
        author="Ana"
        provenance={{ label: 'Practice mode', reason: 'demo', tone: 'practice' }}
        privacy="Private constraints stay private."
        revisions={[
          { messageId: 'a', ts: 1, text: 'one' },
          { messageId: 'b', ts: 2, text: 'two' },
        ]}
        actions={{ ask }}
      />,
    );
    expect(screen.getByTestId('plan-card-status').textContent).toBe('Draft');
    expect(screen.getByTestId('plan-card-provenance').textContent).toMatch(/Practice mode/);
    expect(screen.getByTestId('plan-card-revisions')).toBeTruthy();
    await userEvent.click(screen.getByTestId('plan-ask-cubbie'));
    expect(ask).toHaveBeenCalled();
    expect(planCardText({ title: 'Cabo', status: 'Voting', link: 'https://x' })).toContain(
      'Private constraints stay private',
    );
  });
});

describe('TripChatCard', () => {
  it('loads the trip, shows Vote when allowed and attaches the plan via Ask Squad', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(tripVoting), { status: 200 })),
    );
    const askCubbie = vi.fn();
    const openPlan = vi.fn();
    render(
      <PlanActionsContext.Provider value={{ askCubbie, openPlan }}>
        <TripChatCard
          hub={{ hubUrl: 'http://h', token: 't' }}
          card={{
            type: 'trip',
            tripId: tripVoting.tripId.startsWith('trip_') ? tripVoting.tripId : 'trip_cabo',
            rev: 1,
          }}
        />
      </PlanActionsContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('plan-card-status').textContent).toBe('Voting'));
    if (tripVoting.can.vote) expect(screen.getByTestId('plan-vote')).toBeTruthy();
    await userEvent.click(screen.getByTestId('plan-ask-cubbie'));
    expect(askCubbie).toHaveBeenCalledWith({
      id: expect.stringMatching(/^trip_/),
      label: tripVoting.title,
    });
    vi.unstubAllGlobals();
  });
});

describe('plan actions stay inside the group chat', () => {
  const noLeave = (root: HTMLElement) => {
    for (const a of root.querySelectorAll('a[href]')) {
      const h = a.getAttribute('href') ?? '';
      expect(h).not.toContain('/squad/trips');
      expect(h).not.toContain('/squad/village');
    }
  };
  it('trip card Edit/Vote are buttons that open the plan inline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(tripVoting), { status: 200 })),
    );
    const openPlan = vi.fn();
    const { container } = render(
      <PlanActionsContext.Provider value={{ askCubbie: vi.fn(), openPlan }}>
        <TripChatCard
          hub={{ hubUrl: 'http://h', token: 't' }}
          card={{ type: 'trip', tripId: 'trip_ab12cd34', rev: 1 }}
        />
      </PlanActionsContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('plan-card-status').textContent).toBe('Voting'));
    noLeave(container);
    expect(container.querySelectorAll('a[href]').length).toBe(0);
    await userEvent.click(screen.getByTestId('plan-edit'));
    expect(openPlan).toHaveBeenCalledWith({ kind: 'trip', id: 'trip_ab12cd34' });
    if (tripVoting.can.vote) {
      await userEvent.click(screen.getByTestId('plan-vote'));
      expect(openPlan).toHaveBeenCalledTimes(2);
    }
  });
});

describe('plan mode status text', () => {
  it('shows the mode once, then the planner, in every mode', () => {
    const lines = [
      planModeLine({ mode: 'live', kind: 'agent', source: 'planner' } as never),
      planModeLine({ mode: 'demo', kind: 'fallback', source: 'scripted' } as never),
      planModeLine({
        mode: 'degraded',
        kind: 'agent',
        source: 'planner',
        reason: 'the model fell back',
      } as never),
    ];
    expect(lines[0]).toBe('Live · Planner agent');
    for (const l of lines) expect(l).not.toMatch(/\b(\w+)\s+\1\b/i);
  });
});
