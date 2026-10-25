import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Icon } from '../../primitives/Icon';
import type { IconName } from '../../primitives/icon-names';
import { Page, PageSection } from '../../primitives/Page';
import { Skeleton } from '../../primitives/Skeleton';
import { NightScene } from '../../shell/NightScene';
import { useAuth } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { HOME_CHECKLIST as CHECKLIST, HOME_LINKS } from './fixtures';
import { loadSetupDone } from '../setup/progress';
import './home.css';

export default function HomePage() {
  const { session } = useAuth();
  const { setTitle } = useShell();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTitle('Home');
    const t = setTimeout(() => setReady(true), 120);
    return () => clearTimeout(t);
  }, [setTitle]);
  const name = session?.name ?? 'there';
  const finished = loadSetupDone();
  const HOME_CHECKLIST = CHECKLIST.map((c) => ({ ...c, done: finished.includes(c.key) }));
  const done = HOME_CHECKLIST.filter((c) => c.done).length;

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
        <PageSection title="Get set up" description={`${done} of ${HOME_CHECKLIST.length} done`}>
          {ready ? (
            <Card padding="none">
              <ul className="sq-home__list">
                {HOME_CHECKLIST.map((c) => (
                  <li key={c.key}>
                    <Link to={c.to} className="sq-home__row">
                      <span
                        className={`sq-home__check${c.done ? ' is-done' : ''}`}
                        aria-hidden="true"
                      >
                        {c.done ? <Icon name="check" size={14} /> : null}
                      </span>
                      <span className="sq-home__rowtext">
                        <strong>{c.title}</strong>
                        <span>{c.body}</span>
                      </span>
                      {c.done ? (
                        <span className="sq-home__done">Done</span>
                      ) : (
                        <span className="sq-home__todo">To do</span>
                      )}
                      <Icon name="chevron-right" size={18} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card padding="md">
              <div className="sq-home__skel">
                <Skeleton height={20} />
                <Skeleton height={20} />
                <Skeleton height={20} />
                <Skeleton height={20} />
              </div>
            </Card>
          )}
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
