import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import { IconButton } from './IconButton';
import './toast.css';

export type ToastTone = 'info' | 'ok' | 'warn' | 'error';
export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  durationMs?: number;
  action?: { label: string; onAction: () => void };
}
interface ToastItem extends ToastInput {
  id: string;
  tone: ToastTone;
}
interface ToastApi {
  toast: (t: ToastInput) => string;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => '', dismiss: () => {} });
export const useToast = (): ToastApi => useContext(Ctx);

const ICON: Record<ToastTone, IconName> = {
  info: 'info',
  ok: 'check',
  warn: 'alert',
  error: 'alert',
};
const EXIT_MS = 150;
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  const dismiss = useCallback((id: string) => {
    setLeaving(id);
    setTimeout(() => {
      setQueue((q) => q.filter((t) => t.id !== id));
      setLeaving((l) => (l === id ? null : l));
    }, EXIT_MS);
  }, []);
  const toast = useCallback((t: ToastInput) => {
    const id = `t${++seq}`;
    setQueue((q) => [...q, { ...t, id, tone: t.tone ?? 'info' }]);
    return id;
  }, []);
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const current = queue[0];

  return (
    <Ctx.Provider value={api}>
      {children}
      {host
        ? createPortal(
            <div className="sq-toast-region" role="region" aria-label="Notifications">
              {current ? (
                <ToastView
                  key={current.id}
                  item={current}
                  leaving={leaving === current.id}
                  onDismiss={() => dismiss(current.id)}
                  queued={queue.length - 1}
                />
              ) : null}
            </div>,
            host,
          )
        : null}
    </Ctx.Provider>
  );
}

function ToastView({
  item,
  leaving,
  onDismiss,
  queued,
}: {
  item: ToastItem;
  leaving: boolean;
  onDismiss: () => void;
  queued: number;
}) {
  const [paused, setPaused] = useState(false);
  const [entered, setEntered] = useState(false);
  const sticky = item.tone === 'error' && !!item.action;
  const duration = item.durationMs ?? (item.action ? 6000 : 4500);
  const remaining = useRef(duration);
  const startedAt = useRef(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    if (sticky || paused || leaving) return;
    startedAt.current = Date.now();
    const t = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(t);
      remaining.current = Math.max(600, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, sticky, leaving]);
  return (
    <div
      className={`sq-toast sq-toast--${item.tone}`}
      data-state={leaving ? 'leaving' : entered ? 'open' : 'closed'}
      role={item.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="sq-toast__icon">
        <Icon name={ICON[item.tone]} size={16} />
      </span>
      <div className="sq-toast__text">
        <p className="sq-toast__title">{item.title}</p>
        {item.body ? <p className="sq-toast__body">{item.body}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          className="sq-toast__action"
          onClick={() => {
            item.action?.onAction();
            onDismiss();
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <IconButton label="Dismiss notification" icon="x" size="sm" onClick={onDismiss} />
      {queued > 0 ? <span className="sq-sr-only">{queued} more notifications waiting</span> : null}
    </div>
  );
}
