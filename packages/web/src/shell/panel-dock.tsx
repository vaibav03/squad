import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type HTMLAttributes,
  type RefObject,
  type ReactNode,
} from 'react';
import './panel-dock.css';

/**
 * The right-side dock of the village page. Every floating panel registers here while it is open:
 *  - 'large' panels (Agent Inspector, room / council / plan / mastery panels, Council board) share the dock region,
 *    so only one is open at a time: opening one asks the others to close (`yield`).
 *  - the chat dock is not large. It folds to its launcher pill while a large panel is open and unfolds after.
 * Geometry lives in panel-dock.css (--sq-dock-* tokens on the world root); this file only decides who is open.
 */
export type PanelSize = 'large' | 'small';

interface Entry {
  size: PanelSize;
  /** Asked to close because another large panel opened (or the chat launcher was pressed). */
  yield: () => void;
}

export interface PanelDockStore {
  /** Registers an open panel. A large one makes every other large panel yield first. */
  open(id: string, size: PanelSize, onYield: () => void): void;
  close(id: string): void;
  /** Id of the large panel that is open, or null. */
  large(): string | null;
  /** How many panels (large or small) are open. */
  count(): number;
  /** Ask every large panel (except `except`) to close. */
  yieldLarge(except?: string): void;
  subscribe(fn: () => void): () => void;
}

export function createPanelDockStore(): PanelDockStore {
  const entries = new Map<string, Entry>();
  const subs = new Set<() => void>();
  let largeId: string | null = null;
  let lastCount = 0;
  const sync = () => {
    const n = entries.size;
    const next = [...entries].filter(([, e]) => e.size === 'large').map(([id]) => id);
    // the newest large panel wins the label
    const id = next.length ? next[next.length - 1]! : null;
    if (id === largeId && n === lastCount) return;
    largeId = id;
    lastCount = n;
    subs.forEach((f) => f());
  };
  const store: PanelDockStore = {
    open(id, size, onYield) {
      // re-registering (a re-render with a new callback) keeps its place and just refreshes the callback
      const known = entries.get(id);
      if (known) {
        known.yield = onYield;
        known.size = size;
        return sync();
      }
      if (size === 'large') store.yieldLarge(id);
      entries.set(id, { size, yield: onYield });
      sync();
    },
    close(id) {
      if (entries.delete(id)) sync();
    },
    large: () => largeId,
    count: () => entries.size,
    yieldLarge(except) {
      for (const [id, e] of [...entries])
        if (e.size === 'large' && id !== except) {
          // it leaves the registry now; its own `open` flag follows when it handles the yield
          entries.delete(id);
          e.yield();
        }
      sync();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
  return store;
}

const Ctx = createContext<PanelDockStore | null>(null);

/** The element that carries the dock tokens and `data-dock-large`. Wraps the village page's `.sq-world`. */
export function PanelDockRoot({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const store = useMemo(() => createPanelDockStore(), []);
  const large = useSyncExternalStore(store.subscribe, store.large, () => null);
  const root = useRef<HTMLDivElement>(null);
  useDockTop(root);
  return (
    <Ctx.Provider value={store}>
      <div
        {...rest}
        ref={root}
        className={['sq-dock-root', className].filter(Boolean).join(' ')}
        data-dock-large={large ?? undefined}
      >
        {children}
      </div>
    </Ctx.Provider>
  );
}

export const usePanelDock = (): PanelDockStore | null => useContext(Ctx);

/**
 * Registers a panel with the dock while `open` is true. `onYield` closes it (a stable or fresh callback both work).
 * Outside a PanelDockRoot (gallery, tests of a single panel) it does nothing, so many panels can show at once there.
 */
export function useDockPanel(id: string, size: PanelSize, open: boolean, onYield: () => void): void {
  const store = useContext(Ctx);
  const cb = useRef(onYield);
  cb.current = onYield;
  useEffect(() => {
    if (!store || !open) return;
    store.open(id, size, () => cb.current());
    return () => store.close(id);
  }, [store, id, size, open]);
}

/** True while a large panel (other than `self`) is open. The chat dock folds on it; in-room launchers hide on it. */
export function useLargePanelOpen(self?: string): boolean {
  const store = useContext(Ctx);
  return useSyncExternalStore(
    (fn) => (store ? store.subscribe(fn) : () => undefined),
    () => {
      const id = store?.large() ?? null;
      return id !== null && id !== self;
    },
    () => false,
  );
}

/**
 * True while any panel is open, the chat panel included. In-room launchers (Ask the council, Council board) use it:
 * they live in the launcher column above the Chat pill, so they step aside while a panel is using the dock.
 */
export function useDockBusy(): boolean {
  const store = useContext(Ctx);
  return useSyncExternalStore(
    (fn) => (store ? store.subscribe(fn) : () => undefined),
    () => (store?.count() ?? 0) > 0,
    () => false,
  );
}

/** The dock starts this far under the HUD (px), never closer than the CSS default of 84px. */
export function dockTopFor(rootTop: number, hudBottoms: number[], gap = 12, min = 84): number {
  if (!hudBottoms.length) return min;
  return Math.max(min, Math.ceil(Math.max(...hudBottoms) - rootTop + gap));
}

/**
 * The village HUD is anchored to the letterboxed stage, so on a tall window it sits lower than the top of the world.
 * Measure it and publish --sq-dock-top on the root so panels always start below it.
 */
function useDockTop(root: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    let last = -1;
    const measure = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      const bottoms = Array.from(
        el.querySelectorAll<HTMLElement>('.sqv-hud .sqv-chips, .sqv-hud .sqv-seg, .sqv-hud .sqv-clock, .sqv-hud .sqv-menu'),
      )
        .map((n) => n.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.bottom);
      const px = dockTopFor(top, bottoms);
      if (px !== last) {
        last = px;
        el.style.setProperty('--sq-dock-top', `${px}px`);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    // the HUD is created after the world boots, and its stage is resized by the game
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [root]);
}
