import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../primitives/Button';
import { Page } from '../../primitives/Page';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { fetchOnboarding, recordSkip } from './api';
import {
  anyConnected,
  isTourStep,
  nextStep,
  prevStep,
  stepLabel,
  TOUR_ROOT,
  type ShareCategory,
  type TourStep,
} from './model';
import { applyShares, ConnectStep, ReviewStep, ShareStep, SkipPanel } from './Steps';
import { useTour } from './useTour';

const COPY: Record<TourStep, { title: string; lede: string; next: string; cta: string }> = {
  connect: {
    title: 'Connect your learning context',
    lede: 'Bring in Canvas and Google Workspace so Squad can answer from your real courses. Read-only, and private to you.',
    next: 'You will check what was imported.',
    cta: 'Continue to review',
  },
  review: {
    title: 'Verify what was imported',
    lede: 'These are the courses, assignments, calendar events and Drive files Squad can now see.',
    next: 'You will choose what your squad can see.',
    cta: 'Looks right, continue',
  },
  share: {
    title: 'Choose what is shared with your squad',
    lede: 'Everything starts Private. Share only what helps your squad plan together.',
    next: 'You open the group chat and ask Squad.',
    cta: 'Open the group chat',
  },
};

const NOTHING: Record<ShareCategory, boolean> = {
  courses: false,
  assignments: false,
  calendar: false,
  drive: false,
};

/** `/squad/welcome-tour/:step?` first-run flow: connect, verify, share, then the group chat. */
export default function OnboardingEntry() {
  const { step } = useParams();
  return isTourStep(step) ? <OnboardingTour step={step} /> : <TourEntry />;
}

/**
 * Bare /squad/welcome-tour (and the old /squad/setup): a returning person who already has a live or demo
 * connection goes straight to the app; everyone else starts at Connect.
 */
function TourEntry() {
  const cfg = useSquadConfig();
  const [to, setTo] = useState<string | null>(
    cfg.mode === 'live' && cfg.hubUrl && cfg.token ? null : `${TOUR_ROOT}/connect`,
  );
  useEffect(() => {
    if (to || !cfg.hubUrl || !cfg.token) return;
    let off = false;
    void fetchOnboarding({ hubUrl: cfg.hubUrl, token: cfg.token, userId: cfg.userId }).then((s) => {
      if (!off) setTo(s.connected ? '/squad' : `${TOUR_ROOT}/connect`);
    });
    return () => {
      off = true;
    };
  }, [to, cfg.hubUrl, cfg.token, cfg.userId]);
  return to ? <Navigate to={to} replace /> : <p role="status">Loading</p>;
}

function OnboardingTour({ step }: { step: TourStep }) {
  const navigate = useNavigate();
  const cfg = useSquadConfig();
  const { setTitle } = useShell();
  const t = useTour();
  const [chosen, setChosen] = useState(NOTHING);
  const [skipping, setSkipping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setTitle('Welcome tour'), [setTitle]);
  // focus moves to the heading on every step change
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-page-title]')?.focus();
    setSkipping(false);
  }, [step]);

  const c = COPY[step];
  const hasData = anyConnected(t.connections);
  const back = prevStep(step);
  const fwd = nextStep(step);

  const skip = async () => {
    if (cfg.hubUrl && cfg.token)
      await recordSkip({ hubUrl: cfg.hubUrl, token: cfg.token, userId: cfg.userId });
    navigate('/squad/chat');
  };
  const primary = async () => {
    if (fwd) return navigate(`${TOUR_ROOT}/${fwd}`);
    setSaving(true);
    const ok = await applyShares(t, chosen);
    setSaving(false);
    if (ok) navigate('/squad/chat');
    else setFailed(true);
  };

  return (
    <div ref={root}>
      <Page title={c.title} eyebrow={stepLabel(step)} lede={c.lede} next={c.next} width="narrow">
        {step === 'connect' ? <ConnectStep t={t} /> : null}
        {step === 'review' ? <ReviewStep t={t} /> : null}
        {step === 'share' ? <ShareStep t={t} chosen={chosen} setChosen={setChosen} /> : null}
        {failed ? (
          <p role="alert">
            Some items could not be shared. Nothing is lost: press the button again, or change
            sharing later in Connections.
          </p>
        ) : null}
        {skipping ? <SkipPanel onSkip={skip} onBack={() => setSkipping(false)} /> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <Button
            variant="ghost"
            onClick={() => (back ? navigate(`${TOUR_ROOT}/${back}`) : navigate('/squad'))}
          >
            Back
          </Button>
          <Button
            variant="primary"
            iconEnd="arrow-right"
            loading={saving}
            disabled={step === 'connect' && !hasData}
            onClick={() => void primary()}
          >
            {c.cta}
          </Button>
          <Button variant="ghost" onClick={() => setSkipping(true)}>
            Skip
          </Button>
        </div>
        {step === 'connect' && !hasData ? (
          <p style={{ marginTop: 8 }}>Connect Canvas or Google above to continue, or skip.</p>
        ) : null}
      </Page>
    </div>
  );
}
