import { Link } from 'react-router-dom';
import { bannerChecks } from './model';
import { useHealth } from './useHealth';
import './health.css';

/** Compact strip on Connections and Home: appears only when a probe fails (or a core chain link warns). */
export function HealthBanner({ reloadKey }: { reloadKey?: unknown }) {
  const h = useHealth(reloadKey);
  if (h.state === 'unreachable')
    return (
      <div className="sq-hbanner sq-hbanner--fail" data-testid="health-banner" role="status">
        <strong>Integration health unavailable.</strong>
        <span>The hub's health check did not answer ({h.error}), so the chain is unknown, not healthy.</span>
        <Link to="/squad/connections/health">Open health</Link>
      </div>
    );
  if (h.state !== 'ready' || !h.report) return null;
  const bad = bannerChecks(h.report);
  if (bad.length === 0) return null;
  const fails = bad.filter((c) => c.status === 'fail').length;
  return (
    <div
      className={`sq-hbanner sq-hbanner--${fails ? 'fail' : 'warn'}`}
      data-testid="health-banner"
      role="status"
    >
      <strong>
        {fails ? `${fails} integration link${fails === 1 ? '' : 's'} failing` : 'Integration needs attention'}
      </strong>
      <span>{bad.slice(0, 2).map((c) => c.label).join(', ')}{bad.length > 2 ? ` and ${bad.length - 2} more` : ''}</span>
      <Link to="/squad/connections/health">See health and fixes</Link>
    </div>
  );
}
