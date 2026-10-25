import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useMatches,
  useNavigate,
  type RouteObject,
} from 'react-router-dom';
import {
  AuthProvider,
  Skeleton,
  SquadSwitcher,
  accountPublicRoutes,
  createAccountsClient,
  useAccount,
  EmptyState,
  RateLimitedState,
  Button,
  Gallery,
  FailureState,
  LoadingTimeout,
  RouteTitle,
  RouterAppShell,
  SquadProvider,
  ToastProvider,
  squadRoutes,
  type SquadRouteMeta,
  type SquadSession,
} from '@squad/web';
import { useCallback, useMemo, useState } from 'react';
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

function LiveSignInRoute() {
  const account = useAccount();
  const navigate = useNavigate();
  if (account.status === 'signed-in') return <Navigate to="/squad" replace />;
  return (
    <SignInStub
      hubUrl={HUB_URL}
      onSignIn={(s) => void account.adoptToken(s.token).then(() => navigate('/squad'))}
    />
  );
}

function SignInRoute() {
  if (HUB_URL) return <LiveSignInRoute />;
  return <DemoSignInRoute />;
}

function DemoSignInRoute() {
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

/** Live hub: real accounts (cookie + bearer). Falls back to the demo sign-in only without a hub. */
function LiveShellLayout() {
  const account = useAccount();
  const navigate = useNavigate();
  const matches = useMatches();
  const meta = [...matches].reverse().find((m) => (m.handle as SquadRouteMeta | undefined)?.key)
    ?.handle as SquadRouteMeta | undefined;
  if (account.status === 'loading')
    return (
      <LoadingTimeout
        what="Signing you in"
        slowWhat="your session"
        timeoutMs={12000}
        onRetry={() => window.location.reload()}
      >
        <div style={{ padding: 24 }} role="status" aria-live="polite">
          <p style={{ margin: '0 0 16px' }}>Signing you in...</p>
          <Skeleton shape="block" height={240} />
        </div>
      </LoadingTimeout>
    );
  if (account.status === 'rate-limited' && !account.user)
    return (
      <div style={{ padding: 24 }}>
        <RateLimitedState
          retryAt={account.retryAt}
          onRetry={() => void account.refresh().catch(() => undefined)}
        />
      </div>
    );
  if (account.status === 'signed-out' || !account.user)
    return (
      <Navigate
        to={`/welcome?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  if (account.squads.length === 0 && !location.pathname.startsWith('/squad/new'))
    return <Navigate to="/welcome/choose" replace />;
  const session: SquadSession = {
    userId: account.user.id,
    name: account.user.name,
    token: account.token ?? '',
    ...(account.user.avatarUrl ? { avatarUrl: account.user.avatarUrl } : {}),
    live: true,
  };
  const onSignOut = () => void account.logout().then(() => navigate('/welcome'));
  return (
    <SquadProvider
      key={account.activeSquadId ?? 'none'}
      hubUrl={HUB_URL}
      session={session}
      onSignOut={onSignOut}
    >
      <RouterAppShell
        user={{ id: session.userId, name: session.name, avatarUrl: session.avatarUrl }}
        status={{ connection: 'live', label: 'Live' }}
        onSignOut={onSignOut}
        fullBleed={meta?.fullBleed}
        accountExtra={
          <SquadSwitcher
            squads={account.squads}
            activeSquadId={account.activeSquadId}
            onSwitch={(id) =>
              account.switchSquad(id).then(() => navigate('/squad', { replace: true }))
            }
          />
        }
      >
        <Outlet />
      </RouterAppShell>
    </SquadProvider>
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
  const client = useMemo(() => (HUB_URL ? createAccountsClient({ hubUrl: HUB_URL }) : null), []);
  const body = (
    <ToastProvider>
      <RouteTitle />
      <Outlet />
    </ToastProvider>
  );
  return client ? <AuthProvider client={client}>{body}</AuthProvider> : body;
}

/** Router-level error element: a route that throws shows this instead of React Router's default screen. */
function RouteError() {
  return (
    <FailureState
      title="Squad hit a problem"
      body="Something went wrong while opening this page."
      onRetry={() => window.location.reload()}
    />
  );
}

export const routes: RouteObject[] = [
  {
    element: <Providers />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Navigate to="/squad" replace /> },
      { path: '/signin', element: <SignInRoute /> },
      { path: '/__gallery', element: <GalleryRoute /> },
      ...labRoutes,
      ...(HUB_URL ? accountPublicRoutes : []),
      { element: HUB_URL ? <LiveShellLayout /> : <ShellLayout />, children: squadRoutes },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
