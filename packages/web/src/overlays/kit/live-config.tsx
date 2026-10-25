import { createContext, useContext, type ReactNode } from 'react';

/**
 * How web-live pages talk to the world. Hosts (or the web-shell adapter at integration) provide
 * it; without a provider every page runs in 'mock' mode on its bundled recorded-replay fixture,
 * so no page ever needs a backend.
 */
export interface LiveConfig {
  /** 'live' = hub + SSE, 'replay' = hub replay script, 'mock' = bundled fixtures, no network. */
  mode: 'live' | 'replay' | 'mock';
  hubUrl?: string;
  token?: string;
  /** The signed-in student; "own" data (own withheld, own limits, own mastery row) is keyed on it. */
  userId: string;
  /** Replay speed multiplier for recorded replays in mock mode (1 = recorded timing). */
  speed?: number;
}

export const defaultLiveConfig: LiveConfig = { mode: 'mock', userId: 's_ana' };

const Ctx = createContext<LiveConfig>(defaultLiveConfig);

export function LiveConfigProvider({
  value,
  children,
}: {
  value: LiveConfig;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLiveConfig(): LiveConfig {
  return useContext(Ctx);
}
