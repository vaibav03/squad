import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { ChatSummary } from '@squad/core';
import { timedFetch } from '../lib/http';
import { useLiveConfig } from '../overlays/kit';
import { createChatApi } from '../pages/chat/api';
import { parseCurrent, parseTripView } from '../pages/trip/model';
import { Skeleton } from '../primitives/Skeleton';

/** Planning lives in the group chat: `/squad/chat?group=<groupId>&plan=<planId>`. */
export function planChatHref(o: { groupId: string; planId: string; tripId?: string }): string {
  const plan = o.planId || o.tripId || '';
  const q = `group=${encodeURIComponent(o.groupId)}${plan ? `&plan=${encodeURIComponent(plan)}` : ''}`;
  return `/squad/chat?${q}`;
}

type State = { s: 'loading' } | { s: 'done'; groups: ChatSummary[] | null; planId: string | null };

/**
 * Old plan entry points (/squad/trips, /squad/trips/:id, /squad/plan). One group chat and a known plan: redirect
 * into the chat. Anything else: a migration screen with a link per group chat. Never a dead end.
 */
export function PlanRedirect({ tripId: tripIdProp }: { tripId?: string } = {}) {
  const params = useParams();
  const tripId = tripIdProp ?? params.tripId;
  const cfg = useLiveConfig();
  const live = cfg.mode === 'live' && !!cfg.hubUrl && !!cfg.token;
  const [state, setState] = useState<State>(
    live ? { s: 'loading' } : { s: 'done', groups: null, planId: null },
  );

  useEffect(() => {
    if (!live) return;
    let off = false;
    const headers = { Authorization: `Bearer ${cfg.token}` };
    const base = cfg.hubUrl!.replace(/\/+$/, '');
    const loadTrip = async (): Promise<string | null> => {
      try {
        const res = await timedFetch(
          `${base}${tripId ? `/v1/trips/${encodeURIComponent(tripId)}` : '/v1/trips/current'}`,
          { headers },
        );
        if (!res.ok) return null;
        const raw: unknown = await res.json();
        const v = tripId ? parseTripView(raw) : parseCurrent(raw)?.trip;
        return v?.tripId ?? null;
      } catch {
        return null;
      }
    };
    const loadChats = async (): Promise<ChatSummary[] | null> => {
      try {
        const all = await createChatApi({ hubUrl: base, token: cfg.token! }).chats();
        return all.filter((c) => c.kind === 'group');
      } catch {
        return null;
      }
    };
    void Promise.all([loadTrip(), loadChats()]).then(([planId, groups]) => {
      if (!off) setState({ s: 'done', groups, planId });
    });
    return () => {
      off = true;
    };
  }, [live, cfg.hubUrl, cfg.token, tripId]);

  if (state.s === 'loading')
    return (
      <div role="status" aria-live="polite" style={{ padding: 24 }}>
        <p style={{ margin: '0 0 16px' }}>Opening your group chat...</p>
        <Skeleton shape="block" height={120} />
      </div>
    );
  const { groups, planId } = state;
  if (groups && groups.length === 1 && planId)
    return <Navigate replace to={planChatHref({ groupId: groups[0]!.id, planId, tripId })} />;
  return <MigrationScreen groups={groups ?? []} />;
}

function MigrationScreen({ groups }: { groups: ChatSummary[] }) {
  return (
    <section style={{ padding: 24, maxWidth: 560 }} aria-labelledby="plan-moved">
      <h2 id="plan-moved">Plans now live in your group chat</h2>
      <p>
        Trip and study planning happens right in the chat now, where everyone can weigh in. Pick a
        chat to continue.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        {groups.length === 0 ? (
          <Link className="lv-btn" to="/squad/chat">
            Open chat
          </Link>
        ) : (
          groups.map((g) => (
            <Link
              key={g.id}
              className="lv-btn"
              to={`/squad/chat?group=${encodeURIComponent(g.id)}`}
            >
              Open {g.title}
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

/** Default page for /squad/trips and /squad/plan: `?full=1` keeps the full plan view reachable from the card. */
export function usePlanFull(): boolean {
  const [sp] = useSearchParams();
  return sp.get('full') === '1';
}
