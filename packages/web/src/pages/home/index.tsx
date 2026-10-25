import { Link } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { Button } from '../../primitives/Button';
import { LinkButton } from '../../primitives/LinkButton';
import { Card } from '../../primitives/Card';
import { Icon } from '../../primitives/Icon';
import type { IconName } from '../../primitives/icon-names';
import { Page, PageSection } from '../../primitives/Page';
import { Skeleton } from '../../primitives/Skeleton';
import { HomeHero } from './HomeHero';
import { JourneyProvider, useSharedJourney } from '../../shell/journey-context';
import { JOURNEY } from './journey';
import { bridgeNote, usePhoneBridge } from './phone-state';
import { useAuth, useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { HOME_CHECKLIST as CHECKLIST } from './fixtures';
import { resolveHomeLinks, useCurrentTrip } from './home-links';
import { useHubReady } from './bootstrap';
import { OfflineState } from '../../primitives/EmptyState';
import { useSetupChecklist } from './setup-state';
import { HomePlanCard } from './PlanCard';
import { HealthBanner } from '../health/HealthBanner';
import './home.css';

/** Home owns a journey provider only when it renders outside the shell (tests, stories). */
export default function HomePage() {
  const shared = useSharedJourney();
  return shared ? (
    <HomeBody />
  ) : (
    <JourneyProvider>
      <HomeBody />
    </JourneyProvider>
  );
}

function HomeBody() {
  const { session } = useAuth();
  const { setTitle } = useShell();
  const cfg = useSquadConfig();
  useEffect(() => {
    setTitle('Home');
  }, [setTitle]);
  const name = session?.name ?? 'there';
  const live = cfg.mode === 'live' && !!cfg.hubUrl;
  const hub = useHubReady(live ? cfg.hubUrl : null);
  const ready = hub.state === 'ready';
  // Nothing below reads the hub until the shared bootstrap says it is reachable (no false OFFLINE on a cold load).
  const gated = useMemo(
    () => ({ hubUrl: ready ? cfg.hubUrl : null, token: ready ? cfg.token : null }),
    [ready, cfg.hubUrl, cfg.token],
  );
  const { states, retry, anyError } = useSetupChecklist(gated, live && !ready);
  const bridge = usePhoneBridge(gated);
  const journey = useSharedJourney()!.journey;
  const trip = useCurrentTrip(cfg.hubUrl, cfg.token, live && ready);
  const links = resolveHomeLinks(trip);
  const done = CHECKLIST.filter((c) => states[c.key] === 'done').length;
  const loading = CHECKLIST.some((c) => states[c.key] === 'loading');
  const description = loading ? 'Checking…' : `${done} of ${CHECKLIST.length} done`;
  const started = journey.done > 1 || done > 0; // the squad step is always done, so >1 means a real step is done
  const next = journey.next;

  return (
    <Page
      title={`Good evening, ${name}`}
      eyebrow="Your squad"
      lede="Squad turns your courses and calendar into answers, plans and trips your whole group can use."
      next={
        journey.loading
          ? 'Checking where you left off.'
          : next
            ? `${next.title}. It takes about a minute.`
            : 'Everything is set up. Ask the council or plan something in the group chat.'
      }
    >
      {live && ready ? <HealthBanner /> : null}
      <section
        className="sq-home__nextcard"
        aria-labelledby="next-title"
        data-testid="home-next-step"
      >
        <Card padding="md">
          <div className="sq-home__next">
            <h2 id="next-title" className="sq-home__nexttitle">
              {journey.loading ? 'Checking your progress' : next ? next.title : 'You are all set'}
            </h2>
            <p className="sq-home__nextbody">
              {next
                ? next.body
                : 'Ask the council a question, or open the Plans drawer in your group chat.'}
            </p>
            {journey.loading ? (
              <Skeleton height={40} width={220} />
            ) : (
              <div>
                <LinkButton
                  to={next ? next.to : '/squad/village?panel=council'}
                  variant="primary"
                  size="lg"
                  iconEnd="arrow-right"
                  data-testid="primary-cta"
                >
                  {next ? `Continue: ${next.verb}` : 'Ask the council'}
                </LinkButton>
              </div>
            )}
            <ol className="sq-home__steps" aria-label="Your steps">
              {JOURNEY.map((j) => (
                <li key={j.key} data-state={journey.states[j.key]}>
                  {journey.states[j.key] === 'done' ? <Icon name="check" size={12} /> : null}
                  {j.title}
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </section>

      <div className="sq-home__grid">
        <PageSection
          title="Set up your agents"
          description={hub.state === 'ready' ? description : undefined}
        >
          {hub.state === 'connecting' ? (
            <Card padding="md">
              <div className="sq-home__connecting" role="status" aria-live="polite">
                <p>Connecting to Squad...</p>
                <Skeleton height={20} />
                <Skeleton height={20} />
              </div>
            </Card>
          ) : hub.state === 'offline' ? (
            <Card padding="md">
              <OfflineState onRetry={hub.retry} />
            </Card>
          ) : (
            <Card padding="none">
              <ul className="sq-home__list">
                {CHECKLIST.map((c) => {
                  const st = states[c.key];
                  const note = c.key === 'phone' ? bridgeNote(bridge, st === 'done') : c.body;
                  return (
                    <li key={c.key} data-state={st}>
                      <Link to={c.to} className="sq-home__row">
                        <span
                          className={`sq-home__check${st === 'done' ? ' is-done' : ''}`}
                          aria-hidden="true"
                        >
                          {st === 'done' ? <Icon name="check" size={14} /> : null}
                        </span>
                        <span className="sq-home__rowtext">
                          <strong>{c.title}</strong>
                          <span>{note}</span>
                        </span>
                        {st === 'done' ? (
                          <span className="sq-home__done">Done</span>
                        ) : st === 'todo' ? (
                          <span className="sq-home__todo">To do</span>
                        ) : st === 'error' ? (
                          <span className="sq-home__todo">Could not check</span>
                        ) : (
                          <span className="sq-home__checking" role="status">
                            <Skeleton width={56} height={18} />
                            <span className="sq-home__sr">Checking…</span>
                          </span>
                        )}
                        <Icon name="chevron-right" size={18} />
                      </Link>
                      {c.alt && st !== 'done' ? (
                        <Link to={c.alt.to} className="sq-home__alt">
                          {c.alt.label}
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {anyError ? (
                <div className="sq-home__retry" role="alert">
                  <span>Some setup steps could not be checked.</span>
                  <Button variant="secondary" size="sm" onClick={retry}>
                    Retry
                  </Button>
                </div>
              ) : null}
            </Card>
          )}
        </PageSection>

        <PageSection title="Study plan">
          <HomePlanCard primary={false} />
        </PageSection>
      </div>

      <HomeHero />

      <PageSection title={started ? 'Around the village' : 'Explore later'}>
        <details className="sq-home__explore" open={started}>
          <summary>{started ? 'Show shortcuts' : 'Shortcuts, once you have started'}</summary>
          <div className="sq-home__links">
            {links.map((l) => (
              <Link key={l.title} to={l.to} className="sq-home__link">
                <span className="sq-home__linkicon">
                  <Icon name={l.icon as IconName} size={20} />
                </span>
                <span className="sq-home__linktext">
                  <strong>{l.title}</strong>
                  <span>{l.body}</span>
                </span>
                <Icon name="chevron-right" size={18} />
              </Link>
            ))}
          </div>
        </details>
      </PageSection>
    </Page>
  );
}
