import { useCallback, useEffect, useState } from 'react';
import {
  ImessageStatusSchema,
  agoWords,
  imessageIndicator,
  type ImessageStatus,
} from '@squad/core';
import { timedFetch } from '../../lib/http';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { PHASE_LABEL } from '../../lib/connection-phase';
import { TRUTH_LABELS } from '../../lib/state-labels';
import { Notice } from '../../primitives/Notice';
import { useSquadConfig } from '../../shell/context';

export const RUNBOOK_URL =
  'https://github.com/vaibav03/squad/blob/main/docs/imessage.md#6-manual-verification-runbook-you-with-a-spare-apple-id';

export const SETUP_STEPS = [
  'Use a spare Apple ID and your own chats only. Never test with a third party.',
  'Set IMESSAGE_ALLOWED_CHATS and IMESSAGE_ALLOWED_HANDLES (the allowlist) in .env. Without an allowlist the bridge refuses to start.',
  'Start with IMESSAGE_ENABLED=1 IMESSAGE_DRY_RUN=1. Dry run means messages are parsed and routed but nothing is sent. Check that this card says "iMessage: dry run".',
  'Remove IMESSAGE_DRY_RUN and restart to go live.',
  'Kill switch: unset IMESSAGE_ENABLED (or set it to 0) and restart. Nothing is read or sent.',
] as const;

export interface ImessageCardViewProps {
  status: ImessageStatus | null;
  error?: boolean;
  loading?: boolean;
  now: number;
  onRetry?: () => void;
}

export function ImessageCardView({ status, error, loading, now, onRetry }: ImessageCardViewProps) {
  const ind = status ? imessageIndicator(status, { kind: 'group' }, now) : null;
  const fixture = !!status && (status.fixture || status.mode === 'fixture');
  return (
    <Card className="sq-conn__card" id="messaging" data-testid="connections-imessage">
      <div className="sq-conn__row">
        <h2 className="sq-conn__h">Messaging: iMessage with Sendblue</h2>
        {status && ind ? (
          <Chip tone={!status.enabled ? 'ember' : fixture || status.dryRun ? 'violet' : 'ok'}>
            <span data-testid="messaging-phase">
              {!status.enabled
                ? TRUTH_LABELS.notset.short
                : fixture || status.dryRun
                  ? PHASE_LABEL.demo
                  : PHASE_LABEL.live}
            </span>
          </Chip>
        ) : null}
      </div>
      <p className="sq-conn__meta">
        Text Cubbie from your phone and get answers in the same group chat. Chat always works on the
        web too.
      </p>
      {loading ? (
        <p role="status">Checking messaging</p>
      ) : error || !status || !ind ? (
        <Notice
          tone="warn"
          title="Could not check messaging"
          action={
            onRetry ? (
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        >
          Squad did not answer. Your chat still works on the web.
        </Notice>
      ) : (
        <>
          <p
            className="sq-conn__meta"
            data-testid="connections-imessage-state"
            data-state={ind.state}
          >
            <strong>{status.enabled ? ind.label : 'iMessage: off (kill switch on)'}</strong>
          </p>
          <p className="sq-conn__meta">{ind.detail}</p>
          {fixture ? (
            <p className="sq-conn__meta" data-testid="connections-imessage-fixture">
              Demo data: no real iMessage is sent.
            </p>
          ) : null}
          {status.enabled ? (
            <details className="sq-conn__fallback">
              <summary>Details for whoever runs this</summary>
              <ul className="sq-conn__scopes" aria-label="iMessage bridge details">
                <li>Transport: {status.transport ?? 'unknown'}</li>
                <li>
                  Queued: {status.queued ?? 0}, failed: {status.failed ?? 0}
                </li>
                <li>
                  Last sync: {status.lastSyncAt ? agoWords(status.lastSyncAt, now) : 'no sync yet'}
                </li>
                {(status.squads ?? []).map((s) => (
                  <li key={s.squadId}>
                    {s.name}: {s.bound} group{s.bound === 1 ? '' : 's'} bound
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <details className="sq-conn__fallback">
        <summary>Safe setup, for whoever runs this</summary>
        <ol className="sq-conn__scopes" data-testid="connections-imessage-steps">
          {SETUP_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="sq-conn__meta">
          Full steps are in <code>docs/imessage.md</code>.{' '}
          <a href={RUNBOOK_URL} target="_blank" rel="noreferrer noopener">
            Open the runbook
          </a>
        </p>
      </details>
    </Card>
  );
}

/** Fetches `GET /v1/imessage/status` itself so the Connections view and its tests stay unchanged. */
export function ImessageCard() {
  const cfg = useSquadConfig();
  const [status, setStatus] = useState<ImessageStatus | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async () => {
    if (!cfg.hubUrl) {
      setPhase('error');
      return;
    }
    try {
      const res = await timedFetch(`${cfg.hubUrl}/v1/imessage/status`, {
        headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
      });
      const p = res.ok ? ImessageStatusSchema.safeParse(await res.json().catch(() => null)) : null;
      if (p?.success) {
        setStatus(p.data);
        setPhase('ready');
      } else setPhase('error');
    } catch {
      setPhase('error');
    }
  }, [cfg.hubUrl, cfg.token]);
  useEffect(() => {
    setPhase('loading');
    void load();
  }, [load]);
  useEffect(() => {
    if (window.location.hash === '#imessage' || window.location.hash === '#messaging')
      document.getElementById('messaging')?.scrollIntoView?.();
  }, [phase]);
  return (
    <ImessageCardView
      status={status}
      loading={phase === 'loading'}
      error={phase === 'error'}
      now={Date.now()}
      onRetry={() => {
        setPhase('loading');
        void load();
      }}
    />
  );
}
