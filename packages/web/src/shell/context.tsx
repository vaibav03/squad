import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { LiveConfigProvider, type LiveConfig } from '../overlays/kit/live-config';
import { hubStudentId } from './dev-login';
import type { SquadConfig, SquadSession } from './types';

const defaultConfig: SquadConfig = { hubUrl: null, token: null, userId: null, mode: 'mock' };
const ConfigCtx = createContext<SquadConfig>(defaultConfig);
const SessionCtx = createContext<{ session: SquadSession | null; signOut: () => void }>({
  session: null,
  signOut: () => {},
});

export function SquadProvider(props: {
  hubUrl?: string | null;
  session?: SquadSession | null;
  mode?: SquadConfig['mode'];
  onSignOut?: () => void;
  children: ReactNode;
}) {
  const { hubUrl = null, session = null, mode, onSignOut, children } = props;
  const config = useMemo<SquadConfig>(
    () => ({
      hubUrl,
      token: session?.token ?? null,
      userId: session?.userId ?? null,
      // Pages leave mock mode only with a hub URL and a real signed-in token (dev-login), never on a demo token.
      mode: mode ?? (hubUrl && session?.live ? 'live' : 'mock'),
    }),
    [hubUrl, session, mode],
  );
  const live = useMemo(() => liveConfigFrom(config), [config]);
  const sess = useMemo(() => ({ session, signOut: onSignOut ?? (() => {}) }), [session, onSignOut]);
  return (
    <ConfigCtx.Provider value={config}>
      <SessionCtx.Provider value={sess}>
        <LiveConfigProvider value={live}>{children}</LiveConfigProvider>
      </SessionCtx.Provider>
    </ConfigCtx.Provider>
  );
}

export function useSquadConfig(): SquadConfig {
  return useContext(ConfigCtx);
}

/** Reads the host's stub session. */
export function useAuth() {
  return useContext(SessionCtx);
}

/** Adapter: the shell's SquadConfig -> web-live's LiveConfig, so ledger/trip/mastery leave mock mode with the shell. */
export function liveConfigFrom(c: SquadConfig): LiveConfig {
  const live = c.mode === 'live' && !!c.hubUrl && !!c.token;
  return {
    mode: live ? 'live' : c.mode === 'replay' ? 'replay' : 'mock',
    ...(c.hubUrl ? { hubUrl: c.hubUrl.replace(/\/+$/, '') } : {}),
    ...(c.token ? { token: c.token } : {}),
    userId: c.userId ? hubStudentId(c.userId) : 's_ana',
  };
}
