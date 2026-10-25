// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, useRoutes, type RouteObject } from 'react-router-dom';
import { ToastProvider } from '../primitives/Toast';
import { squadRoutes, squadRouteMeta } from '../shell/routes';
import { RouterAppShell } from '../shell/RouterAppShell';
import { RouteTitle } from '../shell/RouteTitle';
import { SquadProvider } from '../shell/context';
import { StatusChip, type ChipStatus, CHIP_STATUS } from '../primitives/StatusChip';
import { auditChromeText } from './chrome-dom';

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
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('audit helper', () => {
  it('flags emoji and bare markers, ignores user content', () => {
    document.body.innerHTML = `
      <p id="a">Great job 🎉</p>
      <p id="b">●</p>
      <p id="c">● Live</p>
      <p data-user-content>user says 🎉 ● hi</p>
      <div data-testid="chat-message-body">🐻 ok</div>
      <p>Plain · text</p>`;
    const v = auditChromeText(document.body);
    expect(v.map((x) => x.text)).toEqual(['Great job 🎉', '●', '● Live']);
  });
});

describe('StatusChip', () => {
  it('always renders an icon and a word', () => {
    for (const s of Object.keys(CHIP_STATUS) as ChipStatus[]) {
      const { container, unmount } = render(<StatusChip status={s} />);
      expect(container.querySelector('svg')).toBeTruthy();
      expect(container.textContent!.length).toBeGreaterThan(2);
      expect(auditChromeText(container)).toEqual([]);
      unmount();
    }
  });
});

const CONCRETE: Record<string, string> = {
  '/squad/setup/:step?': '/squad/setup',
  '/squad/ledger/:taskId?': '/squad/ledger',
  '/squad/trips/:tripId?': '/squad/trips',
  '/squad/courses/:courseId?': '/squad/courses',
};
const ROUTES = squadRouteMeta.filter((m) => m.key !== 'mastery' && m.key !== 'ledger').map((m) => CONCRETE[m.path] ?? m.path);

function Routes_({ routes }: { routes: RouteObject[] }) {
  return useRoutes(routes);
}

describe('every route is free of decorative emoji and dot markers', () => {
  for (const path of ROUTES) {
    it(path, async () => {
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
        <MemoryRouter initialEntries={[path]}>
          <Routes_ routes={routes} />
        </MemoryRouter>,
      );
      await waitFor(
        () => {
          const main = screen.getByRole('main');
          expect(main.textContent!.trim().length).toBeGreaterThan(0);
          expect(main.querySelector('.sq-skeleton, .sq-world-loading')).toBeNull();
        },
        { timeout: 15000 },
      );
      expect(auditChromeText(document.body)).toEqual([]);
    }, 30000);
  }
});
