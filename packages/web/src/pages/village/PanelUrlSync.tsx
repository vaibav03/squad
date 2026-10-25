import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { usePanelDock } from '../../shell/panel-dock';

/** Dock panel id -> the `?panel=` value that addresses it. Other dock panels (rooms, board, live) are not addressable. */
const PARAM_OF: Record<string, string> = {
  council: 'council',
  plan: 'plan',
  mastery: 'mastery',
  inspector: 'inspector',
};

/**
 * Keeps `?panel=council|plan|mastery|inspector` in step with the village dock, so a panel is a place the browser
 * remembers: opening one adds a history entry, closing it with its own button steps back over that entry, and the
 * browser Back button closes the open panel instead of leaving the village.
 */
export function PanelUrlSync() {
  // tests and the gallery mount the village without a router
  return useInRouterContext() ? <Sync /> : null;
}

function Sync() {
  const store = usePanelDock();
  const loc = useLocation();
  const navigate = useNavigate();
  const large = useSyncExternalStore(
    (fn) => (store ? store.subscribe(fn) : () => undefined),
    () => store?.large() ?? null,
    () => null,
  );
  const param = new URLSearchParams(loc.search).get('panel');
  const pushed = useRef<string | null>(null);
  const prevLarge = useRef<string | null>(large);

  // dock -> URL
  useEffect(() => {
    const was = prevLarge.current;
    prevLarge.current = large;
    const want = large ? (PARAM_OF[large] ?? null) : null;
    if (want && param !== want) {
      const q = new URLSearchParams(loc.search);
      q.set('panel', want);
      navigate({ pathname: loc.pathname, search: `?${q}` }, { replace: pushed.current !== null });
      pushed.current = want;
    } else if (!want && was !== large && param && PARAM_OF[was ?? ''] === param) {
      // the panel closed by itself (its Close button or Escape): remove the entry we added
      if (pushed.current === param) {
        pushed.current = null;
        navigate(-1);
      } else {
        const q = new URLSearchParams(loc.search);
        q.delete('panel');
        const s = q.toString();
        navigate({ pathname: loc.pathname, search: s ? `?${s}` : '' }, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [large]);

  // URL -> dock: Back removed the param while its panel is open, so close the panel
  useEffect(() => {
    if (!store || param) return;
    if (large && PARAM_OF[large]) {
      pushed.current = null;
      store.yieldLarge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  return null;
}
