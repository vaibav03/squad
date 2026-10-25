export interface MotionPrefs {
  readonly reduced: boolean;
  readonly calm: boolean;
  /** reduced (OS or Lab override) OR calm. Every primitive branches on this. */
  readonly effectiveReduced: boolean;
}

export interface MotionPrefsStore extends MotionPrefs {
  setCalm(on: boolean): void;
  /** null = follow the OS media query. */
  setReducedOverride(v: boolean | null): void;
  subscribe(fn: (p: MotionPrefs) => void): () => void;
  dispose(): void;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function createMotionPrefs(
  opts: {
    storage?: StorageLike | null;
    matchMedia?: ((q: string) => MediaQueryList) | null;
    storageKey?: string;
  } = {},
): MotionPrefsStore {
  const key = opts.storageKey ?? 'squad.motion.calm';
  const storage: StorageLike | null =
    opts.storage !== undefined
      ? opts.storage
      : (() => {
          try {
            return typeof localStorage === 'undefined' ? null : localStorage;
          } catch {
            return null;
          }
        })();
  const mm =
    opts.matchMedia !== undefined
      ? opts.matchMedia
      : typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia.bind(window)
        : null;

  let calm = false;
  try {
    calm = storage?.getItem(key) === '1';
  } catch {
    calm = false;
  }
  let override: boolean | null = null;
  const mql = mm ? mm('(prefers-reduced-motion: reduce)') : null;
  let os = mql?.matches ?? false;
  const listeners = new Set<(p: MotionPrefs) => void>();

  const snapshot = (): MotionPrefs => {
    const reduced = override ?? os;
    return { reduced, calm, effectiveReduced: reduced || calm };
  };
  const emit = (): void => {
    const s = snapshot();
    for (const fn of [...listeners]) fn(s);
  };
  const onOs = (e: { matches: boolean }): void => {
    os = e.matches;
    emit();
  };
  mql?.addEventListener?.('change', onOs);

  return {
    get reduced() {
      return override ?? os;
    },
    get calm() {
      return calm;
    },
    get effectiveReduced() {
      return (override ?? os) || calm;
    },
    setCalm(on) {
      if (calm === on) return;
      calm = on;
      try {
        storage?.setItem(key, on ? '1' : '0');
      } catch {
        /* storage may be blocked; the toggle still works for this session */
      }
      emit();
    },
    setReducedOverride(v) {
      if (override === v) return;
      override = v;
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      mql?.removeEventListener?.('change', onOs);
      listeners.clear();
    },
  };
}

let shared: MotionPrefsStore | null = null;
/** Page-wide singleton so the DOM and the canvas read the same Calm/reduced value. */
export function getMotionPrefs(): MotionPrefsStore {
  shared ??= createMotionPrefs();
  return shared;
}
/** Tests only. */
export function resetMotionPrefsForTests(): void {
  shared?.dispose();
  shared = null;
}

/** A detached prefs store for tests and the Lab (no storage, no media query). */
export function fixedPrefs(reduced: boolean, calm = false): MotionPrefsStore {
  const p = createMotionPrefs({ storage: null, matchMedia: null });
  p.setReducedOverride(reduced);
  p.setCalm(calm);
  return p;
}
