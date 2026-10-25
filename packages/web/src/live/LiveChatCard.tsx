import { useCallback, useEffect, useState } from 'react';
import type { LiveSnapshot } from '@squad/core';
import type { HubCtx } from '../pages/village/hub';
import { LvIcon } from '../overlays/kit/icons';
import { LivePanel } from './LivePanel';
import { liveErrorCopy } from './live-client';
import { groundingLine } from './TakeawaysPanel';
import { useLiveTransport } from './transport';
import './live.css';

type Load = { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ready'; snap: LiveSnapshot };

/** Calm summary of a finished discussion for a chat message with `card.type === 'live'`. */
export function LiveChatCard({
  hub,
  liveId,
  topic,
  calm,
}: {
  hub: HubCtx | null;
  liveId: string;
  topic?: string;
  calm?: boolean;
}) {
  const transport = useLiveTransport(hub);
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoad({ s: 'loading' });
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    let dead = false;
    transport.get(liveId).then(
      (snap) => !dead && setLoad({ s: 'ready', snap }),
      (e) => !dead && setLoad({ s: 'error', msg: liveErrorCopy(e) }),
    );
    return () => {
      dead = true;
    };
  }, [transport, liveId, attempt]);

  if (load.s === 'loading')
    return (
      <div className="ld-card" role="status" aria-busy="true" aria-label="Loading discussion">
        <span className="lv-vh">Loading the discussion summary</span>
        <span className="ld-skel" style={{ width: '60%' }} aria-hidden="true" />
        <span className="ld-skel" style={{ width: '90%' }} aria-hidden="true" />
      </div>
    );
  if (load.s === 'error')
    return (
      <div className="ld-card" data-testid="live-card">
        <p className="ld-small" role="alert">
          <LvIcon name="alert" size={14} /> {load.msg}
        </p>
        <button type="button" className="lv-btn" onClick={retry}>
          Try again
        </button>
      </div>
    );
  const s = load.snap;
  const t = s.takeaways;
  const running = s.status !== 'ended';
  return (
    <article className="ld-card" data-testid="live-card" aria-label="Live discussion summary">
      <div className="ld-row">
        <span className="ld-eyebrow">Live discussion</span>
        <span className="ld-tag">AI-generated discussion</span>
        {s.demo && <span className="ld-tag ld-tag--demo">Demo mode</span>}
        {running && <span className="ld-tag ld-tag--live">Live now</span>}
      </div>
      <h4 className="ld-card__topic">{s.topic || topic}</h4>
      <ul className="ld-card__stats" aria-label="Takeaways">
        <li>
          <b>{t.decisions.length}</b> {t.decisions.length === 1 ? 'decision' : 'decisions'}
        </li>
        <li>
          <b>{t.disagreements.length}</b> open{' '}
          {t.disagreements.length === 1 ? 'disagreement' : 'disagreements'}
        </li>
        <li>
          <b>{t.nextSteps.length}</b> next {t.nextSteps.length === 1 ? 'step' : 'steps'}
        </li>
        <li>
          <b>{t.sources.length}</b> {t.sources.length === 1 ? 'source' : 'sources'}
        </li>
      </ul>
      {t.decisions[0] && <p className="ld-card__line">Decided: {t.decisions[0].text}</p>}
      <p className="ld-ground">
        <LvIcon name={t.grounding === 'course' ? 'shield' : 'info'} size={14} />
        {groundingLine(t)}
      </p>
      <button
        type="button"
        className="lv-btn lv-btn--primary"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Open discussion
      </button>
      {open && (
        <LivePanel
          hub={hub}
          open
          id={liveId}
          topic={s.topic}
          readOnly={!running}
          transport={transport}
          calm={calm}
          onClose={() => setOpen(false)}
        />
      )}
    </article>
  );
}
