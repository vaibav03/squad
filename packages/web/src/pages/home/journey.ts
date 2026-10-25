import { useCallback, useEffect, useRef, useState } from 'react';
import { arr, getJson, obj, type HubCtx, type ItemState } from './setup-state';

/**
 * The customer journey as ONE ordered list, each step answered by the server (never by a local flag):
 * squad -> connect -> ask -> council -> plan. Home's "Next step" card and the top bar's one-liner both read this.
 */
export type JourneyKey = 'squad' | 'connect' | 'ask' | 'council' | 'plan';
export interface JourneyDef {
  key: JourneyKey;
  /** "connect Google or Canvas": reads after "Next: ". */
  verb: string;
  /** Card title. */
  title: string;
  body: string;
  button: string;
  to: string;
}

export const JOURNEY: readonly JourneyDef[] = [
  {
    key: 'squad',
    verb: 'create or join a squad',
    title: 'Create or join your squad',
    body: 'A squad is the small group you study with.',
    button: 'Create a squad',
    to: '/squad/new',
  },
  {
    key: 'connect',
    verb: 'connect Google or Canvas',
    title: 'Connect Google or Canvas',
    body: 'Squad reads your due dates and calendar so the agents work from your real schedule.',
    button: 'Connect Google or Canvas',
    to: '/squad/connections',
  },
  {
    key: 'ask',
    verb: 'ask Cubbie a question',
    title: 'Ask Cubbie something',
    body: 'Cubbie is your study helper. Ask about an assignment, or send an imported item to Cubbie.',
    button: 'Open the squad chat',
    to: '/squad/chat',
  },
  {
    key: 'council',
    verb: 'ask the council',
    title: 'Ask the council a hard question',
    body: 'Four agents with different views discuss it and give you one answer you can accept or edit.',
    button: 'Go to the council hall',
    to: '/squad/village?panel=council',
  },
  {
    key: 'plan',
    verb: 'plan something with your group',
    title: 'Plan a trip or study plan with your group',
    body: 'Start it from the group chat so everyone sees the same plan card and can vote or accept.',
    button: 'Plan in the group chat',
    to: '/squad/chat?wizard=study',
  },
];

async function connectDone(ctx: HubCtx): Promise<boolean> {
  const conns = arr(obj(await getJson(ctx, '/v1/connections')).connections).map(obj);
  return conns.some(
    (c) =>
      c.mode === 'live' &&
      (c.state ?? c.status) === 'live' &&
      (c.provider === 'google' || c.provider === 'canvas'),
  );
}
async function askDone(ctx: HubCtx): Promise<boolean> {
  const chats = arr(obj(await getJson(ctx, '/v1/chat/chats')).chats)
    .map(obj)
    .slice(0, 4);
  for (const c of chats) {
    const h = obj(
      await getJson(ctx, `/v1/chat/history?chatId=${encodeURIComponent(String(c.id))}&limit=60`),
    );
    if (arr(h.messages).some((m) => obj(obj(m).sender).kind === 'persona')) return true;
  }
  return false;
}
async function councilDone(ctx: HubCtx): Promise<boolean> {
  const runs = arr(obj(await getJson(ctx, '/v1/council/runs?limit=5')).runs).map(obj);
  return runs.some((r) => r.status === 'done');
}
async function planDone(ctx: HubCtx): Promise<boolean> {
  const [p, t] = await Promise.allSettled([
    getJson(ctx, '/v1/plans/current'),
    getJson(ctx, '/v1/trips/current'),
  ]);
  const has = (r: PromiseSettledResult<unknown>, k: string) =>
    r.status === 'fulfilled' && !!obj(r.value)[k];
  if (has(p, 'plan') || has(t, 'trip')) return true;
  if (p.status === 'rejected' && t.status === 'rejected') throw p.reason as Error;
  return false;
}

const READERS: Record<Exclude<JourneyKey, 'squad'>, (c: HubCtx) => Promise<boolean>> = {
  connect: connectDone,
  ask: askDone,
  council: councilDone,
  plan: planDone,
};
const KEYS = Object.keys(READERS) as (keyof typeof READERS)[];

export type JourneyStates = Record<JourneyKey, ItemState>;

export interface Journey {
  states: JourneyStates;
  done: number;
  total: number;
  /** The first step that is not done, or null when all are done or still being checked. */
  next: JourneyDef | null;
  loading: boolean;
  anyError: boolean;
  retry: () => void;
  /** "Next: connect Google or Canvas (1 of 5 done)" or null while loading / when everything is done. */
  line: string | null;
}

export function journeyLine(states: JourneyStates, hasSquad = true): string | null {
  const st = { ...states, squad: hasSquad ? 'done' : 'todo' } as JourneyStates;
  if (JOURNEY.some((j) => st[j.key] === 'loading')) return null;
  const done = JOURNEY.filter((j) => st[j.key] === 'done').length;
  const next = JOURNEY.find((j) => st[j.key] !== 'done');
  if (!next) return `All ${JOURNEY.length} steps done`;
  return `Next: ${next.verb} (${done} of ${JOURNEY.length} done)`;
}

export function useJourney(ctx: HubCtx, waiting = false): Journey {
  const live = !!ctx.hubUrl && !!ctx.token;
  const init = (s: ItemState): JourneyStates => ({
    squad: 'done',
    connect: s,
    ask: s,
    council: s,
    plan: s,
  });
  const [states, setStates] = useState<JourneyStates>(() =>
    init(live || waiting ? 'loading' : 'todo'),
  );
  const gen = useRef(0);
  const { hubUrl, token } = ctx;
  const load = useCallback(
    (keys: readonly (keyof typeof READERS)[]) => {
      if (!hubUrl || !token) return;
      const id = ++gen.current;
      setStates((p) => {
        const n = { ...p };
        for (const k of keys) n[k] = 'loading';
        return n;
      });
      for (const k of keys)
        READERS[k]({ hubUrl, token }).then(
          (ok) => gen.current === id && setStates((p) => ({ ...p, [k]: ok ? 'done' : 'todo' })),
          () => gen.current === id && setStates((p) => ({ ...p, [k]: 'error' })),
        );
    },
    [hubUrl, token],
  );
  useEffect(() => {
    load(KEYS);
  }, [load]);
  const retry = useCallback(() => load(KEYS.filter((k) => states[k] === 'error')), [load, states]);
  const done = JOURNEY.filter((j) => states[j.key] === 'done').length;
  const next = JOURNEY.find((j) => states[j.key] !== 'done' && states[j.key] !== 'loading') ?? null;
  const loading = JOURNEY.some((j) => states[j.key] === 'loading');
  return {
    states,
    done,
    total: JOURNEY.length,
    next: loading ? null : next,
    loading,
    anyError: KEYS.some((k) => states[k] === 'error'),
    retry,
    line: journeyLine(states),
  };
}
