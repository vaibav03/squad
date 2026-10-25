import { useCallback, useMemo, useState } from 'react';
import { useEventFeed, useLiveConfig, type Connection } from '../../overlays/kit';
import {
  parseTripEvent,
  tripReducer,
  TripStateSchema,
  withDerived,
  type TripEvent,
  type TripState,
} from './model';
import { recordedScript, tripOpen } from './fixtures';
import type { TripStatus } from './TripView';

/** Trip page state: snapshot + stream (or the recorded run), with the viewer's own actions layered on top. */
export function useTrip(tripId: string) {
  const cfg = useLiveConfig();
  const mock = cfg.mode !== 'live';
  const [base, setBase] = useState<TripState | undefined>(
    mock ? { ...tripOpen, tripId } : undefined,
  );
  const [status, setStatus] = useState<TripStatus>(mock ? 'ready' : 'loading');
  const [myVote, setMyVote] = useState(false);
  const [myConfirm, setMyConfirm] = useState(false);
  const [submitting, setSubmitting] = useState<'vote' | 'confirm' | null>(null);

  const auth = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
    return h;
  }, [cfg.token]);

  const refresh = useCallback(async () => {
    if (cfg.mode !== 'live' || !cfg.hubUrl) return;
    try {
      const res = await fetch(`${cfg.hubUrl}/v1/trips/${encodeURIComponent(tripId)}`, {
        headers: auth,
      });
      if (!res.ok) throw new Error(String(res.status));
      setBase(withDerived(TripStateSchema.parse(await res.json())));
      setStatus('ready');
    } catch {
      setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
    }
  }, [cfg.mode, cfg.hubUrl, auth, tripId]);

  const script = useMemo(
    () =>
      recordedScript.map((s) => ({
        ...s,
        event:
          s.event.t === 'trip.updated'
            ? { ...s.event, trip: { ...s.event.trip, tripId } }
            : s.event,
      })),
    [tripId],
  );

  const { connection, retry } = useEventFeed<TripEvent>(
    {
      recorded: script,
      live: { parse: (raw) => parseTripEvent(raw), refresh },
    },
    (e) => setBase((prev) => (prev ? tripReducer(prev, e) : prev)),
  );

  const trip = useMemo<TripState | undefined>(() => {
    if (!base) return undefined;
    const members = base.members.map((m) =>
      m.id === cfg.userId && myConfirm ? { ...m, confirmed: true } : m,
    );
    return withDerived({
      ...base,
      members,
      iVoted: base.iVoted || myVote,
      voted: base.iVoted || !myVote ? base.voted : base.voted + 1,
    });
  }, [base, myVote, myConfirm, cfg.userId]);

  const post = useCallback(
    async (path: string, body: unknown) => {
      if (cfg.mode !== 'live' || !cfg.hubUrl) return true;
      const res = await fetch(`${cfg.hubUrl}/v1/trips/${encodeURIComponent(tripId)}/${path}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(body),
      });
      return res.ok;
    },
    [cfg.mode, cfg.hubUrl, auth, tripId],
  );

  const submitVote = useCallback(
    async (ranking: string[]) => {
      setSubmitting('vote');
      try {
        if (await post('vote', { ranking })) setMyVote(true);
      } finally {
        setSubmitting(null);
      }
    },
    [post],
  );
  const confirm = useCallback(
    async (optionId: string, yes: boolean) => {
      setSubmitting('confirm');
      try {
        if ((await post('confirm', { optionId, yes })) && yes) setMyConfirm(true);
      } finally {
        setSubmitting(null);
      }
    },
    [post],
  );

  const conn: Connection = connection;
  return {
    trip,
    status: connection === 'offline' ? ('offline' as const) : status,
    connection: conn,
    submitting,
    submitVote,
    confirm,
    retry: () => {
      setStatus('loading');
      retry();
    },
  };
}
