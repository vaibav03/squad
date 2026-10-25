import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Icon } from '../../primitives/Icon';
import type { IconName } from '../../primitives/icon-names';
import { Page, PageSection } from '../../primitives/Page';
import { Skeleton } from '../../primitives/Skeleton';
import { NightScene } from '../../shell/NightScene';
import { useAuth, useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { HOME_CHECKLIST as CHECKLIST, HOME_LINKS } from './fixtures';
import { useSetupChecklist } from './setup-state';
import { HomePlanCard } from './PlanCard';
import './home.css';

export default function HomePage() {
  const { session } = useAuth();
  const { setTitle } = useShell();
  const cfg = useSquadConfig();
  useEffect(() => {
    setTitle('Home');
  }, [setTitle]);
  const name = session?.name ?? 'there';
  const { states, retry, anyError } = useSetupChecklist(cfg);
  const done = CHECKLIST.filter((c) => states[c.key] === 'done').length;
  const loading = CHECKLIST.some((c) => states[c.key] === 'loading');
  const description = loading ? 'Checking…' : `${done} of ${CHECKLIST.length} done`;

  return (
    <Page title={`Good evening, ${name}`} eyebrow="Your squad">
      <section className="sq-home__hero sq-scene" aria-labelledby="hero-title">
        <NightScene className="sq-home__scene" />
        <div className="sq-home__heroinner">
          <p className="sq-home__tag">Tonight</p>
          <h2 id="hero-title" className="sq-home__herotitle">
            Enter the Village
          </h2>
          <p className="sq-home__herolede">
            Your study agents are awake. Walk down to the council hall, pick up a call, or check on
            the group.
          </p>
          <Button as="a" href="/squad/village" variant="primary" size="lg" iconEnd="arrow-right">
            Enter the Village
          </Button>
        </div>
      </section>

      <div className="sq-home__grid">
        <PageSection title="Get set up" description={description}>
          <Card padding="none">
            <ul className="sq-home__list">
              {CHECKLIST.map((c) => {
                const st = states[c.key];
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
                        <span>{c.body}</span>
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
        </PageSection>

        <PageSection title="Study plan">
          <HomePlanCard />
        </PageSection>

        <PageSection title="Around the village">
          <div className="sq-home__links">
            {HOME_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="sq-home__link">
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
        </PageSection>
      </div>
    </Page>
  );
}
