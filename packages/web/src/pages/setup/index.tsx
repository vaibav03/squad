import { useEffect, useMemo, useRef } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { Icon } from '../../primitives/Icon';
import { LinkButton } from '../../primitives/LinkButton';
import { Notice } from '../../primitives/Notice';
import { Page } from '../../primitives/Page';
import { Skeleton } from '../../primitives/Skeleton';
import { Stepper } from '../../primitives/Stepper';
import { OfflineState } from '../../primitives/EmptyState';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { useHubReady } from '../home/bootstrap';
import { CalendarFile } from './CalendarFile';
import { PhoneLink } from './PhoneLink';
import { isStepId, LEGACY_STEP, nextStep, prevStep, STEPS, type StepId } from './model';
import {
  firstIncomplete,
  STEP_LEDE,
  STEP_ORDER,
  STEP_TITLE,
  type Step,
  type StepStatus,
} from './steps';
import { useSetupSteps } from './use-setup-steps';
import './setup.css';

export const BADGE_TONE: Record<StepStatus, 'neutral' | 'ok' | 'alert' | 'ember'> = {
  loading: 'neutral',
  done: 'ok',
  demo: 'ember',
  working: 'neutral',
  attention: 'alert',
  todo: 'neutral',
  error: 'alert',
};
export const BADGE_ICON: Record<StepStatus, 'check' | 'info' | 'alert' | 'refresh' | 'lock'> = {
  loading: 'refresh',
  done: 'check',
  demo: 'info',
  working: 'refresh',
  attention: 'alert',
  todo: 'lock',
  error: 'alert',
};

/** What happens after this step, in one plain sentence. */
function nextLine(step: StepId, s: Step): string {
  const after = nextStep(step);
  const to =
    after === 'done' ? 'finish and enter the village' : `${STEP_TITLE[after].toLowerCase()}`;
  if (s.status === 'loading') return 'Checking where this stands.';
  if (s.complete) return `This step is done. Continue to ${to}.`;
  return `Use Change source to finish this step, then continue to ${to}.`;
}

export default function SetupPage() {
  const params = useParams();
  const { search, hash } = useLocation();
  const { setTitle } = useShell();
  const cfg = useSquadConfig();
  const live = cfg.mode === 'live' && !!cfg.hubUrl;
  const hubState = useHubReady(live ? cfg.hubUrl : null);
  const ready = hubState.state === 'ready';
  const ctx = useMemo(
    () => ({ hubUrl: ready ? cfg.hubUrl : null, token: ready ? cfg.token : null }),
    [ready, cfg.hubUrl, cfg.token],
  );
  const { steps, loading, retry, reload, anyError } = useSetupSteps(ctx, live && !ready);
  const shell = useRef<HTMLDivElement>(null);
  const param = params.step;
  const done = param === 'done';

  useEffect(() => {
    setTitle('Set up');
  }, [setTitle]);
  // Focus goes to the page heading whenever the step changes.
  useEffect(() => {
    shell.current?.querySelector<HTMLElement>('[data-page-title]')?.focus({ preventScroll: true });
  }, [param]);

  if (param && LEGACY_STEP[param])
    return (
      <Navigate
        to={{
          pathname: `/squad/setup/${LEGACY_STEP[param]}`,
          search: param === 'phone' ? '?phone=1' : search,
          hash,
        }}
        replace
      />
    );
  if (param && !done && !isStepId(param)) return <Navigate to="/squad/setup" replace />;

  const completed = STEP_ORDER.filter((k) => steps[k].complete);
  const rail = (
    <aside className="sq-setup__rail" aria-label="Setup progress">
      <Stepper
        steps={[...STEPS]}
        current={done ? '' : (param as StepId)}
        completed={completed}
        onStepClick={undefined}
        orientation="horizontal"
        className="sq-setup__stepper"
      />
    </aside>
  );

  if (!live)
    return (
      <div ref={shell}>
        <Page
          title="Setup guide"
          eyebrow="Demo data"
          lede="You are viewing demo data, so there is nothing to set up here."
          next="Sign in to a live squad to connect Canvas, Google and messaging."
          className="sq-setup"
        >
          <Notice tone="info" title="Nothing is connected">
            Setup reads your real connections. Open Connections to see what a signed-in account can
            connect.
          </Notice>
          <div className="sq-setup__inline">
            <LinkButton to="/squad/connections" variant="primary">
              Open Connections
            </LinkButton>
          </div>
        </Page>
      </div>
    );

  if (hubState.state === 'offline')
    return (
      <div ref={shell}>
        <Page
          title="Setup guide"
          lede="Your setup is read from your squad's server."
          next="Check your connection, then try again."
          className="sq-setup"
        >
          <OfflineState onRetry={hubState.retry} />
        </Page>
      </div>
    );

  const first = firstIncomplete(steps);
  if (!param) {
    // No step: go to the first one that is not done once the answers are in.
    if (live && (loading || !ready) && !anyError)
      return (
        <Page title="Setup guide" lede="Checking what is already set up." className="sq-setup">
          <Skeleton height={80} />
        </Page>
      );
    return <Navigate to={`/squad/setup/${first ?? 'done'}`} replace />;
  }

  if (done) {
    return (
      <div ref={shell}>
        <Page
          title="You are all set"
          eyebrow="Done"
          lede="Your four setup steps, as Squad sees them right now."
          next="Enter the village, or ask Cubbie in the group chat."
          className="sq-setup"
        >
          {rail}
          <ul className="sq-setup__summary" aria-label="Setup summary">
            {STEP_ORDER.map((k) => (
              <li key={k}>
                <Link to={`/squad/setup/${k}`}>{STEP_TITLE[k]}</Link>
                <Chip tone={BADGE_TONE[steps[k].status]} icon={BADGE_ICON[steps[k].status]}>
                  {steps[k].badge}
                </Chip>
              </li>
            ))}
          </ul>
          <div className="sq-setup__inline">
            <LinkButton to="/squad/village" variant="primary" size="lg" iconEnd="arrow-right">
              Enter the village
            </LinkButton>
          </div>
        </Page>
      </div>
    );
  }

  const step = param as StepId;
  const s = steps[step];
  const idx = STEP_ORDER.indexOf(step);
  const prev = prevStep(step);
  const next = nextStep(step);
  const complete = s.complete;
  const nextTo = `/squad/setup/${next}`;

  return (
    <div ref={shell}>
      <Page
        title={STEP_TITLE[step]}
        eyebrow={`Step ${idx + 1} of ${STEP_ORDER.length}`}
        lede={STEP_LEDE[step]}
        next={nextLine(step, s)}
        className="sq-setup"
      >
        <div className="sq-setup__layout">
          {rail}
          <section className="sq-setup__panel" aria-live="polite" data-testid={`setup-${step}`}>
            <Card padding="md">
              <div className="sq-setup__stack">
                <div className="sq-setup__status">
                  {s.status === 'loading' ? (
                    <Skeleton width={120} height={22} />
                  ) : (
                    <Chip tone={BADGE_TONE[s.status]} icon={BADGE_ICON[s.status]}>
                      {s.badge}
                    </Chip>
                  )}
                  <p className="sq-setup__sentence">{s.summary}</p>
                </div>
                {s.lines.length ? (
                  <ul className="sq-setup__sources" aria-label="Sources">
                    {s.lines.map((l) => (
                      <li key={l.id} data-source={l.id}>
                        <span className="sq-setup__sname">{l.name}</span>
                        <span className="sq-setup__sstate">{l.state}</span>
                        {l.count ? <span className="sq-setup__scount">{l.count}</span> : null}
                        {l.id === 'pdfs' ? (
                          <Link to="/squad/courses" className="sq-setup__slink">
                            Add PDFs in Courses
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {s.missing ? (
                  <details className="sq-setup__details">
                    <summary>Which settings are missing</summary>
                    <p>
                      Add these settings where Squad is deployed:{' '}
                      <code>{s.missing.names.join(', ') || 'the Sendblue settings'}</code>
                    </p>
                  </details>
                ) : null}
                {s.status === 'error' ? (
                  <div>
                    <Button variant="secondary" onClick={retry}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <div className="sq-setup__inline" data-testid="step-actions">
                    <LinkButton to={s.review.to} variant="secondary">
                      {s.review.label}
                    </LinkButton>
                    <LinkButton to={s.change.to} variant={complete ? 'secondary' : 'primary'}>
                      {s.change.label}
                    </LinkButton>
                  </div>
                )}
              </div>
            </Card>

            {step === 'availability' && ctx.hubUrl ? (
              <details className="sq-setup__details">
                <summary>Or import a calendar file instead</summary>
                <CalendarFile hubUrl={ctx.hubUrl} token={ctx.token} onImported={reload} />
              </details>
            ) : null}
            {step === 'messaging' && ctx.hubUrl ? (
              <details className="sq-setup__details" open={search.includes('phone=1')}>
                <summary>Link your phone number</summary>
                <PhoneLink hubUrl={ctx.hubUrl} token={ctx.token} />
              </details>
            ) : null}
          </section>
        </div>

        <div className="sq-setup__bar">
          <div className="sq-setup__barinner">
            {prev ? (
              <Link to={`/squad/setup/${prev}`} className="sq-setup__navlink">
                <Icon name="chevron-left" size={16} /> Back
              </Link>
            ) : (
              <span />
            )}
            {complete ? (
              <LinkButton
                to={nextTo}
                variant="primary"
                iconEnd="arrow-right"
                data-testid="setup-primary"
              >
                {next === 'done' ? 'Finish' : `Next: ${STEP_TITLE[next]}`}
              </LinkButton>
            ) : (
              <Link to={nextTo} className="sq-setup__navlink" data-testid="setup-next">
                {next === 'done' ? 'Next: Finish' : `Next: ${STEP_TITLE[next]}`}{' '}
                <Icon name="chevron-right" size={16} />
              </Link>
            )}
          </div>
        </div>
      </Page>
    </div>
  );
}
