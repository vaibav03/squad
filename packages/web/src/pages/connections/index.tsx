import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { Page } from '../../primitives/Page';
import { ConnectionsView } from './ConnectionsView';
import { useConnections } from './useConnections';

/** /squad/connections: Canvas and Google Workspace setup, state, sharing and disconnect. */
export default function ConnectionsRoute() {
  const { setTitle } = useShell();
  const loc = useLocation();
  const cfg = useSquadConfig();
  const s = useConnections();
  useEffect(() => setTitle('Connections'), [setTitle]);
  return (
    <Page title="Connections">
      <ConnectionsView {...s} userId={cfg.userId} now={Date.now()} search={loc.search} />
    </Page>
  );
}
