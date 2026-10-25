import { useId, type ReactNode } from 'react';
import { useFocusTrap, usePresence, usePrefersReducedMotion } from './hooks';
import './bridge.css';
import './overlay.css';

export interface OverlayFrameProps {
  open: boolean;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  calm?: boolean;
  /** Accessible name source: pass the id of the heading inside, or a plain label. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  /** 'sheet' bottom on phone / centered card on desktop; 'dock' bottom on phone / right dock on desktop. */
  placement?: 'sheet' | 'dock';
  size?: 'sm' | 'md' | 'lg';
  /** Close on scrim click. Default true. */
  dismissOnScrim?: boolean;
  initialFocus?: () => HTMLElement | null | undefined;
  /** Cover the viewport (pages) instead of the nearest positioned ancestor (village stage). */
  fixed?: boolean;
  className?: string;
  children: ReactNode;
}

/** Shared scrim + panel + focus trap + enter/exit presence. Overlay-only; self-contained. */
export function OverlayFrame(props: OverlayFrameProps) {
  const {
    open,
    onClose,
    returnFocusTo,
    calm,
    label,
    labelledBy,
    describedBy,
    placement = 'sheet',
    size = 'md',
    dismissOnScrim = true,
    initialFocus,
    className,
    fixed,
    children,
  } = props;
  const reduced = usePrefersReducedMotion(calm);
  const { mounted, shown, onExited } = usePresence(open, reduced ? 140 : 260);
  const ref = useFocusTrap<HTMLDivElement>({
    active: mounted && open,
    onEscape: onClose,
    returnFocusTo,
    initialFocus,
  });
  const uid = useId();
  if (!mounted) return null;
  return (
    <div
      className="lv-ovl sq-scene"
      data-state={shown && open ? 'open' : 'closed'}
      data-reduced={reduced ? 'true' : undefined}
      data-placement={placement}
      data-fixed={fixed ? 'true' : undefined}
    >
      <div
        className="lv-ovl__scrim"
        onClick={dismissOnScrim ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className={['lv-ovl__panel', className].filter(Boolean).join(' ')}
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        id={uid}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget) onExited();
        }}
      >
        {children}
      </div>
    </div>
  );
}
