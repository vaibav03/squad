import { createElement, lazy, Suspense, type ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';
import type { NavItem, SquadRouteMeta } from './types';
import { EmptyState } from '../primitives/EmptyState';
import { Skeleton } from '../primitives/Skeleton';
import { WorldLoading } from './WorldLoading';

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
    key: 'setup',
    path: '/squad/setup/:step?',
    title: 'Setup',
    nav: { label: 'Setup', icon: 'sparkle', order: 4 },
  },
  {
    key: 'personas',
    path: '/squad/personas',
    title: 'Personas',
    nav: { label: 'Personas', icon: 'users', order: 5 },
  },
  {
    key: 'ledger',
    path: '/squad/ledger/:taskId?',
    title: 'Glass Box',
    nav: { label: 'Ledger', icon: 'ledger', order: 2, primary: true },
  },
  {
    key: 'trip',
    path: '/squad/trips/:tripId',
    title: 'Trip',
    nav: { label: 'Trip', icon: 'plane', order: 3, primary: true },
  },
  {
    key: 'mastery',
    path: '/squad/mastery/:courseId?',
    title: 'Mastery',
    nav: { label: 'Mastery', icon: 'book', order: 6 },
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

export function loadPage(meta: SquadRouteMeta): ComponentType {
  const loader = pageModules[`../pages/${meta.key}/index.tsx`];
  if (!loader) return () => createElement(ComingSoon, { title: meta.title });
  const Lazy = lazy(loader);
  return function PageHost() {
    return createElement(
      Suspense,
      {
        fallback:
          meta.key === 'village'
            ? createElement(WorldLoading)
            : createElement(Skeleton, { shape: 'block', height: 240 }),
      },
      createElement(Lazy),
    );
  };
}

export const squadRoutes: RouteObject[] = squadRouteMeta.map((meta) => {
  const Page = loadPage(meta);
  return { path: meta.path, element: createElement(Page), handle: meta } satisfies RouteObject;
});
