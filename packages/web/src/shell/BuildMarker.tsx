import { formatBuiltAt, isStaleBuild, useHubBuild, WEB_BUILD, type HubBuild } from '../lib/build';
import { useLiveConfig } from '../overlays/kit/live-config';

export interface BuildMarkerViewProps {
  webSha: string;
  webBuiltAt?: string;
  hub?: HubBuild;
}

/** The visible build label: web sha and time, the hub's sha, and a warning when they differ (a stale dev server). */
export function BuildMarkerView({ webSha, webBuiltAt, hub }: BuildMarkerViewProps) {
  const stale = isStaleBuild(webSha, hub?.gitSha);
  const built = webBuiltAt ? formatBuiltAt(webBuiltAt) : '';
  return (
    <footer className="sq-build" data-testid="build-marker" aria-label="Build version">
      <span className="sq-build__label">
        web <code>{webSha}</code>
        {built ? <> · built {built}</> : null}
        {hub?.gitSha ? (
          <>
            {' '}
            · hub <code>{hub.gitSha}</code>
            {hub.version ? <> v{hub.version}</> : null}
          </>
        ) : null}
      </span>
      {stale ? (
        <span className="sq-build__stale" role="status">
          Stale build: this page is on <code>{webSha}</code> but the hub runs{' '}
          <code>{hub?.gitSha}</code>. Restart the web dev server, then reload.
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </span>
      ) : null}
    </footer>
  );
}

export function BuildMarker() {
  const cfg = useLiveConfig();
  const hub = useHubBuild(cfg.mode === 'live' ? cfg.hubUrl : undefined);
  return <BuildMarkerView webSha={WEB_BUILD.sha} webBuiltAt={WEB_BUILD.builtAt} hub={hub} />;
}
