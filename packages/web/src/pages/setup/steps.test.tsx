// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SetupPage from './index';
import HomePage from '../home/index';
// the first-run redirect to the tour is covered by the e2e journey (j36); here Home must render
try {
  sessionStorage.setItem('squad.tour.entered.u', '1');
} catch {
  /* ignore */
}
import { SquadProvider } from '../../shell/context';
import { resetRequestBudget } from '../../lib/request-budget';
import { hub as hubClient } from '../connections/api';
import { fakeHub, googleFixture, HUB } from './test-hub';
import { deriveSteps, emptyRaw, type SetupRaw } from './steps';
import { journeyLine } from '../home/journey';

let fake = fakeHub();
beforeEach(() => {
  fake = fakeHub();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => {
  cleanup();
  resetRequestBudget();
  vi.unstubAllGlobals();
});

const provider = (children: React.ReactNode) => (
  <SquadProvider
    hubUrl={HUB}
    mode="live"
    session={{ token: 't', userId: 'u', name: 'Ana', live: true }}
  >
    {children}
  </SquadProvider>
);
function mountSetup(path: string) {
  fake.install();
  return render(
    <MemoryRouter initialEntries={[path]}>
      {provider(
        <Routes>
          <Route path="/squad/setup/:step?" element={<SetupPage />} />
        </Routes>,
      )}
    </MemoryRouter>,
  );
}
function mountHome() {
  fake.install();
  return render(<MemoryRouter>{provider(<HomePage />)}</MemoryRouter>);
}
const row = (t: string) => screen.getByText(t).closest('li') as HTMLElement;

describe('derived steps (pure)', () => {
  const ok = <T,>(v: T) => ({ s: 'ok' as const, v });
  const base = (): SetupRaw => ({
    connections: ok([]),
    pdfs: ok(0),
    ics: ok(false),
    messaging: ok({
      status: { enabled: false },
      setup: { missingEnv: ['SENDBLUE_API_KEY'] },
      linked: 0,
    }),
    me: ok({ personaId: '', projector: undefined }),
  });
  it('is loading until a read answers, never todo', () => {
    const s = deriveSteps(emptyRaw());
    expect(Object.values(s).every((x) => x.status === 'loading')).toBe(true);
  });
  it('nothing connected: every step is a real gap', () => {
    const s = deriveSteps(base());
    expect(s.context.status).toBe('todo');
    expect(s.availability.status).toBe('todo');
    expect(s.messaging.badge).toBe('Not set up yet');
    expect(s.messaging.summary).toContain('Not set up yet: add the Sendblue key');
    expect(s.messaging.missing?.names).toEqual(['SENDBLUE_API_KEY']);
    expect(s.agent.badge).toBe('Not assigned');
  });
  it('PDFs count as real learning context', () => {
    const r = base();
    r.pdfs = ok(4);
    const s = deriveSteps(r);
    expect(s.context.status).toBe('done');
    expect(s.context.lines.find((l) => l.id === 'pdfs')?.count).toBe('4 PDFs');
  });
  it('messaging: practice, degraded, connected', () => {
    const m = (status: object) =>
      deriveSteps({ ...base(), messaging: ok({ status, setup: null, linked: 0 }) }).messaging;
    expect(
      m({ enabled: true, mode: 'fixture', bridge: { provider: 'fake', state: 'fixture' } }).badge,
    ).toBe('Practice mode');
    expect(m({ enabled: true, mode: 'dry_run', bridge: { state: 'dry_run' } }).status).toBe('demo');
    expect(
      m({
        enabled: true,
        mode: 'live',
        transport: 'degraded',
        degradedReason: 'sends to Messages are failing',
        bridge: { state: 'degraded' },
      }).badge,
    ).toBe('Degraded');
    const live = m({
      enabled: true,
      mode: 'live',
      bridge: { provider: 'sendblue', state: 'connected' },
    });
    expect(live.badge).toBe('Connected');
    expect(live.complete).toBe(true);
  });
  it('agent: ready, offline, not assigned', () => {
    const a = (me: { personaId: string; projector: boolean | undefined }) =>
      deriveSteps({ ...base(), me: ok(me) }).agent;
    expect(a({ personaId: 'p', projector: true }).badge).toBe('Ready');
    expect(a({ personaId: 'p', projector: false }).badge).toBe('Offline');
    expect(a({ personaId: '', projector: true }).badge).toBe('Not assigned');
  });
  it('journey line reads Next: ... (N of 5 done)', () => {
    expect(
      journeyLine({ squad: 'done', connect: 'done', ask: 'todo', council: 'todo', plan: 'todo' }),
    ).toBe('Next: ask Cubbie a question (2 of 5 done)');
  });
});

describe('Setup follows Connections (one source of truth)', () => {
  it('a connected Google fixture is Demo-connected in Learning context and Availability, with counts', async () => {
    fake.connectGoogleFixture();
    const { unmount } = mountSetup('/squad/setup/context');
    const ctx = await screen.findByTestId('setup-context');
    await waitFor(() => expect(within(ctx).getByText('Demo-connected')).toBeTruthy());
    expect(within(ctx).getAllByText('Demo-connected')).toHaveLength(1);
    expect(within(ctx).getByText('1 Classroom item')).toBeTruthy();
    expect(within(ctx).queryByText(/not started/i)).toBeNull();
    unmount();
    cleanup();
    mountSetup('/squad/setup/availability');
    const av = await screen.findByTestId('setup-availability');
    await waitFor(() => expect(within(av).getByText('Demo-connected')).toBeTruthy());
    expect(within(av).getByText('4 calendar events')).toBeTruthy();
  });

  it('Home shows the same rows, then disconnecting reverts them', async () => {
    fake.connectGoogleFixture();
    const first = mountHome();
    await waitFor(() =>
      expect(within(row('Learning context')).getByText('Demo-connected')).toBeTruthy(),
    );
    expect(within(row('Availability')).getByText('Demo-connected')).toBeTruthy();
    expect(within(row('Messaging')).getByText('Not set up yet')).toBeTruthy();
    expect(screen.getByText('2 of 4 done')).toBeTruthy();
    first.unmount();
    cleanup();

    // Disconnect through the real API client (against the fake hub), then look again.
    await hubClient({ hubUrl: HUB, token: 't' }).disconnect('g1', true);
    mountHome();
    await waitFor(() => expect(within(row('Learning context')).getByText('To do')).toBeTruthy());
    expect(within(row('Availability')).getByText('To do')).toBeTruthy();
    expect(screen.queryByText('Demo-connected')).toBeNull();
    expect(screen.getByText('0 of 4 done')).toBeTruthy();
  });

  it('Setup reverts too after disconnect', async () => {
    fake.connectGoogleFixture();
    fake.connections = [];
    mountSetup('/squad/setup/context');
    const ctx = await screen.findByTestId('setup-context');
    await waitFor(() => expect(within(ctx).getByText('To do')).toBeTruthy());
    expect(within(ctx).queryByText('Demo-connected')).toBeNull();
  });

  it('a live Google connection is Done, not Demo-connected', async () => {
    fake.connections = [googleFixture({ mode: 'live', state: 'live' })];
    mountSetup('/squad/setup/availability');
    const av = await screen.findByTestId('setup-availability');
    await waitFor(() => expect(within(av).getByText('Done')).toBeTruthy());
  });

  it('home journey counts demo as done with a Demo-connected label', async () => {
    fake.connectGoogleFixture();
    mountHome();
    const steps = await screen.findByLabelText('Your steps');
    await waitFor(() =>
      expect(within(steps).getByText(/Connect Google or Canvas \(Demo-connected\)/)).toBeTruthy(),
    );
  });
});

describe('Setup step pages', () => {
  it('with no step it redirects to the first incomplete step', async () => {
    fake.connectGoogleFixture();
    mountSetup('/squad/setup');
    expect(await screen.findByTestId('setup-messaging')).toBeTruthy();
  });

  it('messaging names the missing settings in plain words; env names only in the collapsed detail', async () => {
    mountSetup('/squad/setup/messaging');
    const m = await screen.findByTestId('setup-messaging');
    await waitFor(() => expect(within(m).getByText('Not set up yet')).toBeTruthy());
    expect(
      within(m).getByText(/add the Sendblue key and the Sendblue secret to turn this on/),
    ).toBeTruthy();
    const details = m.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('SENDBLUE_API_KEY');
    expect(screen.getByText('Link your phone number')).toBeTruthy();
  });

  it('every step has title, lede, next line, deep links, one primary CTA, Back/Next, and focuses the heading', async () => {
    fake.connectGoogleFixture();
    mountSetup('/squad/setup/availability');
    await screen.findByTestId('setup-availability');
    await waitFor(() => expect(screen.getByText('Demo-connected')).toBeTruthy());
    expect(screen.getByRole('heading', { level: 1, name: 'Availability' })).toBeTruthy();
    expect(screen.getByTestId('page-lede')).toBeTruthy();
    expect(screen.getByTestId('page-next').textContent).toMatch(/^Next:/);
    const actions = within(screen.getByTestId('step-actions'));
    expect(
      actions.getByRole('link', { name: 'Review imported context' }).getAttribute('href'),
    ).toBe('/squad/connections#imported');
    expect(actions.getByRole('link', { name: 'Change source' }).getAttribute('href')).toBe(
      '/squad/connections#google',
    );
    expect(screen.getByRole('link', { name: /Back/ }).getAttribute('href')).toBe(
      '/squad/setup/context',
    );
    expect(document.querySelectorAll('.sq-btn--primary')).toHaveLength(1);
    expect(document.activeElement?.getAttribute('data-page-title')).not.toBeNull();
  });

  it('an incomplete step makes Change source the one primary action', async () => {
    mountSetup('/squad/setup/context');
    await waitFor(() => expect(screen.getByText('To do')).toBeTruthy());
    const primary = Array.from(document.querySelectorAll('.sq-btn--primary'));
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Change source');
  });

  it('PDFs and the sources show together with counts and a link to Courses', async () => {
    fake.answers['/v1/library/courses'] = {
      courses: [1, 2, 3, 4].map((i) => ({ id: `c${i}`, sample: false, status: 'ready' })),
    };
    mountSetup('/squad/setup/context');
    await waitFor(() => expect(screen.getByText('4 PDFs')).toBeTruthy());
    expect(screen.getByText('Canvas')).toBeTruthy();
    expect(screen.getByText('Google Classroom')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add PDFs in Courses' }).getAttribute('href')).toBe(
      '/squad/courses',
    );
  });

  it('legacy /setup/courses opens Learning context', async () => {
    mountSetup('/squad/setup/courses');
    expect(await screen.findByTestId('setup-context')).toBeTruthy();
  });
});

describe('Home: what is happening now', () => {
  it('empty: each fact offers its own recovery button', async () => {
    mountHome();
    const now = await screen.findByTestId('home-now');
    await waitFor(() => expect(within(now).getByText('No question asked yet.')).toBeTruthy());
    expect(within(now).getByRole('link', { name: 'Ask the council' })).toBeTruthy();
    expect(within(now).getByRole('link', { name: 'Connect a source' })).toBeTruthy();
    expect(within(now).getByText('No plan saved yet.')).toBeTruthy();
  });

  it('running council, syncing source and a saved plan', async () => {
    fake.answers['/v1/council/runs?limit=5'] = {
      runs: [{ id: 'r', status: 'running', question: 'q' }],
    };
    fake.answers['/v1/plans/current'] = {
      plan: { id: 'p', title: 'Finals week', saved: { lastEditedAt: Date.now() } },
    };
    fake.connections = [googleFixture({ syncPhase: 'syncing' })];
    mountHome();
    const now = await screen.findByTestId('home-now');
    await waitFor(() => expect(within(now).getByText(/Running now/)).toBeTruthy());
    expect(within(now).getByText(/Importing your items now/)).toBeTruthy();
    expect(within(now).getByText(/Saved: Finals week/)).toBeTruthy();
  });

  it('offline: says so and offers Try again', async () => {
    fake.answers['/v1/council/runs?limit=5'] = new TypeError('down');
    fake.answers['/v1/plans/current'] = new TypeError('down');
    mountHome();
    const now = await screen.findByTestId('home-now');
    await waitFor(() =>
      expect(within(now).getByRole('button', { name: 'Try again' })).toBeTruthy(),
    );
  });
});
