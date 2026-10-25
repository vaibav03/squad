import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { Button } from '../../primitives/Button';
import { LinkButton } from '../../primitives/LinkButton';
import { Page } from '../../primitives/Page';
import { googleNeedsDemo } from '../health/model';
import { useHealth } from '../health/useHealth';
import { ConnectionsView } from './ConnectionsView';
import { ImessageCard } from './ImessageCard';
import { nextStep } from './next-step';
import { useConnections } from './useConnections';

export const CONNECTIONS_LEDE =
  'Connect the places your courses and calendar live so Cubbie answers from your real schedule.';

/** Old anchors keep working: #imessage is the Messaging card. */
const ALIAS: Record<string, string> = { imessage: 'messaging' };

/**
 * /squad/connections: ONE area for Canvas, Google and messaging. The health summary sits at the top (#health),
 * then what was imported (#imported), then one card per connection (#canvas, #google, #messaging).
 */
export default function ConnectionsRoute() {
  const { setTitle } = useShell();
  const loc = useLocation();
  const nav = useNavigate();
  const cfg = useSquadConfig();
  const s = useConnections();
  const reloadKey = s.connections.map((c) => `${c.id}${c.lastSyncAt}${c.state}`).join();
  const health = useHealth(reloadKey);
  useEffect(() => setTitle('Connections'), [setTitle]);

  // Scroll to #canvas, #google, #messaging, #imported or #health once the content is there.
  const ready = s.view !== 'loading' && health.state !== 'loading';
  useEffect(() => {
    const id = loc.hash.replace(/^#/, '');
    if (!id || !ready) return;
    const el = document.getElementById(ALIAS[id] ?? id);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [loc.hash, ready]);

  const step = nextStep(s.view, s.connections);
  const cta = step.cta;
  const actions = cta ? (
    cta.kind === 'route' ? (
      <LinkButton to={cta.to!} variant="primary">
        {cta.label}
      </LinkButton>
    ) : (
      <Button
        variant="primary"
        onClick={() => {
          if (cta.kind === 'retry') void s.reload();
          else {
            nav({ hash: cta.to });
            document.getElementById(cta.to!.slice(1))?.scrollIntoView?.({ behavior: 'smooth' });
          }
        }}
      >
        {cta.label}
      </Button>
    )
  ) : undefined;
  return (
    <Page title="Connections" lede={CONNECTIONS_LEDE} next={step.next} actions={actions}>
      <ConnectionsView
        {...s}
        health={health}
        googleDemoOnly={googleNeedsDemo(health.report)}
        userId={cfg.userId}
        now={Date.now()}
        search={loc.search}
      />
      <ImessageCard />
    </Page>
  );
}
