import { useEffect, useState } from 'react';
import { Icon } from '../primitives/Icon';
import { SYSTEM_PILL, TRUTH_LABELS, truthFromStatus, type TruthState } from '../lib/state-labels';
import { timedFetch } from '../lib/http';
import { useSquadConfig } from './context';
import './status-pill.css';

export interface SystemStatus {
  state: TruthState;
  reason?: string;
}

/** Polls GET /v1/status (public) so the pill follows the real answer source. No hub URL: practice data. */
export function useSystemStatus(everyMs = 30000): SystemStatus {
  const { hubUrl } = useSquadConfig();
  const [s, setS] = useState<SystemStatus>({ state: hubUrl ? 'checking' : 'practice' });
  useEffect(() => {
    if (!hubUrl) {
      setS({ state: 'practice' });
      return;
    }
    let dead = false;
    const load = async () => {
      try {
        const res = await timedFetch(`${hubUrl.replace(/\/+$/, '')}/v1/status`);
        if (!res.ok) throw new Error(String(res.status));
        const next = truthFromStatus((await res.json()) as never);
        if (!dead) setS(next);
      } catch {
        if (!dead) setS({ state: 'offline' });
      }
    };
    void load();
    const t = setInterval(load, everyMs);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [hubUrl, everyMs]);
  return s;
}

/** The one system-state pill: icon + words (never a dot alone). Used in the top bar and anywhere the system state shows. */
export function StatusPill({ className }: { className?: string }) {
  const { state, reason } = useSystemStatus();
  const label = TRUTH_LABELS[state];
  const text = reason ? `${SYSTEM_PILL[state]}: ${reason}` : SYSTEM_PILL[state];
  return (
    <span
      className={['sq-pill', className].filter(Boolean).join(' ')}
      data-state={state}
      data-testid="system-status"
      role="status"
      title={reason ? `${label.short}: ${reason}` : label.sentence}
    >
      <Icon name={label.icon} size={14} />
      <span className="sq-pill__text">{text}</span>
    </span>
  );
}
