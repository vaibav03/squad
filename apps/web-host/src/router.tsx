import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useMatches,
  useNavigate,
  type RouteObject,
} from 'react-router-dom';
import {
  EmptyState,
  Button,
  Gallery,
  RouterAppShell,
  SquadProvider,
  ToastProvider,
  squadRoutes,
  type SquadRouteMeta,
  type SquadSession,
} from '@squad/web';
import { useCallback, useState } from 'react';
import { labRoutes } from './lab';
import { loadSession, saveSession } from './session';
import { SignInStub } from './SignInStub';

const HUB_URL =
  ((import.meta.env.VITE_HUB_URL ?? import.meta.env.VITE_HUB_BASE_URL) as string | undefined) ||
  null;

function useSession() {
  const [session, setSession] = useState<SquadSession | null>(() => loadSession());
  const update = useCallback((s: SquadSession | null) => {
    saveSession(s);
    setSession(s);
  }, []);
  return [session, update] as const;
}

function SignInRoute() {
  const [session, setSession] = useSession();
  const navigate = useNavigate();
  if (session) return <Navigate to="/squad" replace />;
  return (
    <SignInStub
      hubUrl={HUB_URL}
      onSignIn={(s) => {
        setSession(s);
        navigate('/squad');
      }}
    />
  );
}

function ShellLayout() {
  const [session, setSession] = useSession();
  const navigate = useNavigate();
  const matches = useMatches();
  const meta = [...matches].reverse().find((m) => (m.handle as SquadRouteMeta | undefined)?.key)
    ?.handle as SquadRouteMeta | undefined;
  if (!session) return <Navigate to="/signin" replace />;
  const onSignOut = () => {
    setSession(null);
    navigate('/signin');
  };
  return (
    <SquadProvider hubUrl={HUB_URL} session={session} onSignOut={onSignOut}>
      <RouterAppShell
        user={{ id: session.userId, name: session.name, avatarUrl: session.avatarUrl }}
        status={
          HUB_URL && session.live
            ? { connection: 'live', label: 'Live' }
            : { connection: 'replay', label: 'Demo data' }
        }
        onSignOut={onSignOut}
        fullBleed={meta?.fullBleed}
      >
        <Outlet />
      </RouterAppShell>
    </SquadProvider>
  );
}

function NotFound() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <EmptyState
        icon="map"
        title="Nothing at this address"
        body="That path is not part of the village."
        action={
          <Button as="a" href="/squad" variant="primary">
            Back to Squad
          </Button>
        }
      />
    </div>
  );
}

function GalleryRoute() {
  return (
    <ToastProvider>
      <Gallery />
    </ToastProvider>
  );
}

function Providers() {
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Providers />,
    children: [
      { path: '/', element: <Navigate to="/squad" replace /> },
      { path: '/signin', element: <SignInRoute /> },
      { path: '/__gallery', element: <GalleryRoute /> },
      ...labRoutes,
      { element: <ShellLayout />, children: squadRoutes },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
