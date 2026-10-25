// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './index';
import { SquadProvider } from '../../shell/context';
import { resetRequestBudget } from '../../lib/request-budget';
import { calendarDone, coursesDone, personaDone, phoneDone } from './setup-state';

const HUB = 'http://hub.test';
const ctx = { hubUrl: HUB, token: 't' };

type Answer = unknown;
let answers: Record<string, Answer> = {};
const calls: string[] = [];

beforeEach(() => {
  answers = {};
  calls.length = 0;
  const store = new Map<string, string>([
    ['squad.setup.done', JSON.stringify(['phone', 'courses', 'calendar'])], // stale local flags must be ignored
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace(HUB, '');
      if (path === '/health') return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      calls.push(path);
      const a = answers[path];
      if (a === 'hang') return new Promise(() => {});
      if (a instanceof Error) return Promise.reject(a);
      if (a === undefined) return Promise.resolve(new Response('{}', { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(a), { status: 200 }));
    }),
  );
});
afterEach(() => {
  cleanup();
  resetRequestBudget(); // a read left hanging by one test must not hold a slot for the next
  vi.unstubAllGlobals();
});

const course = (o: object) => ({ id: 'c', role: 'owner', sample: false, status: 'ready', ...o });
const allEmpty = (): Record<string, Answer> => ({
  '/v1/imessage/link': { links: [] },
  '/v1/library/courses': { courses: [] },
  '/v1/connections': { connections: [] },
  '/v1/squad/calendar': { ics: false },
  '/v1/me': { user: { id: 'u' } },
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
const row = (title: string) => screen.getByText(title).closest('li') as HTMLElement;
const live = { provider: 'google', mode: 'live', status: 'live' };

describe('setup readers (server state only)', () => {
  it('phone: done only with a linked handle', async () => {
    answers['/v1/imessage/link'] = { links: [] };
    answers['/v1/me'] = { user: { id: 'u' }, phoneVerified: false };
    expect(await phoneDone(ctx)).toBe(false);
    answers['/v1/imessage/link'] = { links: [{ hint: '•••• 0077', linkedAt: 1 }] };
    expect(await phoneDone(ctx)).toBe(true);
    answers['/v1/imessage/link'] = { links: [] };
    answers['/v1/me'] = { user: { id: 'u' }, phoneVerified: true };
    expect(await phoneDone(ctx)).toBe(true);
  });
  it('courses: sample-only or still-ingesting is not done; an own ready course is', async () => {
    answers['/v1/library/courses'] = { courses: [course({ sample: true, role: 'viewer' })] };
    expect(await coursesDone(ctx)).toBe(false);
    answers['/v1/library/courses'] = {
      courses: [course({ status: 'ingesting' }), course({ status: 'failed' })],
    };
    expect(await coursesDone(ctx)).toBe(false);
    answers['/v1/library/courses'] = { courses: [course({ sample: true }), course({})] };
    expect(await coursesDone(ctx)).toBe(true);
  });
  it('calendar: live connection or ingested .ics; fixture/expired does not count', async () => {
    answers['/v1/squad/calendar'] = { ics: false };
    answers['/v1/connections'] = {
      connections: [
        { provider: 'google', mode: 'fixture', status: 'live' },
        { provider: 'google', mode: 'live', status: 'expired' },
      ],
    };
    expect(await calendarDone(ctx)).toBe(false);
    answers['/v1/connections'] = { connections: [live] };
    expect(await calendarDone(ctx)).toBe(true);
    answers['/v1/connections'] = { connections: [] };
    answers['/v1/squad/calendar'] = { ics: true };
    expect(await calendarDone(ctx)).toBe(true);
  });
  it('calendar: a failed read with nothing proven done is an error, not to do', async () => {
    answers['/v1/connections'] = { connections: [] };
    answers['/v1/squad/calendar'] = new TypeError('boom');
    await expect(calendarDone(ctx)).rejects.toThrow();
  });
  it('persona: needs a persona on the account', async () => {
    answers['/v1/me'] = { user: { id: 'u' } };
    expect(await personaDone(ctx)).toBe(false);
    answers['/v1/me'] = { user: { id: 'u', personaId: 'persona_ana' } };
    expect(await personaDone(ctx)).toBe(true);
  });
});

describe('Home checklist', () => {
  it('unknown -> checking, never Done or To do', async () => {
    answers = Object.fromEntries(Object.keys(allEmpty()).map((k) => [k, 'hang']));
    mount();
    expect((await screen.findAllByText('Checking…')).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText('To do')).toBeNull();
  });

  it('ignores stale localStorage setup flags', async () => {
    answers = allEmpty();
    mount();
    await waitFor(() => expect(screen.getAllByText('To do')).toHaveLength(4));
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.getByText('0 of 4 done')).toBeTruthy();
  });

  it('each item is done from its own server answer', async () => {
    answers = {
      ...allEmpty(),
      '/v1/imessage/link': { links: [{ hint: '•••• 1', linkedAt: 1 }] },
      '/v1/library/courses': { courses: [course({ sample: true }), course({})] },
      '/v1/squad/calendar': { ics: true },
      '/v1/me': { user: { id: 'u', personaId: 'p' } },
    };
    mount();
    await waitFor(() => expect(screen.getByText('4 of 4 done')).toBeTruthy());
    for (const t of [
      'Connect iMessage via Sendblue',
      'Connect Canvas or Google Classroom',
      'Connect Google Calendar',
      'Pick your study buddy',
    ])
      expect(within(row(t)).getByText('Done')).toBeTruthy();
  });

  it('sample-only course leaves courses To do while phone is Done', async () => {
    answers = {
      ...allEmpty(),
      '/v1/imessage/link': { links: [{ hint: 'x', linkedAt: 1 }] },
      '/v1/library/courses': { courses: [course({ sample: true, role: 'viewer' })] },
    };
    mount();
    await waitFor(() =>
      expect(within(row('Connect iMessage via Sendblue')).getByText('Done')).toBeTruthy(),
    );
    expect(within(row('Connect Canvas or Google Classroom')).getByText('To do')).toBeTruthy();
  });

  it('a hanging read does not block the others; Retry re-reads only the failed item', async () => {
    answers = {
      ...allEmpty(),
      '/v1/imessage/link': new TypeError('timeout'),
      '/v1/library/courses': 'hang',
    };
    mount();
    await waitFor(() =>
      expect(within(row('Pick your study buddy')).getByText('To do')).toBeTruthy(),
    );
    expect(within(row('Connect Canvas or Google Classroom')).getByText('Checking…')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(row('Connect iMessage via Sendblue')).getByText('Could not check'),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    answers['/v1/imessage/link'] = { links: [{ hint: 'x', linkedAt: 1 }] };
    const before = calls.filter((c) => c === '/v1/me').length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(within(row('Connect iMessage via Sendblue')).getByText('Done')).toBeTruthy(),
    );
    expect(calls.filter((c) => c === '/v1/me').length).toBe(before);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
