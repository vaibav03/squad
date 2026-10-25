import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OverlayEvent } from '@squad/village';
import {
  createLiveSource,
  loadReplay,
  tripCutsceneFromQuery,
  withTripCutscene,
  type VillageSource,
} from '@squad/village/sources';
import { Button } from '../../primitives/Button';
import { EmptyState } from '../../primitives/EmptyState';
import { WorldLoading } from '../../shell/WorldLoading';
import { SlowNote } from '../../shell/ErrorBoundary';
import { useCalmMode } from '../../hooks/useCalmMode';
import { hubStudentId } from '../../shell/dev-login';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { ChatDock } from '../chat/ChatDock';
import { RoomLayer } from '../../overlays/room-info';
import { MasteryLayer } from '../../overlays/mastery';
import { PlanLayer } from '../../overlays/plan';
import { InspectorPanel } from '../../overlays/inspector';
import { setInspectorStore } from '../../overlays/inspector/bridge';
import { SourceViewerHost } from '../../components/source-viewer';
import { createInspectorStore, type InspectorStore } from '@squad/village/inspector';
import { createCouncilBoardStore } from '@squad/village/council';
import { CouncilHall, CouncilBoardHost, setBoardStore } from '../../council';
import { useToast } from '../../primitives/Toast';
import { sendPhraseToChat } from './chat-send';
import { OverlayHost } from './OverlayHost';
import { DEFAULT_WORLD, loadWorld, type WorldHandle } from './worlds';
import './village.css';

/** Short names for the council replays (`?replay=track4`); the hub serves them by file name. */
const REPLAY_ALIAS: Record<string, string> = {
  track4: 'track4-council-a2a',
  track4b: 'track4b-council-degraded',
  track4c: 'track4c-council-private',
};

/** After this long the loading screen says "Still loading the village..." and offers Retry (it keeps loading). */
export const VILLAGE_SLOW_AFTER_MS = 8000;
/** Hard budget for opening the world (engine chunk, art, first frame). Past it: an error with Retry, never a spinner. */
export const VILLAGE_LOAD_TIMEOUT_MS = 45000;

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
  const [attempt, setAttempt] = useState(0);
  // what the loading screen is waiting for: the engine chunk, then the art and the first frame
  const [phase, setPhase] = useState<'engine' | 'art'>('engine');
  const [slow, setSlow] = useState(false);
  const [event, setEvent] = useState<OverlayEvent | null>(null);
  const [inspector, setInspector] = useState<InspectorStore | null>(null);
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
    setPhase('engine');
    setSlow(false);
    // The world must open, or say why not. Visible at every point: "Opening the village", then (8 s) "Still loading
    // the village..." with Retry while it keeps loading, then (45 s) an error with Retry, never a spinner forever.
    const slowTimer = setTimeout(() => !dead && setSlow(true), VILLAGE_SLOW_AFTER_MS);
    const stall = setTimeout(
      () =>
        !dead &&
        setState((s) =>
          s === 'loading' ? { error: 'The village is taking too long to open.' } : s,
        ),
      VILLAGE_LOAD_TIMEOUT_MS,
    );
    void (async () => {
      try {
        const baseUrl = cfg.hubUrl!.replace(/\/+$/, '');
        const me = cfg.userId ? hubStudentId(cfg.userId) : undefined;
        if (replayName) {
          const r = await loadReplay(REPLAY_ALIAS[replayName] ?? replayName, {
            baseUrl,
            opts: { autoplay: true },
          });
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
        // The inspector store listens to the same filtered stream, from the first event, and drives the panel.
        const store = createInspectorStore({ ...(feed.me ? { me: feed.me } : {}) });
        const offStore = store.attach(feed.source);
        const prevClose = feed.close;
        feed.close = () => {
          offStore();
          prevClose();
        };
        // The council board folds the same stream (a2a.message, council.stage and the legacy council.* events).
        const board = createCouncilBoardStore({
          defaultMode: replayName || !live ? 'demo' : 'live',
        });
        const offBoard = board.attach(feed.source);
        const prevClose2 = feed.close;
        feed.close = () => {
          offBoard();
          prevClose2();
        };
        setBoardStore(board);
        setInspector(store);
        setInspectorStore(store);
        const mount = await loadWorld(worldId);
        if (dead || !stage.current) return feed.close();
        setPhase('art');
        // `?cutscene=trip&task=<id>`: the world plays the cutscene once per task (any key skips it).
        const trip = tripCutsceneFromQuery(location.search);
        const source = trip ? withTripCutscene(feed.source, trip) : feed.source;
        const h = mount({
          parent: stage.current,
          source,
          me: feed.me,
          calm,
          onOverlay: setEvent,
          inspector: store,
          councilBoard: board,
        });
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
      clearTimeout(stall);
      clearTimeout(slowTimer);
      feed?.close();
      handle.current?.destroy();
      handle.current = null;
      setEvent(null);
      setInspector(null);
      setInspectorStore(null);
      setBoardStore(null);
    };
    // calm is applied live through setCalm; the world is not remounted for it.
  }, [cfg.hubUrl, cfg.token, cfg.userId, replayName, worldId, runnable, attempt]);

  // After the room-info panel closes, focus rests on its "?" button, where the world's own Esc/walk keys do not
  // reach. Forward Escape from the room layer's controls to the stage so a keyboard user can still leave the room.
  const onRootKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    const st = stage.current?.querySelector<HTMLElement>('.sqv-stage');
    if (!st || !t.closest('.rr-layer') || t.closest('[role="dialog"]')) return;
    e.preventDefault();
    st.focus({ preventScroll: true });
    st.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
    );
  }, []);

  // The Council Hall opens its own "Ask the council" panel on entry. Mark its room-info panel as already seen so the
  // two never stack on first entry; the info stays one tap away on the room's "?" button.
  useEffect(() => {
    try {
      sessionStorage.setItem('squad:room-info-seen:council-hall', '1');
    } catch {
      /* private mode: the panels may both open once */
    }
  }, []);

  // A room's "say this in chat" button sends the phrase to the squad group chat. Not offered in replays.
  const { toast } = useToast();
  const runPhrase = useMemo(
    () =>
      hub?.token && !replayName
        ? (phrase: string) => {
            void sendPhraseToChat(hub, phrase).then((ok) =>
              toast(
                ok
                  ? { title: 'Sent to the squad chat', body: phrase, tone: 'ok' }
                  : {
                      title: 'Could not send that',
                      body: 'Open Chat and say it there.',
                      tone: 'warn',
                    },
              ),
            );
          }
        : undefined,
    [hub, replayName, toast],
  );

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
    <div className="sq-world" onKeyDown={onRootKeyDown}>
      <div ref={stage} className="sq-world__stage" />
      {state === 'loading' && (
        <div className="sq-world__loading">
          <WorldLoading
            label={phase === 'art' ? 'Loading the village art' : 'Opening the village'}
          />
          {slow && <SlowNote what="the village" onRetry={() => setAttempt((n) => n + 1)} />}
        </div>
      )}
      {typeof state === 'object' && (
        <div className="sq-world__loading sq-world__loading--error" role="alert">
          <EmptyState
            icon="alert"
            tone="error"
            title="The village did not load"
            body={state.error}
            action={
              <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </Button>
            }
          />
        </div>
      )}
      {replayName && (
        <span className="sq-world__badge" aria-label={`Replay ${replayName}`}>
          Replay
        </span>
      )}
      <RoomLayer calm={calm} onRun={runPhrase} />
      <MasteryLayer
        hub={hub}
        calm={calm}
        onRun={runPhrase}
        initialOpen={q.get('mastery') === '1'}
        returnFocusTo={() => stage.current?.querySelector<HTMLElement>('.sqv-stage')}
      />
      <PlanLayer
        hub={hub}
        calm={calm}
        onRun={runPhrase}
        initialOpen={q.get('plan') === '1'}
        returnFocusTo={() => stage.current?.querySelector<HTMLElement>('.sqv-stage')}
      />
      <OverlayHost
        event={event}
        mode={mode}
        hub={hub}
        calm={calm}
        returnFocusTo={stage.current?.querySelector<HTMLElement>('.sqv-stage')}
        onClosed={onClosed}
      />
      {inspector && (
        <InspectorPanel
          store={inspector}
          calm={calm}
          hub={replayName ? null : hub}
          mode={mode}
          returnFocusTo={() => stage.current?.querySelector<HTMLElement>('.sqv-stage')}
        />
      )}
      <SourceViewerHost />
      <ChatDock enabled={live && !replayName} />
      <CouncilBoardHost
        hub={hub}
        replay={!!replayName}
        calm={calm}
        returnFocusTo={stage.current?.querySelector<HTMLElement>('.sqv-stage')}
      />
      <CouncilHall
        hub={hub}
        calm={calm}
        returnFocusTo={stage.current?.querySelector<HTMLElement>('.sqv-stage')}
      />
    </div>
  );
}
