// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './index';
// the first-run redirect to the tour is covered by the e2e journey (j36); here Home must render
try {
  sessionStorage.setItem('squad.tour.entered.u', '1');
} catch {
  /* ignore */
}
import { SquadProvider } from '../../shell/context';
import { resetRequestBudget } from '../../lib/request-budget';
import { fakeHub, googleFixture, HUB } from '../setup/test-hub';

let fake = fakeHub();
beforeEach(() => {
  fake = fakeHub();
  const store = new Map<string, string>([
    ['squad.setup.done', JSON.stringify(['phone', 'courses', 'calendar'])], // stale local flags must be ignored
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => {
  cleanup();
  resetRequestBudget(); // a read left hanging by one test must not hold a slot for the next
  vi.unstubAllGlobals();
});

function mount() {
  fake.install();
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

describe('Home checklist (same answers as Setup)', () => {
  it('unknown -> checking, never Done or To do', async () => {
    for (const k of [
      '/v1/connections',
      '/v1/imessage/status',
      '/v1/me',
      '/v1/library/courses',
      '/v1/squad/calendar',
    ])
      fake.answers[k] = 'hang';
    mount();
    expect((await screen.findAllByText('Checking…')).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.queryByText('To do')).toBeNull();
  });

  it('ignores stale localStorage setup flags; four rows, none done', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('0 of 4 done')).toBeTruthy());
    expect(screen.queryByText('Done')).toBeNull();
    expect(row('Learning context')).toBeTruthy();
    expect(row('Availability')).toBeTruthy();
    expect(row('Messaging')).toBeTruthy();
    expect(row('Agent')).toBeTruthy();
    expect(within(row('Messaging')).getByText('Not set up yet')).toBeTruthy();
    expect(within(row('Agent')).getByText('Not assigned')).toBeTruthy();
  });

  it('every row is done from its own server answer', async () => {
    fake.connections = [googleFixture({ mode: 'live', state: 'live' })];
    fake.answers['/v1/imessage/status'] = {
      enabled: true,
      mode: 'live',
      bridge: { provider: 'sendblue', state: 'connected' },
    };
    fake.answers['/v1/me'] = { user: { id: 'u', personaId: 'p' }, projector: true };
    mount();
    await waitFor(() => expect(screen.getByText('4 of 4 done')).toBeTruthy());
    expect(within(row('Learning context')).getByText('Done')).toBeTruthy();
    expect(within(row('Messaging')).getByText('Connected')).toBeTruthy();
    expect(within(row('Agent')).getByText('Ready')).toBeTruthy();
  });

  it('each row opens its Setup step', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('0 of 4 done')).toBeTruthy());
    expect(row('Messaging').querySelector('a')!.getAttribute('href')).toBe(
      '/squad/setup/messaging',
    );
  });

  it('a failed read shows Could not check; Retry re-reads only the failed item', async () => {
    fake.answers['/v1/me'] = new TypeError('timeout');
    mount();
    await waitFor(() => expect(within(row('Agent')).getByText('Could not check')).toBeTruthy());
    expect(screen.getByRole('alert')).toBeTruthy();
    fake.answers['/v1/me'] = { user: { id: 'u', personaId: 'p' }, projector: true };
    const before = fake.calls.filter((c) => c === 'GET /v1/connections').length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(row('Agent')).getByText('Ready')).toBeTruthy());
    expect(fake.calls.filter((c) => c === 'GET /v1/connections').length).toBe(before);
  });
});
