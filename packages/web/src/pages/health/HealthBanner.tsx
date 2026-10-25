import { Link } from 'react-router-dom';
import { bannerChecks, customerChecks, customerGroups } from './model';
import { useHealth } from './useHealth';
import './health.css';

/** Compact strip on Connections and Home: appears only when a probe fails (or a core chain link warns). */
export function HealthBanner({ reloadKey }: { reloadKey?: unknown }) {
  const h = useHealth(reloadKey);
  if (h.state === 'unreachable')
    return (
      <div className="sq-hbanner sq-hbanner--fail" data-testid="health-banner" role="status">
        <strong>Connection check unavailable.</strong>
        <span>
          Squad could not check your connections just now, so they are unknown, not healthy.
        </span>
        <Link to="/squad/connections#health">Open connections</Link>
      </div>
    );
  if (h.state !== 'ready' || !h.report) return null;
  const bad = bannerChecks(h.report);
  if (bad.length === 0) return null;
  const report = h.report;
  const names = customerGroups(report)
    .filter((g) => g.needsAttention && bad.some((b) => customerChecks(report, g.id).includes(b)))
    .map((g) => g.title);
  const fails = bad.filter((c) => c.status === 'fail').length;
  return (
    <div
      className={`sq-hbanner sq-hbanner--${fails ? 'fail' : 'warn'}`}
      data-testid="health-banner"
      role="status"
    >
      <strong>
        {fails
          ? `${fails} connection problem${fails === 1 ? '' : 's'}`
          : 'A connection needs attention'}
      </strong>
      <span>{names.length ? names.join(', ') : 'Your connections'}</span>
      <Link to="/squad/connections#health">See what to fix</Link>
    </div>
  );
}
