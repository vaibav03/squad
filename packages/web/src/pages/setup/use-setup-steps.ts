import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hub, type Connection } from '../connections/api';
import { arr, getJson, obj, type HubCtx } from '../home/setup-state';
import {
  deriveSteps,
  emptyRaw,
  stepsAnyError,
  stepsLoading,
  type SetupRaw,
  type Step,
  type StepKey,
} from './steps';

export interface SetupSteps {
  steps: Record<StepKey, Step>;
  connections: Connection[];
  loading: boolean;
  anyError: boolean;
  retry: () => void;
  /** Quietly re-read everything (after a file import). */
  reload: () => void;
}

type Key = keyof SetupRaw;
const KEYS: Key[] = ['connections', 'pdfs', 'ics', 'messaging', 'me'];

async function readMessaging(ctx: HubCtx) {
  const status = await getJson(ctx, '/v1/imessage/status');
  const bridgeState = obj(obj(status).bridge).state;
  const needSetup =
    obj(status).enabled !== true || bridgeState === 'not_configured' || bridgeState === 'off';
  const [setup, link] = await Promise.allSettled([
    needSetup ? getJson(ctx, '/v1/imessage/setup') : Promise.resolve(null),
    getJson(ctx, '/v1/imessage/link'),
  ]);
  return {
    status,
    setup: setup.status === 'fulfilled' ? setup.value : null,
    linked: link.status === 'fulfilled' ? arr(obj(link.value).links).length : 0,
  };
}

/**
 * The ONE read behind Setup and the Home checklist: the same hub client and phase machine as the Connections page
 * (hub().list + summarizeConnections), plus the other server facts the four steps need. Each read settles on its own.
 */
export function useSetupSteps(ctx: HubCtx, waiting = false): SetupSteps {
  const { hubUrl, token } = ctx;
  const live = !!hubUrl && !!token;
  const [raw, setRaw] = useState<SetupRaw>(() => emptyRaw(live || waiting ? 'loading' : 'error'));
  const gen = useRef<Record<Key, number>>({ connections: 0, pdfs: 0, ics: 0, messaging: 0, me: 0 });
  const rawRef = useRef(raw);
  rawRef.current = raw;

  const load = useCallback(
    (keys: readonly Key[], quiet = false) => {
      if (!hubUrl || !token) {
        for (const k of keys) gen.current[k]++;
        if (!waiting) setRaw(emptyRaw('error'));
        return;
      }
      const c: HubCtx = { hubUrl, token };
      const readers: { [K in Key]: () => Promise<unknown> } = {
        connections: () => hub({ hubUrl: hubUrl.replace(/\/+$/, ''), token }).list(),
        pdfs: async () =>
          arr(obj(await getJson(c, '/v1/library/courses')).courses)
            .map(obj)
            .filter((x) => x.sample !== true && x.status === 'ready').length,
        ics: async () => obj(await getJson(c, '/v1/squad/calendar')).ics === true,
        messaging: () => readMessaging(c),
        me: async () => {
          const r = obj(await getJson(c, '/v1/me'));
          const u = obj(r.user);
          return {
            personaId: typeof u.personaId === 'string' ? u.personaId : '',
            projector: typeof r.projector === 'boolean' ? r.projector : undefined,
          };
        },
      };
      if (!quiet)
        setRaw((p) => {
          const n = { ...p } as Record<Key, unknown>;
          for (const k of keys) n[k] = { s: 'loading' };
          return n as unknown as SetupRaw;
        });
      for (const k of keys) {
        const id = ++gen.current[k];
        readers[k]().then(
          (v) => {
            if (gen.current[k] === id) setRaw((p) => ({ ...p, [k]: { s: 'ok', v } }) as SetupRaw);
          },
          () => {
            if (gen.current[k] === id && !quiet)
              setRaw((p) => ({ ...p, [k]: { s: 'error' } }) as SetupRaw);
          },
        );
      }
    },
    [hubUrl, token, waiting],
  );

  useEffect(() => {
    load(KEYS);
  }, [load]);

  // While a sync runs, poll quietly until it settles (the same behaviour as the Connections page).
  const conns = raw.connections.s === 'ok' ? raw.connections.v : [];
  const syncing = conns.some((c) => c.syncPhase === 'syncing');
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => load(['connections', 'pdfs'], true), 2000);
    return () => clearInterval(t);
  }, [syncing, load]);

  const steps = useMemo(() => deriveSteps(raw), [raw]);
  const retry = useCallback(
    () => load(KEYS.filter((k) => rawRef.current[k].s === 'error')),
    [load],
  );
  const reload = useCallback(() => load(KEYS, true), [load]);
  return {
    steps,
    reload,
    connections: conns,
    loading: stepsLoading(steps),
    anyError: stepsAnyError(steps),
    retry,
  };
}
