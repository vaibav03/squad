import { Navigate } from 'react-router-dom';

/**
 * Integration health is part of Connections now (the summary card at the top, details collapsed). This route stays only
 * so old links and bookmarks keep working: it replaces itself with /squad/connections#health.
 */
export default function HealthRedirect() {
  return <Navigate to="/squad/connections#health" replace />;
}
