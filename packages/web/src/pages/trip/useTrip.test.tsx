// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { LiveConfigProvider } from '../../overlays/kit';
import { useTrip } from './useTrip';
import { tripPlanning } from './fixtures';
import { claimCutscene, parseConflict, parseCurrent, parseTripEvent, parseTripView } from './model';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const wrapper = ({ children }: { children: ReactNode }) => (
  <LiveConfigProvider value={{ mode: 'live', hubUrl: 'http://hub', token: 't', userId: 's_ana' }}>
    {children}
  </LiveConfigProvider>
);

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/stream-token')) return json(500, {});
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

describe('model parsing', () => {
  it('parses a TripViewV2, current envelope, conflict and events', () => {
    expect(parseTripView(tripPlanning)?.tripId).toBe('trip_cabo');
    expect(parseTripView({ tripId: 'x' })).toBeUndefined();
    expect(parseCurrent({ trip: null })).toEqual({ trip: null });
    expect(parseCurrent({ trip: tripPlanning })?.trip?.rev).toBe(3);
    expect(parseCurrent({ nope: 1 })).toBeUndefined();
    const c = {
      error: { code: 'conflict', message: 'm' },
      conflict: { rev: 4, change: null, option: null },
    };
    expect(parseConflict(c)?.conflict.rev).toBe(4);
    expect(parseConflict({ error: { code: 'other', message: 'm' } })).toBeUndefined();
    expect(parseTripEvent({ t: 'x.trip.updated', tripId: 'a' })).toEqual({ t: 'refresh' });
    expect(parseTripEvent({ t: 'trip.confirmed', taskId: 'k' })).toEqual({
      t: 'trip.confirmed',
      taskId: 'k',
    });
    expect(parseTripEvent({ t: 'zzz' })).toBeNull();
  });

  it('claims the cutscene once per trip', () => {
    expect(claimCutscene('trip_once')).toBe(true);
    expect(claimCutscene('trip_once')).toBe(false);
    expect(claimCutscene('trip_other')).toBe(true);
  });
});

describe('useTrip (live, stubbed fetch)', () => {
  it('null current trip is a ready empty state, not an error', async () => {
    const calls = stub(() => json(200, { trip: null }));
    const { result } = renderHook(() => useTrip(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.view).toBeNull();
    expect(calls[0]!.url).toBe('http://hub/v1/trips/current');
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('404 on a trip id is not-found, not the hub-down error', async () => {
    stub(() => json(404, { error: { code: 'not_found', message: 'x' } }));
    const { result } = renderHook(() => useTrip('trip_zzz'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.view).toBeNull();
    expect(result.current.notFound).toBe(true);
  });

  it('a network failure is the error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('failed');
      }),
    );
    const { result } = renderHook(() => useTrip(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toBeUndefined();
  });

  it('create posts the body and shows the new trip', async () => {
    const calls = stub((url, init) =>
      init?.method === 'POST' ? json(201, { trip: tripPlanning }) : json(200, { trip: null }),
    );
    const { result } = renderHook(() => useTrip(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.create({ destination: 'Cabo' }));
    expect(result.current.view?.tripId).toBe('trip_cabo');
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toBe('http://hub/v1/trips');
    expect(JSON.parse(post.init!.body as string)).toEqual({ destination: 'Cabo' });
  });

  const conflictBody = {
    error: { code: 'conflict', message: 'Dev changed this' },
    conflict: {
      rev: 9,
      change: { rev: 9, by: 's_dev', byName: 'Dev', at: 1, summary: 'Dev changed Cabo to 6 days' },
      option: null,
    },
  };

  it('edit 409 sets a conflict; Replace with mine resends replace:true at the conflict rev', async () => {
    let patches = 0;
    const calls = stub((url, init) => {
      if (init?.method === 'PATCH') {
        patches += 1;
        return patches === 1
          ? json(409, conflictBody)
          : json(200, { trip: { ...tripPlanning, rev: 10 } });
      }
      return json(200, tripPlanning);
    });
    const { result } = renderHook(() => useTrip('trip_cabo'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.editOption('cabo', { days: 4 }, 3));
    expect(result.current.conflict?.conflict.change?.byName).toBe('Dev');
    const first = calls.filter((c) => c.init?.method === 'PATCH')[0]!;
    expect(JSON.parse(first.init!.body as string)).toEqual({ days: 4, baseRev: 3 });
    expect(result.current.view?.rev).toBe(3);
    await act(() => result.current.replaceWithMine());
    const second = calls.filter((c) => c.init?.method === 'PATCH')[1]!;
    expect(JSON.parse(second.init!.body as string)).toEqual({ days: 4, baseRev: 9, replace: true });
    expect(result.current.conflict).toBeNull();
    expect(result.current.view?.rev).toBe(10);
  });

  it('Keep theirs discards my edit and refetches', async () => {
    let gets = 0;
    stub((url, init) => {
      if (init?.method === 'PATCH') return json(409, conflictBody);
      gets += 1;
      return json(200, { ...tripPlanning, rev: gets === 1 ? 3 : 9 });
    });
    const { result } = renderHook(() => useTrip('trip_cabo'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.editOption('cabo', { days: 4 }, 3));
    expect(result.current.conflict).not.toBeNull();
    act(() => result.current.keepTheirs());
    await waitFor(() => expect(result.current.view?.rev).toBe(9));
    expect(result.current.conflict).toBeNull();
  });

  it('vote 409 then replace resends with the new baseRev; remove puts baseRev in the query', async () => {
    let votes = 0;
    const calls = stub((url, init) => {
      if (url.endsWith('/vote')) {
        votes += 1;
        return votes === 1 ? json(409, conflictBody) : json(200, { trip: tripPlanning });
      }
      if (init?.method === 'DELETE') return json(200, { trip: tripPlanning });
      return json(200, tripPlanning);
    });
    const { result } = renderHook(() => useTrip('trip_cabo'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.submitVote(['cabo', 'austin'], 3));
    expect(result.current.conflict).not.toBeNull();
    await act(() => result.current.replaceWithMine());
    const v = calls.filter((c) => c.url.endsWith('/vote'));
    expect(JSON.parse(v[1]!.init!.body as string)).toEqual({
      ranking: ['cabo', 'austin'],
      baseRev: 9,
    });
    await act(() => result.current.removeOption('austin', 3));
    expect(calls.find((c) => c.init?.method === 'DELETE')!.url).toBe(
      'http://hub/v1/trips/trip_cabo/options/austin?baseRev=3',
    );
  });

  it('a non-conflict error surfaces the hub message and does not touch the view', async () => {
    stub((url, init) =>
      init?.method === 'POST'
        ? json(400, { error: { code: 'bad', message: 'Pick a longer name' } })
        : json(200, tripPlanning),
    );
    const { result } = renderHook(() => useTrip('trip_cabo'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.propose({ label: 'ab' }));
    expect(result.current.actionError).toBe('Pick a longer name');
    expect(result.current.conflict).toBeNull();
  });
});
