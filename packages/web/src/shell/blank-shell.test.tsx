// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, useNavigate, useRoutes, type RouteObject } from 'react-router-dom';
import type { ComponentType } from 'react';
import { ToastProvider } from '../primitives/Toast';
import { AuthProvider, useAccount } from '../auth/AuthProvider';
import { createAccountsClient } from '../auth/client';
import { importWithRetry, PageHost, routeTitleFor, squadRouteMeta, squadRoutes } from './routes';
import { LoadingTimeout, ErrorBoundary } from './ErrorBoundary';
import { RouterAppShell } from './RouterAppShell';
import { RouteTitle } from './RouteTitle';
import { SquadProvider } from './context';
import { timedFetch } from '../lib/http';

function memoryStorage(): Storage {
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
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
});

const meta = { key: 'x', path: '/x', title: 'Thing' };
const Good: ComponentType = () => <p>page body</p>;

describe('lazy chunk failure', () => {
  it('retries a failed chunk once before giving up', async () => {
    const loader = vi
      .fn<() => Promise<{ default: ComponentType }>>()
      .mockRejectedValueOnce(new Error('chunk'))
      .mockResolvedValueOnce({ default: Good });
    await expect(importWithRetry(loader, 1)).resolves.toEqual({ default: Good });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('shows the error state with Retry (never blank), and Retry loads the page', async () => {
    let healthy = false;
    const loader = vi.fn(async () => {
      if (!healthy) throw new Error('Failed to fetch dynamically imported module');
      return { default: Good };
    });
    render(<PageHost meta={meta} loader={loader} />);
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      'Thing could not load',
    );
    expect(loader).toHaveBeenCalledTimes(2); // first try + one retry
    healthy = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('page body')).toBeTruthy();
  });

  it('a chunk that never settles times out into the error state', async () => {
    vi.useFakeTimers();
    render(
      <LoadingTimeout timeoutMs={5000} onRetry={() => {}} what="Village">
        <span>loading</span>
      </LoadingTimeout>,
    );
    expect(screen.getByText('loading')).toBeTruthy();
    await act(async () => void vi.advanceTimersByTime(5001));
    expect(screen.getByRole('alert')).toHaveTextContent('Village is taking too long');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('a page that throws while rendering shows the error state', () => {
    const Boom = () => {
      throw new Error('boom');
    };
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('slow or failed /v1/me', () => {
  function Probe() {
    const a = useAccount();
    return <p data-testid="status">{a.status}</p>;
  }
  const hang: typeof fetch = (_u, init) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });

  it('stays loading, then resolves to offline (not forever) when /v1/me hangs', async () => {
    localStorage.setItem('squad.token', 'tok');
    vi.useFakeTimers();
    const client = createAccountsClient({ hubUrl: 'http://hub.test', fetch: hang });
    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('status').textContent).toBe('loading');
    await act(async () => void vi.advanceTimersByTime(8100));
    expect(screen.getByTestId('status').textContent).toBe('offline');
  });

  it('a 500 from /v1/me ends in offline, a 401 with no session ends signed-out', async () => {
    localStorage.setItem('squad.token', 'tok');
    const f500: typeof fetch = async () => new Response('{}', { status: 500 });
    render(
      <AuthProvider client={createAccountsClient({ hubUrl: 'http://hub.test', fetch: f500 })}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('offline'));
    cleanup();
    const f401: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 });
    render(
      <AuthProvider client={createAccountsClient({ hubUrl: 'http://hub.test', fetch: f401 })}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
  });

  it('timedFetch rejects instead of hanging', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hang);
    const p = timedFetch('http://hub.test/x', {}, 1000);
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await caught).toBeInstanceOf(TypeError);
  });
});

/* ---------------------------------------------------------------- route <-> title <-> content */

const CONCRETE: Record<string, string> = {
  '/squad/setup/:step?': '/squad/setup/phone',
  '/squad/ledger/:taskId?': '/squad/ledger',
  '/squad/trips/:tripId?': '/squad/trips',
  '/squad/mastery/:courseId?': '/squad/mastery',
  '/squad/courses/:courseId?': '/squad/courses',
  '/squad/welcome-tour/:step?': '/squad/welcome-tour/connect',
};
// mastery has no page of its own: it redirects into the village overlay (covered by its own test below)
const TOP = squadRouteMeta
  .filter((m) => m.key !== 'mastery')
  .map((m) => ({
    path: CONCRETE[m.path] ?? m.path,
    title: m.title,
    key: m.key,
  }));

const nav: { go: (p: string) => void } = { go: () => {} };
function Routes_({ routes }: { routes: RouteObject[] }) {
  const navigate = useNavigate();
  nav.go = (p) => navigate(p);
  return useRoutes(routes);
}
/** jsdom's AbortSignal is not undici's, so the data router cannot build a Request: use the declarative router. */
function mount(initial: string) {
  const routes: RouteObject[] = [
    {
      element: (
        <ToastProvider>
          <RouteTitle />
          <SquadProvider hubUrl={null} session={null}>
            <RouterAppShell user={{ id: 'u', name: 'Ana' }}>
              <Outlet />
            </RouterAppShell>
          </SquadProvider>
        </ToastProvider>
      ),
      children: squadRoutes,
    },
  ];
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes_ routes={routes} />
    </MemoryRouter>,
  );
}
const go = (p: string) => act(async () => void nav.go(p));

async function expectRoute(path: string, title: string) {
  await waitFor(
    () => {
      expect(document.title).toBe(`${title} · Squad`);
      const main = screen.getByRole('main');
      expect(main.getAttribute('aria-label')).toBe(title);
      expect(main.getAttribute('data-route')).toBe(path);
      expect(main.textContent!.trim().length).toBeGreaterThan(0); // content, not a blank shell
      expect(main.querySelector('[aria-hidden="true"].sq-skeleton, .sq-world-loading')).toBeNull();
    },
    { timeout: 15000 },
  );
}

describe('router location drives title, landmark and content', () => {
  it('routeTitleFor resolves every route to its own title', () => {
    for (const t of TOP) expect(routeTitleFor(t.path)).toBe(t.title);
    expect(routeTitleFor('/squad/ledger/task_1')).toBe('Privacy ledger');
    expect(routeTitleFor('/welcome')).toBe('Welcome');
  });

  for (const t of TOP) {
    it(`deep link ${t.path} renders ${t.title}`, async () => {
      mount(t.path);
      await expectRoute(t.path, t.title);
      const active = document.querySelector('.sq-shell__navlink.is-active, .is-active');
      if (['home', 'village', 'chat'].includes(t.key)) expect(active).toBeTruthy();
    }, 30000);
  }

  it('navigating between every pair of top-level routes updates title + landmark + content', async () => {
    mount(TOP[0]!.path);
    await expectRoute(TOP[0]!.path, TOP[0]!.title);
    for (const from of TOP) {
      for (const to of TOP) {
        if (from.path === to.path) continue;
        await go(from.path);
        await expectRoute(from.path, from.title);
        await go(to.path);
        await expectRoute(to.path, to.title);
      }
    }
  }, 240000);

  it('/squad/mastery lands on the village with the village title and landmark', async () => {
    mount('/squad/mastery');
    await expectRoute('/squad/village', 'Village');
  }, 60000);

  it('the nav highlight follows the location', async () => {
    mount('/squad/chat');
    await expectRoute('/squad/chat', 'Chat');
    const cur = () =>
      Array.from(document.querySelectorAll('[aria-current="page"]')).map((e) => e.textContent);
    expect(cur().some((t) => /Chat/.test(t ?? ''))).toBe(true);
    await go('/squad/ledger');
    await expectRoute('/squad/ledger', 'Privacy ledger');
    // a secondary destination highlights its parent: the More button
    expect(document.querySelector('.sq-shell__morebtn.is-active')).toBeTruthy();
    expect(cur().some((t) => /Chat/.test(t ?? ''))).toBe(false);
  }, 60000);
});
