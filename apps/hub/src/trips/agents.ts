// The hub's view of the mesh agents: are they up, and run the constraints flow on the organizer's agent.
export type AgentHealth = 'online' | 'offline' | 'no_agent';

export interface ConstraintsRequest {
  taskId: string;
  members: string[];
  window: { from: string; to: string };
  squadId: string;
  options: { id: string; label: string; days: number; perPerson: number }[];
}
export type ConstraintsOutcome =
  | {
      status: 'constraints';
      common: string[];
      survivors: string[];
      dropped: { optionId: string; reason: string }[];
    }
  | { status: 'no_plan'; reason: string }
  | { status: 'failed'; reason: string };
export type StartResult =
  | { ok: true; outcome: ConstraintsOutcome }
  | { ok: false; reason: 'offline' | 'timeout' | 'error' };

export interface TripAgents {
  setUrls(urls: Record<string, string>): void;
  hasAny(): boolean;
  health(student: string): Promise<AgentHealth>;
  start(coordinator: string, req: ConstraintsRequest): Promise<StartResult>;
}

export function createTripAgents(o: {
  secret: () => string;
  fetch?: typeof fetch;
  healthTimeoutMs?: number;
  startTimeoutMs?: number;
}): TripAgents {
  let urls: Record<string, string> = {};
  const f = () => o.fetch ?? fetch;
  const base = (s: string) => urls[s]?.replace(/\/+$/, '');
  return {
    setUrls: (u) => void (urls = { ...u }),
    hasAny: () => Object.keys(urls).length > 0,
    async health(student) {
      const url = base(student);
      if (!url) return 'no_agent';
      try {
        const r = await f()(`${url}/healthz`, {
          signal: AbortSignal.timeout(o.healthTimeoutMs ?? 1500),
        });
        return r.ok ? 'online' : 'offline';
      } catch {
        return 'offline';
      }
    },
    async start(coordinator, req) {
      const url = base(coordinator);
      if (!url) return { ok: false, reason: 'offline' };
      try {
        const r = await f()(`${url}/internal/start/trip`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Nook-Internal': o.secret() },
          body: JSON.stringify({ ...req, constraintsOnly: true }),
          signal: AbortSignal.timeout(o.startTimeoutMs ?? 90_000),
        });
        if (!r.ok) return { ok: false, reason: 'error' };
        return { ok: true, outcome: (await r.json()) as ConstraintsOutcome };
      } catch (e) {
        return { ok: false, reason: (e as Error).name === 'TimeoutError' ? 'timeout' : 'offline' };
      }
    },
  };
}
