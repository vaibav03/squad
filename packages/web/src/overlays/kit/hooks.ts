import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** useLayoutEffect that is a no-op on the server (SSR-safe). */
export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** True when the OS asks for reduced motion or the caller forces Calm mode. SSR returns false. */
export function usePrefersReducedMotion(calm = false): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced || calm;
}

export interface Presence {
  /** Keep the node in the tree. */
  mounted: boolean;
  /** Drives `data-state`: false for the first frame (starting style) and while exiting. */
  shown: boolean;
  /** Call from onTransitionEnd / animationend of the panel. */
  onExited: () => void;
}

/**
 * Mount/unmount with an exit transition. Enter: mount, then flip `shown` next frame so the CSS
 * transition from the starting style runs. Exit: flip `shown` false, unmount after `exitMs` (or when
 * the caller reports transitionend). Reduced motion unmounts after the short fade.
 */
export function usePresence(open: boolean, exitMs = 240): Presence {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    timer.current = setTimeout(() => setMounted(false), exitMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, exitMs]);
  const onExited = useCallback(() => {
    if (!open) setMounted(false);
  }, [open]);
  return { mounted, shown, onExited };
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  );
}

export interface FocusTrapOptions {
  active: boolean;
  onEscape?: () => void;
  returnFocusTo?: HTMLElement | null;
  /** Element (or selector inside the panel) to focus first; defaults to the first focusable. */
  initialFocus?: () => HTMLElement | null | undefined;
}

/**
 * Focus trap for an overlay panel: Tab cycles inside, Esc calls onEscape, focus returns to
 * `returnFocusTo` (else the previously focused element) when `active` turns false or on unmount.
 */
export function useFocusTrap<T extends HTMLElement>(opts: FocusTrapOptions) {
  const ref = useRef<T | null>(null);
  const { active, onEscape, returnFocusTo, initialFocus } = opts;
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  const initRef = useRef(initialFocus);
  initRef.current = initialFocus;
  const retRef = useRef(returnFocusTo);
  retRef.current = returnFocusTo;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = initRef.current?.() ?? focusableIn(root)[0] ?? root;
    first.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey && (current === firstEl || !root.contains(current))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (current === lastEl || !root.contains(current))) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    // Focus can fall to <body> while the panel is open (a focused control got disabled or unmounted mid-run); the
    // trap must still answer Esc, and Tab must pull focus back in rather than walk the page behind the panel.
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        escRef.current?.();
        return;
      }
      const a = document.activeElement;
      if (a && a !== document.body && a !== document.documentElement) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        const items = focusableIn(root);
        (e.shiftKey ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onDocKey);
    // Focus that lands outside the panel (nav behind the scrim) is returned to the first control.
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !root.contains(e.target)) {
        (focusableIn(root)[0] ?? root).focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onDocKey);
      const target = retRef.current ?? previous;
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}
