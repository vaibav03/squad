import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { timedFetch } from '../../lib/http';
import { useEventFeed, useLiveConfig, type Connection } from '../../overlays/kit';
import type { z } from 'zod';
import type {
  TripConfirmBodySchema,
  TripCreateBodySchema,
  TripOptionBodySchema,
  TripOptionEditBodySchema,
} from '@squad/core';
import {
  parseConflict,
  parseCurrent,
  parseTripEnvelope,
  parseTripEvent,
  parseTripView,
  tripReducer,
  type TripConflict,
  type TripEvent,
  type TripViewV2,
} from './model';
import { recordedScript, tripPlanning } from './fixtures';

const POLL_MS = 3000;
export type TripStatus = 'loading' | 'ready' | 'error' | 'offline';
export type TripAction = 'close-voting' | 'retry' | 'continue' | 'reopen' | 'cancel';
export type OptionPatch = Omit<z.infer<typeof TripOptionEditBodySchema>, 'baseRev' | 'replace'>;

/** A lost race the user has to resolve: `resend(rev)` re-sends their change on top of the other member's. */
export interface PendingConflict {
  conflict: TripConflict['conflict'];
  message: string;
  resend: (rev: number) => Promise<void>;
}

/** Trip page state: snapshot + stream (or the recorded run), plus every mutation with conflict handling. */
export function useTrip(tripId?: string) {
  const cfg = useLiveConfig();
  const live = cfg.mode === 'live' && !!cfg.hubUrl;
  const [view, setView] = useState<TripViewV2 | null | undefined>(live ? undefined : tripPlanning);
  const [status, setStatus] = useState<TripStatus>(live ? 'loading' : 'ready');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const headers = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
    return h;
  }, [cfg.token]);

  const base = tripId ? `/v1/trips/${encodeURIComponent(tripId)}` : '/v1/trips/current';

  const netFail = useCallback(() => {
    setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
    setErrorMessage(undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!live) return;
    let res: Response;
    try {
      res = await timedFetch(`${cfg.hubUrl}${base}`, { headers });
    } catch {
      // a blip while a trip is already on screen keeps it (the timer re-reads); only a first load shows the error
      if (viewRef.current === undefined) netFail();
      return;
    }
    try {
      if (res.status === 404) {
        setView(null);
        setNotFound(true);
        setStatus('ready');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const raw: unknown = await res.json();
      if (tripId) {
        const v = parseTripView(raw);
        if (!v) throw new Error('shape');
        setView(v);
      } else {
        const c = parseCurrent(raw);
        if (!c) throw new Error('shape');
        setView(c.trip);
      }
      setNotFound(false);
      setStatus('ready');
    } catch {
      setStatus('error');
      setErrorMessage('Squad answered, but the trip could not be read. Try again.');
    }
  }, [live, cfg.hubUrl, base, headers, tripId, netFail]);

  // The hub streams named SSE events that the shared feed's onmessage never sees, and agents, chat replies and other
  // members change the trip too, so the page also re-reads it every few seconds (quietly: a failed poll keeps what is shown).
  const busyRef = useRef<string | null>(null);
  busyRef.current = busy;
  useEffect(() => {
    if (!live) return;
    const tick = async () => {
      if (
        busyRef.current ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      )
        return;
      try {
        const res = await timedFetch(`${cfg.hubUrl}${base}`, { headers });
        if (!res.ok || busyRef.current) return;
        const raw: unknown = await res.json();
        const v = tripId ? parseTripView(raw) : parseCurrent(raw)?.trip;
        if (v === undefined) return;
        setView((prev) => (JSON.stringify(prev) === JSON.stringify(v) ? prev : v));
      } catch {
        /* keep the last good view */
      }
    };
    const id = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(id);
  }, [live, cfg.hubUrl, base, headers, tripId]);

  const script = useMemo(() => recordedScript, []);
  const { connection, retry } = useEventFeed<TripEvent>(
    { recorded: script, live: { parse: parseTripEvent, refresh } },
    (e) => {
      if (e.t === 'refresh' || e.t === 'trip.confirmed') void refresh();
      else setView((prev) => tripReducer(prev, e));
    },
  );

  /** One mutation. Returns the new view, or undefined after a conflict/error (state already set). */
  const send = useCallback(
    async (
      label: string,
      method: 'POST' | 'PATCH' | 'DELETE',
      path: string,
      body: unknown,
      onConflict?: (c: TripConflict) => void,
    ): Promise<TripViewV2 | undefined> => {
      setBusy(label);
      setActionError(null);
      try {
        let res: Response;
        try {
          res = await timedFetch(`${cfg.hubUrl}${path}`, {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        } catch {
          setActionError('Could not reach Squad. Nothing was changed; try again.');
          return undefined;
        }
        const raw: unknown = await res.json().catch(() => null);
        if (res.ok) {
          const v = parseTripEnvelope(raw);
          if (v) {
            setView(v);
            setConflict(null);
          } else void refresh();
          return v;
        }
        if (res.status === 409) {
          const c = parseConflict(raw);
          if (c) {
            onConflict?.(c);
            return undefined;
          }
        }
        const msg = (raw as { error?: { message?: string } } | null)?.error?.message;
        setActionError(msg ?? 'That did not go through. Try again.');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [cfg.hubUrl, headers, refresh],
  );

  const tid = view?.tripId ?? tripId;
  const tripPath = `/v1/trips/${encodeURIComponent(tid ?? '')}`;

  const local = useCallback((fn: (v: TripViewV2) => TripViewV2) => {
    setView((v) => (v ? fn(v) : v));
  }, []);

  const create = useCallback(
    async (body: z.infer<typeof TripCreateBodySchema>) => {
      if (!live) {
        local((v) => ({ ...v, title: `${body.destination} trip` }));
        return;
      }
      setBusy('create');
      setActionError(null);
      try {
        let res: Response;
        try {
          res = await timedFetch(`${cfg.hubUrl}/v1/trips`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
        } catch {
          setActionError('Could not reach Squad. Nothing was created; try again.');
          return;
        }
        const raw: unknown = await res.json().catch(() => null);
        if (res.ok) {
          const v = parseTripEnvelope(raw);
          if (v) setView(v);
          else await refresh();
          return;
        }
        if (res.status === 409) {
          // Someone started one a moment ago: show theirs instead.
          await refresh();
          return;
        }
        const msg = (raw as { error?: { message?: string } } | null)?.error?.message;
        setActionError(msg ?? 'The trip could not be created. Check the details and try again.');
      } finally {
        setBusy(null);
      }
    },
    [live, cfg.hubUrl, headers, refresh, local],
  );

  const propose = useCallback(
    async (body: z.infer<typeof TripOptionBodySchema>) => {
      if (!live) {
        local((v) => ({
          ...v,
          rev: v.rev + 1,
          options: [
            ...v.options,
            {
              id: `o_${v.options.length + 1}`,
              label: body.label,
              ...(body.days ? { days: body.days } : {}),
              proposedBy: cfg.userId,
              proposedByName: 'You',
              rev: v.rev + 1,
            },
          ],
        }));
        return;
      }
      await send('propose', 'POST', `${tripPath}/options`, body);
    },
    [live, send, tripPath, local, cfg.userId],
  );

  const editOption = useCallback(
    async (optionId: string, patch: OptionPatch, baseRev: number) => {
      if (!live) {
        local((v) => ({
          ...v,
          rev: v.rev + 1,
          options: v.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)),
        }));
        return;
      }
      const path = `${tripPath}/options/${encodeURIComponent(optionId)}`;
      const attempt = (rev: number, replace: boolean) =>
        send(
          'edit',
          'PATCH',
          path,
          { ...patch, baseRev: rev, ...(replace ? { replace: true } : {}) },
          (c) =>
            setConflict({
              conflict: c.conflict,
              message: c.error.message,
              resend: async (r) => void (await attempt(r, true)),
            }),
        );
      await attempt(baseRev, false);
    },
    [live, send, tripPath, local],
  );

  const removeOption = useCallback(
    async (optionId: string, baseRev: number) => {
      if (!live) {
        local((v) => ({
          ...v,
          rev: v.rev + 1,
          options: v.options.filter((o) => o.id !== optionId),
        }));
        return;
      }
      const attempt = (rev: number) =>
        send(
          'remove',
          'DELETE',
          `${tripPath}/options/${encodeURIComponent(optionId)}?baseRev=${rev}`,
          undefined,
          (c) =>
            setConflict({
              conflict: c.conflict,
              message: c.error.message,
              resend: async (r) => void (await attempt(r)),
            }),
        );
      await attempt(baseRev);
    },
    [live, send, tripPath, local],
  );

  const submitVote = useCallback(
    async (ranking: string[], baseRev: number) => {
      if (!live) {
        local((v) => ({ ...v, myVote: ranking, can: { ...v.can, vote: false } }));
        return;
      }
      const attempt = (rev: number) =>
        send('vote', 'POST', `${tripPath}/vote`, { ranking, baseRev: rev }, (c) =>
          setConflict({
            conflict: c.conflict,
            message: c.error.message,
            resend: async (r) => void (await attempt(r)),
          }),
        );
      await attempt(baseRev);
    },
    [live, send, tripPath, local],
  );

  const confirm = useCallback(
    async (optionId: string | undefined, yes: boolean, baseRev?: number) => {
      if (!live) {
        local((v) => ({
          ...v,
          members: v.members.map((m) =>
            m.id === cfg.userId ? { ...m, confirmed: yes, declined: !yes } : m,
          ),
          can: { ...v.can, confirm: false },
        }));
        return;
      }
      const body: z.infer<typeof TripConfirmBodySchema> = {
        yes,
        ...(optionId ? { optionId } : {}),
        ...(baseRev !== undefined ? { baseRev } : {}),
      };
      await send('confirm', 'POST', `${tripPath}/confirm`, body);
    },
    [live, send, tripPath, local, cfg.userId],
  );

  const act = useCallback(
    async (name: TripAction) => {
      if (!live) {
        if (name === 'close-voting')
          local((v) => ({
            ...v,
            status: 'confirming',
            can: { ...v.can, closeVoting: false, confirm: true },
          }));
        if (name === 'reopen') local((v) => ({ ...tripPlanning, tripId: v.tripId }));
        if (name === 'retry' || name === 'continue')
          local((v) => ({
            ...v,
            constraints: { ...v.constraints, state: 'running' as const, waitingFor: [] },
          }));
        if (name === 'cancel')
          local((v) => ({ ...v, status: 'cancelled', can: { ...v.can, cancel: false } }));
        return;
      }
      await send(name, 'POST', `${tripPath}/${name}`, undefined);
    },
    [live, send, tripPath, local],
  );

  const keepTheirs = useCallback(() => {
    setConflict(null);
    void refresh();
  }, [refresh]);
  const replaceWithMine = useCallback(async () => {
    const c = conflict;
    if (!c) return;
    await c.resend(c.conflict.rev);
  }, [conflict]);

  const conn: Connection = connection;
  return {
    view,
    status: connection === 'offline' ? ('offline' as const) : status,
    connection: conn,
    errorMessage,
    notFound,
    busy,
    actionError,
    conflict,
    create,
    propose,
    editOption,
    removeOption,
    submitVote,
    confirm,
    act,
    keepTheirs,
    replaceWithMine,
    retry: () => {
      setStatus('loading');
      retry();
    },
  };
}
