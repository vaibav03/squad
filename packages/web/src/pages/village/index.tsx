import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OverlayEvent } from '@squad/village';
import {
  createLiveSource,
  loadReplay,
  tripCutsceneFromQuery,
  withTripCutscene,
  type VillageSource,
} from '@squad/village/sources';
import { EmptyState } from '../../primitives/EmptyState';
import { WorldLoading } from '../../shell/WorldLoading';
import { useCalmMode } from '../../hooks/useCalmMode';
import { hubStudentId } from '../../shell/dev-login';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { OverlayHost } from './OverlayHost';
import { DEFAULT_WORLD, loadWorld, type WorldHandle } from './worlds';
import './village.css';

interface Feed {
  source: VillageSource;
  me?: string;
  close(): void;
}

/**
 * World host page. Picks an event source (hub live stream, or a recorded replay with `?replay=<name>`), mounts the
 * registered world (`?world=` or the `world` prop; default the side-view village) and renders the DOM overlays the
 * world asks for through the overlay bridge. It never names a particular world's internals.
 */
export default function VillagePage({ world }: { world?: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const handle = useRef<WorldHandle | null>(null);
  const cfg = useSquadConfig();
  const { setTitle } = useShell();
  const [calm] = useCalmMode();
  const calmRef = useRef(calm);
  calmRef.current = calm;
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  const [event, setEvent] = useState<OverlayEvent | null>(null);
  const q = new URLSearchParams(location.search);
  const replayName = q.get('replay');
  const worldId = world ?? q.get('world') ?? DEFAULT_WORLD;
  const live = cfg.mode === 'live' && !!cfg.hubUrl && !!cfg.token;
  const runnable = !!cfg.hubUrl && (!!replayName || live);
  const mode = replayName || !live ? 'replay' : 'live';
  const hub = useMemo(
    () => (cfg.hubUrl ? { hubUrl: cfg.hubUrl, token: cfg.token } : null),
    [cfg.hubUrl, cfg.token],
  );

  useEffect(() => setTitle('Village'), [setTitle]);
  // Dev/test hook: lets screenshots and Playwright raise an overlay without a world. Not present in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__squadOverlay = setEvent;
    return () => void delete w.__squadOverlay;
  }, []);
  useEffect(() => handle.current?.setCalm?.(calm), [calm]);

  useEffect(() => {
    if (!runnable || !cfg.hubUrl) return;
    let dead = false;
    let feed: Feed | undefined;
    setState('loading');
    void (async () => {
      try {
        const baseUrl = cfg.hubUrl!.replace(/\/+$/, '');
        const me = cfg.userId ? hubStudentId(cfg.userId) : undefined;
        if (replayName) {
          const r = await loadReplay(replayName, { baseUrl, opts: { autoplay: true } });
          feed = { source: r, me: r.cast.me, close: () => r.close() };
        } else {
          const token = cfg.token ?? undefined;
          const l = createLiveSource({ baseUrl, getToken: () => token, ...(me ? { me } : {}) });
          l.start().catch(
            () =>
              !dead && setState({ error: 'The live feed did not start. Check your connection.' }),
          );
          feed = { source: l, me, close: () => l.close() };
        }
        const mount = await loadWorld(worldId);
        if (dead || !stage.current) return feed.close();
        // `?cutscene=trip&task=<id>`: the world plays the cutscene once per task (any key skips it).
        const trip = tripCutsceneFromQuery(location.search);
        const source = trip ? withTripCutscene(feed.source, trip) : feed.source;
        const h = mount({ parent: stage.current, source, me: feed.me, calm, onOverlay: setEvent });
        handle.current = h;
        if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__world = h;
        await h.ready;
        h.setCalm?.(calmRef.current);
        if (!dead) setState('ready');
      } catch {
        feed?.close();
        if (!dead) setState({ error: 'The world could not start. Reload to try again.' });
      }
    })();
    return () => {
      dead = true;
      feed?.close();
      handle.current?.destroy();
      handle.current = null;
      setEvent(null);
    };
    // calm is applied live through setCalm; the world is not remounted for it.
  }, [cfg.hubUrl, cfg.token, cfg.userId, replayName, worldId, runnable]);

  const onClosed = useCallback(() => handle.current?.overlayClosed(), []);

  if (!runnable)
    return (
      <div className="sq-world sq-world--empty">
        <EmptyState
          icon="map"
          title="The village is offline"
          body="Connect to a hub to watch your squad. Sign in with a hub URL, or open a recorded replay."
        />
      </div>
    );
  return (
    <div className="sq-world">
      <div ref={stage} className="sq-world__stage" />
      {state === 'loading' && (
        <div className="sq-world__loading">
          <WorldLoading />
        </div>
      )}
      {typeof state === 'object' && (
        <div className="sq-world__loading sq-world__loading--error" role="alert">
          <EmptyState
            icon="alert"
            tone="error"
            title="The village did not load"
            body={state.error}
          />
        </div>
      )}
      {replayName && (
        <span className="sq-world__badge" aria-label={`Replay ${replayName}`}>
          Replay
        </span>
      )}
      <OverlayHost
        event={event}
        mode={mode}
        hub={hub}
        calm={calm}
        returnFocusTo={stage.current?.querySelector('canvas')}
        onClosed={onClosed}
      />
    </div>
  );
}
