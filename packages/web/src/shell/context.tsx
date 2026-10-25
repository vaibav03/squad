import { createContext, useContext, useMemo, type ReactNode } from 'react';
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
      mode: mode ?? (hubUrl ? 'live' : 'mock'),
    }),
    [hubUrl, session, mode],
  );
  const sess = useMemo(() => ({ session, signOut: onSignOut ?? (() => {}) }), [session, onSignOut]);
  return (
    <ConfigCtx.Provider value={config}>
      <SessionCtx.Provider value={sess}>{children}</SessionCtx.Provider>
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
