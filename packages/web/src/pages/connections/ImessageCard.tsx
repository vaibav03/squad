import { useCallback, useEffect, useState } from 'react';
import {
  FIXTURE_LABEL,
  ImessageStatusSchema,
  agoWords,
  imessageIndicator,
  type ImessageStatus,
} from '@squad/core';
import { timedFetch } from '../../lib/http';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Notice } from '../../primitives/Notice';
import { useSquadConfig } from '../../shell/context';
import { DemoBridge } from './DemoBridge';
import { SendblueSetup, type SendblueSetupInfo } from './SendblueSetup';

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
  /** Sendblue setup facts (names and URLs), when the hub has the provider. */
  sendblue?: SendblueSetupInfo | null;
  /** The demo bridge switch (rendered by the fetching wrapper). */
  demoSlot?: React.ReactNode;
}

export function ImessageCardView({
  status,
  error,
  loading,
  now,
  onRetry,
  sendblue,
  demoSlot,
}: ImessageCardViewProps) {
  const ind = status ? imessageIndicator(status, { kind: 'group' }, now) : null;
  const fixture = !!status && (status.fixture || status.mode === 'fixture');
  return (
    <Card className="sq-conn__card" id="imessage" data-testid="connections-imessage">
      <h3 className="sq-conn__h3">iMessage</h3>
      {loading ? (
        <p role="status">Checking the iMessage bridge</p>
      ) : error || !status || !ind ? (
        <Notice
          tone="warn"
          title="Could not read the iMessage bridge status"
          action={
            onRetry ? (
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : undefined
          }
        >
          This hub did not answer. Messages stay on the web.
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
              {FIXTURE_LABEL}
            </p>
          ) : null}
          {status.enabled ? (
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
          ) : null}
        </>
      )}
      {sendblue ? <SendblueSetup info={sendblue} /> : null}
      {demoSlot}
      <h4 className="sq-conn__h3">Safe setup</h4>
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
    </Card>
  );
}

/** Fetches `GET /v1/imessage/status` itself so the Connections view and its tests stay unchanged. */
export function ImessageCard() {
  const cfg = useSquadConfig();
  const [status, setStatus] = useState<ImessageStatus | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sendblue, setSendblue] = useState<SendblueSetupInfo | null>(null);
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
        // additive: an older hub answers 404 and the Sendblue section simply stays hidden
        void timedFetch(`${cfg.hubUrl}/v1/imessage/setup`, {
          headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
        })
          .then(async (r) => (r.ok ? ((await r.json()) as SendblueSetupInfo) : null))
          .then((j) => setSendblue(j && Array.isArray(j.missingEnv) ? j : null))
          .catch(() => setSendblue(null));
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
    if (window.location.hash === '#imessage')
      document.getElementById('imessage')?.scrollIntoView?.();
  }, [phase]);
  return (
    <ImessageCardView
      status={status}
      loading={phase === 'loading'}
      error={phase === 'error'}
      now={Date.now()}
      sendblue={sendblue}
      demoSlot={<DemoBridge />}
      onRetry={() => {
        setPhase('loading');
        void load();
      }}
    />
  );
}
