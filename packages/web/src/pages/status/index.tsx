import { useLocation } from 'react-router-dom';
import { StatusPage } from './StatusView';
import { previewState, useStatus } from './useStatus';

/** /squad/status: operators only. Reads GET /v1/admin/status (admin token, internal secret or a listed admin). */
export default function StatusRoute() {
  const loc = useLocation();
  const s = useStatus(previewState(loc.search));
  return <StatusPage {...s} />;
}
