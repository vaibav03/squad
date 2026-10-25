import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface FocusTrapProps {
  active?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Restore focus to the previously focused element on deactivate/unmount. */
  restoreFocus?: boolean;
  className?: string;
  children: ReactNode;
}

export function FocusTrap({
  active = true,
  initialFocusRef,
  restoreFocus = true,
  className,
  children,
}: FocusTrapProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    const target = initialFocusRef?.current ?? items()[0] ?? root;
    target.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (restoreFocus && previous && document.contains(previous))
        previous.focus({ preventScroll: true });
    };
  }, [active, initialFocusRef, restoreFocus]);
  return (
    <div ref={ref} className={className} tabIndex={-1}>
      {children}
    </div>
  );
}
