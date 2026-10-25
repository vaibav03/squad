import { useEffect, useState } from 'react';
import { Icon } from '../primitives/Icon';
import { SYSTEM_PILL, TRUTH_LABELS, truthFromStatus, type TruthState } from '../lib/state-labels';
import { timedFetch } from '../lib/http';
import { useSquadConfig } from './context';
import './status-pill.css';

export interface SystemStatus {
  state: TruthState;
  reason?: string;
  /** Everything imported so far is Demo data (no real account connected): the pill must say Demo, not Live. */
  contentDemo?: boolean;
}

/** True when the person has imported content and ALL of it is demo (fixture) data. */
export async function contentIsDemo(hubUrl: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await timedFetch(`${hubUrl.replace(/\/+$/, '')}/v1/connections`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const j = (await res.json()) as { connections?: { mode?: string; status?: string }[] };
    const active = (j.connections ?? []).filter((c) => c.status !== 'revoked');
    return active.length > 0 && active.every((c) => c.mode === 'fixture');
  } catch {
    return false;
  }
}

/** Polls GET /v1/status (public) so the pill follows the real answer source. No hub URL: practice data. */
export function useSystemStatus(everyMs = 30000): SystemStatus {
  const { hubUrl, token } = useSquadConfig();
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
        const contentDemo = await contentIsDemo(hubUrl, token);
        if (!dead) setS({ ...next, contentDemo });
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
  }, [hubUrl, token, everyMs]);
  return s;
}

/** The one system-state pill: icon + words (never a dot alone). Used in the top bar and anywhere the system state shows. */
export function StatusPill({ className }: { className?: string }) {
  const { state, reason, contentDemo } = useSystemStatus();
  const label = TRUTH_LABELS[state];
  // Demo content never reads as Live: the answer source may be live, but what it answers from is example data.
  const demo = !!contentDemo && (state === 'live' || state === 'partial');
  const text = demo
    ? 'Demo data'
    : reason
      ? `${SYSTEM_PILL[state]}: ${reason}`
      : SYSTEM_PILL[state];
  return (
    <span
      className={['sq-pill', className].filter(Boolean).join(' ')}
      data-state={demo ? 'practice' : state}
      data-testid="system-status"
      role="status"
      title={
        demo
          ? 'Demo data: what you imported is example data, not your account.'
          : reason
            ? `${label.short}: ${reason}`
            : label.sentence
      }
    >
      <Icon name={label.icon} size={14} />
      <span className="sq-pill__text">{text}</span>
    </span>
  );
}
