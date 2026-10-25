import { useState } from 'react';
import type { CouncilStatus } from '@squad/core';
import { ASK_FIXTURE, modeInfo, playCouncilFixture } from '@squad/village/council';
import { openBoard, useBoardStoreRef } from '../../../council/board/bridge';
import { councilErrorCopy } from '../../../council/council-client';
import { useCouncilHub } from '../../../council/last-run/hub';
import { agoWords, useLastRunsState } from '../../../council/last-run/store';
import {
  DEFAULT_CONVENE_QUESTION,
  chooseStartTransport,
  defaultUseLive,
  startCouncilRun,
} from '../../../council/start-run';
import { useCouncilStatus } from '../../../council/status/useCouncilStatus';
import { LvIcon, type LvIconName } from '../../kit';
import { askCubbie } from './askCubbie';

export interface EmptyBadge {
  tier: 'live' | 'partial' | 'example' | 'not-set-up';
  /** 'Live: Gemini' | 'Partly live: <reason>' | 'Example mode: scripted, not Gemini' | 'Not set up: <what>' */
  text: string;
}

/** Honest provider state for an empty tab, from the hub status (null = no hub / replay or fixture). */
export function emptyBadge(
  status: CouncilStatus | null | 'unknown',
  hasHub: boolean,
): EmptyBadge {
  if (!hasHub) return { tier: 'example', text: 'Example mode: scripted, not Gemini' };
  if (status === null || status === 'unknown')
    return { tier: 'not-set-up', text: 'Not set up: the hub did not report its Gemini state' };
  const k = status.key.state;
  if (k === 'no_key') return { tier: 'not-set-up', text: 'Not set up: no Gemini key on the hub' };
  if (k === 'credits_depleted' || k === 'rate_limited')
    return {
      tier: 'partial',
      text: `Partly live: ${k === 'rate_limited' ? 'rate limited' : 'credits depleted'}`,
    };
  return { tier: 'live', text: 'Live: Gemini' };
}

const TIER_ICON: Record<EmptyBadge['tier'], LvIconName> = {
  live: 'check',
  partial: 'alert',
  example: 'info',
  'not-set-up': 'alert',
};

/**
 * Never a dead end: what is empty, the provider state in words, and what to do next. Council agents get 'Start a council'
 * (a real run with a hub, the labelled scripted sample without one) and 'Ask Squad'; others get 'Ask Squad about <topic>'.
 * When a council has run, the persisted last run is named instead of the start prompt.
 */
export function EmptyHelp({
  isCouncil,
  topic,
  title,
  now = Date.now(),
}: {
  isCouncil: boolean;
  topic: string;
  title?: string | undefined;
  now?: number;
}) {
  const hub = useCouncilHub();
  const { status } = useCouncilStatus(hub);
  const stored = useLastRunsState();
  const board = useBoardStoreRef();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const badge = emptyBadge(status, !!hub);
  const last = stored.runs[0];

  const start = async () => {
    setErr(null);
    if (!hub) {
      if (board) playCouncilFixture(ASK_FIXTURE, (e) => board.apply(e), { instant: true });
      return;
    }
    setBusy(true);
    try {
      await startCouncilRun({
        hub,
        question: DEFAULT_CONVENE_QUESTION,
        transport: chooseStartTransport(status, defaultUseLive(status)),
      });
      openBoard();
    } catch (e) {
      setErr(councilErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="af-help" data-testid="af-help">
      {title ? <p className="af-empty__title">{title}</p> : null}
      <p className="af-help__badge" data-tier={badge.tier} data-testid="af-help-badge">
        <LvIcon name={TIER_ICON[badge.tier]} size={14} aria-hidden="true" />
        <span>{badge.text}</span>
      </p>
      <p className="af-dim af-meta" data-testid="af-meta">
        {last ? (
          <>
            <span className="af-k">Updated</span>{' '}
            <time dateTime={new Date(last.startedAt).toISOString()} title={new Date(last.startedAt).toLocaleString()}>
              {agoWords(last.startedAt, now)}
            </time>
            {' · '}
            <span className="af-k">Source</span> {last.transport?.kind === 'demo' ? 'scripted example' : 'Gemini council run'}
            {' · '}
            <span className="af-k">Mode</span> {modeInfo(last.mode).word}
          </>
        ) : (
          <>
            <span className="af-k">As of</span>{' '}
            <time dateTime={new Date(now).toISOString()} title={new Date(now).toLocaleString()}>
              {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </time>
            {' · '}
            <span className="af-k">Source</span> {hub ? 'council runs on your hub' : 'built-in example'}
            {' · '}
            <span className="af-k">Mode</span> {badge.text.split(':')[0]}
          </>
        )}
      </p>
      {isCouncil ? (
        last ? (
          <p className="af-dim" data-testid="af-last-run">
            Last council: {agoWords(last.startedAt, now)}, {modeInfo(last.mode).word}
          </p>
        ) : (
          <p className="af-dim" data-testid="af-no-run">
            No council has run yet
            {hub ? '.' : '. Without a hub this plays a scripted sample, labelled as an example.'}
          </p>
        )
      ) : (
        <p className="af-dim">
          Nothing to show here yet. Ask Squad about {topic} and it fills in as the agents work.
        </p>
      )}
      <div className="af-help__actions">
        {isCouncil ? (
          <>
            <button
              type="button"
              className="lv-btn lv-btn--primary"
              data-testid="af-start-council"
              disabled={busy}
              onClick={() => void start()}
            >
              {busy ? 'Starting...' : 'Start a council'}
            </button>
            <button
              type="button"
              className="lv-btn lv-btn--ghost"
              data-testid="af-ask-cubbie"
              onClick={() => askCubbie()}
            >
              Ask Squad
            </button>
          </>
        ) : (
          <button
            type="button"
            className="lv-btn lv-btn--primary"
            data-testid="af-ask-cubbie"
            onClick={() => askCubbie()}
          >
            Ask Squad about {topic}
          </button>
        )}
      </div>
      {err ? (
        <p className="af-err" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
