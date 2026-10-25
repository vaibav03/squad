import { useEffect, useState } from 'react';
import { useShell } from '../../shell/shell-context';
import { useParams } from 'react-router-dom';
import { LedgerView } from './LedgerView';
import { useLedger } from './useLedger';
import { roster, TASK_TITLE, TASK_ID } from './fixtures';
import { useLiveConfig } from '../../overlays/kit';

/** /squad/ledger/:taskId? (Glass Box). Live over SSE, recorded replay in mock mode. */
export default function LedgerPage() {
  const { setTitle } = useShell();
  useEffect(() => setTitle('Ledger'), [setTitle]);
  const params = useParams();
  const taskId = params.taskId ?? TASK_ID;
  const cfg = useLiveConfig();
  const { state, status, connection, fresh, retry } = useLedger(taskId);
  const [projector, setProjector] = useState(false);
  return (
    <LedgerView
      status={status}
      connection={connection}
      title={taskId === TASK_ID ? TASK_TITLE : 'Group task'}
      rows={state.rows}
      roster={roster}
      me={cfg.userId}
      projector={projector}
      onProjectorChange={setProjector}
      freshIds={fresh}
      onRetry={retry}
    />
  );
}
