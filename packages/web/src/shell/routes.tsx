import { createElement, lazy, Suspense, useMemo, useState, type ComponentType } from 'react';
import { matchPath, type RouteObject } from 'react-router-dom';
import type { NavItem, SquadRouteMeta } from './types';
import { EmptyState } from '../primitives/EmptyState';
import { Skeleton } from '../primitives/Skeleton';
import { WorldLoading } from './WorldLoading';
import { ErrorBoundary, LoadingTimeout } from './ErrorBoundary';

export const squadRouteMeta: SquadRouteMeta[] = [
  {
    key: 'home',
    path: '/squad',
    title: 'Home',
    nav: { label: 'Home', icon: 'home', order: 0, primary: true },
  },
  {
    key: 'village',
    path: '/squad/village',
    title: 'Village',
    fullBleed: true,
    nav: { label: 'Village', icon: 'map', order: 1, primary: true },
  },
  {
    key: 'chat',
    path: '/squad/chat',
    title: 'Chat',
    nav: { label: 'Chat', icon: 'message', order: 2, primary: true },
  },
  {
    key: 'squad-create',
    path: '/squad/new',
    title: 'Create a squad',
  },
  {
    key: 'squad-members',
    path: '/squad/members',
    title: 'Members',
  },
  {
    key: 'setup',
    path: '/squad/setup/:step?',
    title: 'Set up',
    nav: { label: 'Setup', icon: 'sparkle', order: 5 },
  },
  {
    key: 'personas',
    path: '/squad/personas',
    title: 'Personas',
    nav: { label: 'Personas', icon: 'users', order: 6 },
  },
  {
    key: 'ledger',
    path: '/squad/ledger/:taskId?',
    title: 'Ledger',
    nav: { label: 'Ledger', icon: 'ledger', order: 3, primary: true },
  },
  {
    key: 'trip',
    path: '/squad/trips/:tripId?',
    title: 'Trip',
    nav: { label: 'Trip', icon: 'plane', order: 4 },
  },
  {
    key: 'status',
    path: '/squad/status',
    title: 'Status',
  },
  {
    key: 'mastery',
    path: '/squad/mastery/:courseId?',
    title: 'Mastery',
    // No nav item: mastery lives in the village. This path only redirects to /squad/village?mastery=1.
  },
  {
    key: 'courses',
    path: '/squad/courses/:courseId?',
    title: 'Courses',
    nav: { label: 'Courses', icon: 'book', order: 7 },
  },
];

/** nav links resolve params-free targets */
export const squadNav: NavItem[] = squadRouteMeta
  .filter((r) => r.nav)
  .map((r) => ({
    key: r.key,
    label: r.nav!.label,
    icon: r.nav!.icon,
    order: r.nav!.order,
    primary: r.nav!.primary,
    to: r.path.replace(/\/:[a-zA-Z]+\??/g, ''),
  }))
  .sort((a, b) => a.order - b.order);

// Vite-only discovery. Missing page folders fall back to a designed "coming soon" state.
const pageModules = import.meta.glob<{ default: ComponentType }>('../pages/*/index.tsx');

function ComingSoon({ title }: { title: string }) {
  return createElement(EmptyState, {
    title: `${title} is on its way`,
    body: 'This page is still being built. The rest of Squad works while it lands.',
    icon: 'sparkle',
  });
}

type Loader = () => Promise<{ default: ComponentType }>;

/** A chunk that fails to load is retried once (a dev-server restart or a network blip), then the error surfaces. */
export async function importWithRetry(
  loader: Loader,
  delayMs = 400,
): Promise<{ default: ComponentType }> {
  try {
    return await loader();
  } catch {
    await new Promise((r) => setTimeout(r, delayMs));
    return loader();
  }
}

/**
 * Hosts one route's lazy page. Always renders one of: the page, a loading state that times out into an error,
 * or an error state with Retry (chunk failed after its retry, or the page threw while rendering).
 */
export function PageHost({ meta, loader }: { meta: SquadRouteMeta; loader: Loader }) {
  const [attempt, setAttempt] = useState(0);
  const Lazy = useMemo(() => lazy(() => importWithRetry(loader)), [loader, attempt]);
  const again = () => setAttempt((n) => n + 1);
  const loading =
    meta.key === 'village' ? <WorldLoading /> : <Skeleton shape="block" height={240} />;
  return (
    <ErrorBoundary resetKey={attempt} onRetry={again} title={`${meta.title} could not load`}>
      <Suspense
        fallback={
          <LoadingTimeout
            onRetry={again}
            what={meta.title}
            // the village ships a ~340 KB engine chunk: on a slow connection that legitimately takes a while,
            // so it gets a longer budget (and says "Still loading" at 8 s) before it is called an error
            timeoutMs={meta.key === 'village' ? 45000 : 12000}
            slowWhat={meta.key === 'village' ? 'the village' : undefined}
          >
            {loading}
          </LoadingTimeout>
        }
      >
        <Lazy />
      </Suspense>
    </ErrorBoundary>
  );
}

export function loadPage(meta: SquadRouteMeta): ComponentType {
  const loader = pageModules[`../pages/${meta.key}/index.tsx`];
  if (!loader) return () => createElement(ComingSoon, { title: meta.title });
  return function Page() {
    return createElement(PageHost, { meta, loader });
  };
}

/** Title for a pathname, from the route table (the router location is the single source of truth). */
export function routeTitleFor(pathname: string): string {
  const all = [
    ...squadRouteMeta,
    { path: '/welcome/:step?', title: 'Welcome' },
    { path: '/join/:code?', title: 'Join a squad' },
    { path: '/signin', title: 'Sign in' },
  ];
  // most specific first: longer static prefix wins ("/squad" must not shadow "/squad/village")
  const hit = [...all]
    .sort((a, b) => b.path.length - a.path.length)
    .find((m) => matchPath({ path: m.path, end: true }, pathname));
  return hit?.title ?? '';
}

export const squadRoutes: RouteObject[] = squadRouteMeta.map((meta) => {
  const Page = loadPage(meta);
  return { path: meta.path, element: createElement(Page), handle: meta } satisfies RouteObject;
});

/** Reachable before sign-in (accounts). Hosts mount these outside the shell. */
export const accountPublicRoutes: RouteObject[] = [
  { key: 'welcome', path: '/welcome/:step?', title: 'Welcome' },
  { key: 'squad-join', path: '/join/:code?', title: 'Join a squad' },
].map((meta) => {
  const Page = loadPage({ ...meta, public: true });
  return { path: meta.path, element: createElement(Page) } satisfies RouteObject;
});
