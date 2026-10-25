import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../primitives/Icon';
import { useHubReady } from '../pages/home/bootstrap';
import { JOURNEY, useJourney, type Journey } from '../pages/home/journey';
import { useSquadConfig } from './context';
import './journey-line.css';

interface Shared {
  journey: Journey;
  /** The hub answered the shared bootstrap probe (nothing reads it before this). */
  hub: ReturnType<typeof useHubReady>;
  enabled: boolean;
}
const Ctx = createContext<Shared | null>(null);

/** One journey read for the whole shell: Home's Next step card and the top bar line share it (no double fetching). */
export function JourneyProvider({ children }: { children: ReactNode }) {
  const cfg = useSquadConfig();
  const enabled = cfg.mode === 'live' && !!cfg.hubUrl && !!cfg.token;
  const hub = useHubReady(enabled ? cfg.hubUrl : null);
  const ready = hub.state === 'ready';
  const ctx = useMemo(
    () => ({
      hubUrl: ready && enabled ? cfg.hubUrl : null,
      token: ready && enabled ? cfg.token : null,
    }),
    [ready, enabled, cfg.hubUrl, cfg.token],
  );
  const journey = useJourney(ctx, enabled && !ready);
  const value = useMemo(() => ({ journey, hub, enabled }), [journey, hub, enabled]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSharedJourney(): Shared | null {
  return useContext(Ctx);
}

/** The top bar's one line: "Next: connect Google or Canvas (1 of 5 done)", linking to that exact step. */
export function NextStepLine() {
  const s = useSharedJourney();
  if (!s || !s.enabled || s.hub.state !== 'ready' || s.journey.loading) return null;
  const { next, done, total } = s.journey;
  const text = next ? `Next: ${next.verb} (${done} of ${total} done)` : `All ${total} steps done`;
  return (
    <div className="sq-nextline" data-testid="next-step-line">
      {next ? (
        <Link to={next.to} className="sq-nextline__link">
          <Icon name="arrow-right" size={14} />
          <span>{text}</span>
        </Link>
      ) : (
        <span className="sq-nextline__link">
          <Icon name="check" size={14} />
          <span>{text}</span>
        </span>
      )}
    </div>
  );
}

export { JOURNEY };
