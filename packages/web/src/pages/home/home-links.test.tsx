// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './index';
import { SquadProvider } from '../../shell/context';
import { resolveHomeLinks } from './home-links';
import { HUB_PROBE_START_MS } from './bootstrap';
import { tripPlanning } from '../trip/fixtures';

const HUB = 'http://hub.test';
let hubUpAt = 0; // ms of fake time at which /health starts answering
let trip: unknown = null;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  hubUpAt = 0;
  trip = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace(HUB, '');
      if (Date.now() < hubUpAt) return Promise.reject(new TypeError('Failed to fetch'));
      if (path === '/health') return Promise.resolve(new Response('{"ok":true}'));
      if (path === '/v1/trips/current')
        return Promise.resolve(new Response(JSON.stringify({ trip })));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <MemoryRouter>
      <SquadProvider
        hubUrl={HUB}
        mode="live"
        session={{ token: 't', userId: 'u', name: 'Ana', live: true }}
      >
        <HomePage />
      </SquadProvider>
    </MemoryRouter>,
  );
}
const hrefs = () =>
  [...document.querySelectorAll('.sq-home__link')].map((a) => a.getAttribute('href'));

describe('resolveHomeLinks (no hard-coded demo ids)', () => {
  it('no trip -> Plan a trip with your group (chat wizard)', () => {
    const l = resolveHomeLinks({ kind: 'none' });
    expect(l.find((x) => x.icon === 'plane')).toMatchObject({
      title: 'Plan a trip with your group',
      to: '/squad/chat?wizard=trip',
    });
  });
  it('a current trip -> its own title and id', () => {
    const l = resolveHomeLinks({
      kind: 'trip',
      tripId: 'trip_9',
      title: 'Tahoe',
      status: 'voting',
    });
    expect(l.find((x) => x.icon === 'plane')).toMatchObject({
      title: 'Tahoe',
      to: '/squad/trips/trip_9',
    });
  });
  it('never contains the old demo id', () => {
    for (const t of [{ kind: 'unknown' }, { kind: 'none' }] as const)
      expect(JSON.stringify(resolveHomeLinks(t))).not.toContain('spring-break');
  });
});

describe('Home bootstrap', () => {
  it('a hub that is up shows no connecting or offline state', async () => {
    mount();
    await waitFor(() => expect(screen.queryByText('Connecting to Squad...')).toBeNull());
    expect(screen.queryByText('You are offline')).toBeNull();
  });

  it('a late hub (up after ~3 s, caught by the third attempt) is waited for: connecting, then the checklist, never offline', async () => {
    hubUpAt = Date.now() + 3000;
    mount();
    expect(screen.getByText('Connecting to Squad...')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HUB_PROBE_START_MS[2]! + 300);
    });
    await waitFor(() => expect(screen.queryByText('Connecting to Squad...')).toBeNull());
    expect(screen.queryByText('You are offline')).toBeNull();
    expect(screen.getByText('Connect iMessage via Sendblue')).toBeTruthy();
  });

  it('a hub that never answers ends in a true offline state with Retry, then recovers', async () => {
    hubUpAt = Date.now() + 60_000;
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8500);
    });
    expect(await screen.findByText('You are offline')).toBeTruthy();
    hubUpAt = 0;
    await act(async () => {
      screen.getByRole('button', { name: /retry/i }).click();
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(screen.getByText('Connect iMessage via Sendblue')).toBeTruthy());
  });
});

describe('Home cards resolve from real state', () => {
  it('fresh account: Plan a trip, every card has a real route', async () => {
    mount();
    await screen.findByText('Plan a trip with your group');
    expect(hrefs()).toEqual([
      '/squad/chat?view=ledger',
      '/squad/chat?wizard=trip',
      '/squad/mastery',
      '/squad/courses',
    ]);
    expect(screen.queryByText('Spring break trip')).toBeNull();
  });
  it('seeded squad with a trip: card shows the trip and links its id', async () => {
    trip = { ...tripPlanning, tripId: 'trip_real', title: 'Lisbon weekend', status: 'voting' };
    mount();
    await screen.findByText('Lisbon weekend');
    expect(hrefs()).toContain('/squad/trips/trip_real');
  });
});
