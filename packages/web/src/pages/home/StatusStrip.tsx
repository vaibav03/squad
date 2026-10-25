import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { LinkButton } from '../../primitives/LinkButton';
import { Skeleton } from '../../primitives/Skeleton';
import { phaseOf } from '../../lib/connection-phase';
import type { Connection } from '../connections/api';
import { arr, getJson, obj, type HubCtx } from './setup-state';

export interface NowStatus {
  council: { running: boolean; lastAt: number | null; question: string | null } | null;
  plan: { title: string | null; savedAt: number | null } | null;
}

type Load = { s: 'loading' } | { s: 'demo' } | { s: 'offline' } | { s: 'ok'; v: NowStatus };

const num = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

export function parseNow(runs: unknown, plan: unknown): NowStatus {
  const list = arr(obj(runs).runs).map(obj);
  const running = list.some(
    (r) =>
      r.status !== 'done' &&
      r.status !== 'failed' &&
      r.status !== 'error' &&
      r.status !== 'cancelled',
  );
  const lastDone = list.find((r) => r.status === 'done');
  const p = obj(obj(plan).plan);
  const has = Object.keys(p).length > 0;
  return {
    council: list.length
      ? {
          running,
          lastAt: lastDone
            ? (num(lastDone.finishedAt) ??
              num(lastDone.endedAt) ??
              num(lastDone.startedAt) ??
              num(lastDone.createdAt))
            : null,
          question:
            typeof (lastDone ?? list[0])?.question === 'string'
              ? String((lastDone ?? list[0])!.question)
              : null,
        }
      : null,
    plan: has
      ? {
          title: typeof p.title === 'string' ? p.title : null,
          savedAt: num(obj(p.saved).lastEditedAt),
        }
      : null,
  };
}

export function ago(t: number | null, now = Date.now()): string {
  if (!t) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** GET /v1/council/runs and GET /v1/plans/current: what is happening right now, read once and re-read on Retry. */
export function useNowStatus(ctx: HubCtx, waiting: boolean) {
  const [state, setState] = useState<Load>({ s: 'loading' });
  const gen = useRef(0);
  const { hubUrl, token } = ctx;
  const load = useCallback(() => {
    if (!hubUrl || !token) {
      gen.current++;
      setState(waiting ? { s: 'loading' } : { s: 'demo' });
      return;
    }
    const id = ++gen.current;
    setState({ s: 'loading' });
    Promise.allSettled([
      getJson({ hubUrl, token }, '/v1/council/runs?limit=5'),
      getJson({ hubUrl, token }, '/v1/plans/current'),
    ]).then(([r, p]) => {
      if (gen.current !== id) return;
      if (r.status === 'rejected' && p.status === 'rejected') setState({ s: 'offline' });
      else
        setState({
          s: 'ok',
          v: parseNow(
            r.status === 'fulfilled' ? r.value : null,
            p.status === 'fulfilled' ? p.value : null,
          ),
        });
    });
  }, [hubUrl, token, waiting]);
  useEffect(() => {
    load();
  }, [load]);
  return { state, retry: load };
}

/**
 * "What's happening now": three plain facts for a returning customer, in one glance. Each has a recovery button
 * when empty; the whole strip has Try again when the server cannot be reached.
 */
export function StatusStrip({
  ctx,
  waiting,
  connections,
  connectionsLoading,
  offline = false,
  onRetry,
}: {
  ctx: HubCtx;
  waiting: boolean;
  connections: Connection[];
  connectionsLoading: boolean;
  /** The shared bootstrap could not reach the server at all. */
  offline?: boolean;
  onRetry?: () => void;
}) {
  const now = useNowStatus(ctx, waiting);
  const state: Load = offline ? { s: 'offline' } : now.state;
  const retry = offline && onRetry ? onRetry : now.retry;
  const syncing = connections.filter((c) => c.syncPhase === 'syncing').length;
  const attention = connections.filter((c) => ['degraded', 'reauth'].includes(phaseOf(c))).length;
  const lastSync = connections.reduce<number | null>(
    (a, c) => (c.lastSyncAt && (!a || c.lastSyncAt > a) ? c.lastSyncAt : a),
    null,
  );

  return (
    <section className="sq-home__now" aria-labelledby="now-title" data-testid="home-now">
      <h2 id="now-title" className="sq-home__nowtitle">
        What is happening now
      </h2>
      {state.s === 'demo' ? (
        <div className="sq-home__nowoffline">
          <span>You are viewing demo data, so there is no live status to show.</span>
          <LinkButton to="/squad/connections" variant="secondary" size="sm">
            Open Connections
          </LinkButton>
        </div>
      ) : state.s === 'offline' ? (
        <div className="sq-home__nowoffline" role="alert">
          <span>
            <Icon name="alert" size={16} /> We cannot reach your squad right now, so this status may
            be out of date.
          </span>
          <Button variant="secondary" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : state.s === 'loading' || connectionsLoading ? (
        <div role="status" aria-live="polite" className="sq-home__nowgrid">
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
          <span className="sq-home__sr">Checking what is happening...</span>
        </div>
      ) : (
        <ul className="sq-home__nowgrid">
          <li data-testid="now-council">
            <strong>Council</strong>
            {state.v.council?.running ? (
              <span>Running now: the agents are discussing a question.</span>
            ) : state.v.council ? (
              <span>
                Last question answered
                {state.v.council.lastAt ? ` ${ago(state.v.council.lastAt)}` : ''}.
              </span>
            ) : (
              <span>No question asked yet.</span>
            )}
            {state.v.council ? null : (
              <LinkButton to="/squad/village?panel=council" variant="secondary" size="sm">
                Ask the council
              </LinkButton>
            )}
          </li>
          <li data-testid="now-sync">
            <strong>Imports</strong>
            {syncing ? (
              <span>Importing your items now. This can take a minute.</span>
            ) : attention ? (
              <span>A source needs attention.</span>
            ) : connections.length ? (
              <span>Up to date{lastSync ? `, last import ${ago(lastSync)}` : ''}.</span>
            ) : (
              <span>Nothing connected yet.</span>
            )}
            {!syncing && (attention || !connections.length) ? (
              <LinkButton to="/squad/connections" variant="secondary" size="sm">
                {attention ? 'Fix the connection' : 'Connect a source'}
              </LinkButton>
            ) : null}
          </li>
          <li data-testid="now-plan">
            <strong>Plan</strong>
            {state.v.plan ? (
              <span>
                Saved{state.v.plan.title ? `: ${state.v.plan.title}` : ''}
                {state.v.plan.savedAt ? `, ${ago(state.v.plan.savedAt)}` : ''}.
              </span>
            ) : (
              <span>No plan saved yet.</span>
            )}
            {state.v.plan ? null : (
              <LinkButton to="/squad/chat?wizard=study" variant="secondary" size="sm">
                Plan in the group chat
              </LinkButton>
            )}
          </li>
        </ul>
      )}
    </section>
  );
}
