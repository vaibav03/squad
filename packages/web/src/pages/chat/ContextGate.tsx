import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../primitives/Button';
import { LinkButton } from '../../primitives/LinkButton';
import { useSquadConfig } from '../../shell/context';
import {
  fetchOnboarding,
  recordSkip,
  type OnboardingCtx,
  type OnboardingState,
} from '../onboarding/api';
import {
  BANNER_TEXT,
  GATE_TITLE,
  SKIP_EXPLAIN,
  TOUR_PATH,
  gateView,
  type GateView,
} from '../onboarding/gate';

export interface ContextGateState {
  view: GateView;
  state: OnboardingState | null;
  skip: () => Promise<void>;
}

/**
 * Reads the first-run state for the chat surfaces. Without a live hub session (demo/mock mode, tests) it stays
 * `open`: the gate only exists for a signed-in account.
 */
export function useContextGate(enabled = true): ContextGateState {
  const cfg = useSquadConfig();
  const live = enabled && cfg.mode === 'live' && !!cfg.hubUrl && !!cfg.token;
  const ctx = useMemo<OnboardingCtx | null>(
    () => (live ? { hubUrl: cfg.hubUrl!, token: cfg.token!, userId: cfg.userId } : null),
    [live, cfg.hubUrl, cfg.token, cfg.userId],
  );
  const [state, setState] = useState<OnboardingState | null>(null);
  useEffect(() => {
    if (!ctx) return;
    let off = false;
    void fetchOnboarding(ctx).then((s) => !off && setState(s));
    return () => {
      off = true;
    };
  }, [ctx]);
  const skip = useCallback(async () => {
    if (ctx) setState(await recordSkip(ctx));
  }, [ctx]);
  return { view: ctx ? gateView(state) : 'open', state, skip };
}

/** Full-width guided interstitial (compact in the village dock). One primary action; Skip asks first. */
export function ContextGate({
  onSkip,
  compact,
}: {
  onSkip: () => Promise<void>;
  compact?: boolean;
}) {
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus(), [explain]);
  return (
    <section
      className={`sqc-gate${compact ? ' sqc-gate--compact' : ''}`}
      data-testid="context-gate"
      aria-labelledby="sqc-gate-title"
      style={{
        display: 'grid',
        gap: 16,
        alignContent: 'center',
        justifyItems: 'start',
        width: '100%',
        maxWidth: compact ? undefined : 640,
        margin: '0 auto',
        padding: compact ? 16 : '48px 24px',
      }}
    >
      {explain ? (
        <>
          <h2 id="sqc-gate-title" ref={head} tabIndex={-1} style={{ margin: 0 }}>
            Skip connecting for now?
          </h2>
          <p style={{ margin: 0 }} data-testid="gate-skip-explain">
            {SKIP_EXPLAIN}
          </p>
          <p style={{ margin: 0 }}>
            <strong>What happens next:</strong> you go straight to the chat, with a reminder to
            connect.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => setExplain(false)}>
              Go back
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void onSkip().finally(() => setBusy(false));
              }}
            >
              Skip anyway
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 id="sqc-gate-title" ref={head} tabIndex={-1} style={{ margin: 0 }}>
            {GATE_TITLE}
          </h2>
          <p style={{ margin: 0 }}>
            Nook reads your courses, assignments and calendar, read-only, and shares nothing with
            your squad unless you choose.
          </p>
          <p style={{ margin: 0 }}>
            <strong>What happens next:</strong> connect, check what was imported, then choose what
            your squad sees. About two minutes.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <LinkButton to={`${TOUR_PATH}/connect`} variant="primary" iconEnd="arrow-right">
              Connect Canvas + Google
            </LinkButton>
            <Button variant="secondary" onClick={() => setExplain(true)}>
              Skip for now
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** Quiet persistent banner shown after a skip, until something is connected. */
export function ContextBanner() {
  return (
    <div
      role="status"
      data-testid="context-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 12px',
        fontSize: 13,
        borderBottom: '1px solid var(--sq-border, rgba(127,127,127,.3))',
      }}
    >
      <span>{BANNER_TEXT}</span>
      <LinkButton to={`${TOUR_PATH}/connect`} variant="secondary" size="sm">
        Connect
      </LinkButton>
    </div>
  );
}

/** Wraps the chat page: gate, or chat with the banner when skipped. */
export function ContextGateFrame({ children }: { children: ReactNode }) {
  const g = useContextGate();
  if (g.view === 'loading') return null;
  if (g.view === 'gate') return <ContextGate onSkip={g.skip} />;
  return (
    <>
      {g.view === 'banner' ? <ContextBanner /> : null}
      {children}
    </>
  );
}
