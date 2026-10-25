import type { Citation, VillageEvent } from '@squad/core';
import { agentName, chapterName, shortCaption, studentName } from '../adapter/labels';
import { agentKind, eventWords, redact } from './describe';

/**
 * How agents talk, in plain words. Agents do not hold free-form chats with each other: they coordinate
 * through typed events (council members answer in parallel, rank each other anonymously, a chair concludes;
 * per-student agents trade only masked results through the mediator). This module turns those events into
 * readable exchanges, using only text the per-viewer filtered stream already carries.
 */

export type ExchangeKind =
  | 'council'
  | 'rank'
  | 'verdict'
  | 'mesh'
  | 'privacy'
  | 'quiz'
  | 'call'
  | 'confirm'
  | 'trip'
  | 'discussion'
  | 'other';

export interface Party {
  /** Agent id you can select, or 'commons' / 'everyone' (not selectable). */
  readonly id: string;
  readonly label: string;
}
export interface Exchange {
  readonly seq: number;
  readonly at: number;
  readonly kind: ExchangeKind;
  readonly from: Party;
  readonly to: Party;
  readonly text: string;
  /** Every agent whose inspector shows this exchange. */
  readonly parts: readonly string[];
  /** True when it concerns the viewer (their own call, confirm, quiz, council question). */
  readonly mine: boolean;
  readonly dissent?: boolean;
  readonly alert?: boolean;
  readonly cite?: Citation;
}

export interface ExchangeCtx {
  readonly me?: string;
  readonly mine: boolean;
}
/** A mapper for an event family (e.g. 'discussion.') that is not in the core union yet. Returns zero or more exchanges. */
export type ExchangeMapper = (
  raw: Record<string, unknown>,
  ctx: ExchangeCtx,
) => Omit<Exchange, 'seq'>[];

const COMMONS: Party = { id: 'commons', label: 'the campfire' };
const EVERYONE: Party = { id: 'everyone', label: 'everyone' };
export const isSelectable = (p: Party): boolean => p.id !== 'commons' && p.id !== 'everyone';

const party = (id: string, me?: string): Party => ({
  id,
  label: me && id === `student:${me}` ? 'You' : agentName(id),
});
const safeText = (t: string, mine: boolean): string => (mine ? t : redact(t));
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const mappers = new Map<string, ExchangeMapper>();
/** Plug a new event family in without touching this file's switch (the Live Discussion feature uses 'discussion.'). */
export function registerExchangeMapper(prefix: string, fn: ExchangeMapper): void {
  mappers.set(prefix, fn);
}
export function mapperFor(t: string): ExchangeMapper | undefined {
  for (const [prefix, fn] of mappers) if (t.startsWith(prefix)) return fn;
  return undefined;
}

/**
 * Default mapper for `discussion.*`: reads the obvious fields (from, to, text|message, speaker) defensively.
 * Anything it cannot read becomes no exchange (never a guess).
 */
registerExchangeMapper('discussion.', (raw, ctx) => {
  const str = (k: string): string | undefined =>
    typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : undefined;
  const from = str('from') ?? str('speaker') ?? str('agent');
  const text = str('text') ?? str('message');
  if (!from || !text) return [];
  const to = str('to');
  const fromParty: Party = { id: from, label: agentLabel(from, ctx.me) };
  const toParty: Party = to ? { id: to, label: agentLabel(to, ctx.me) } : EVERYONE;
  return [
    {
      at: 0,
      kind: 'discussion',
      from: fromParty,
      to: toParty,
      text: shortCaption(safeText(text, ctx.mine), 200),
      parts: [from, ...(to ? [to] : [])],
      mine: ctx.mine,
    },
  ];
});
function agentLabel(id: string, me?: string): string {
  try {
    return agentKind(id) && /^(student|expert|council):|^(dean|mediator)$/.test(id)
      ? party(id, me).label
      : cap(id);
  } catch {
    return cap(id);
  }
}

/** Exchanges carried by one validated event (zero for state/mastery echoes). `at` is filled by the store. */
export function exchangesFromEvent(e: VillageEvent, ctx: ExchangeCtx): Omit<Exchange, 'seq'>[] {
  const me = ctx.me;
  const meId = me ? `student:${me}` : undefined;
  const mine = ctx.mine;
  const say = (e as { message?: string }).message;
  const clean = (t: string) => shortCaption(safeText(t, mine), 200);
  const mk = (
    x: Omit<Exchange, 'seq' | 'at' | 'mine'> & { at?: number },
  ): Omit<Exchange, 'seq'> => ({
    at: 0,
    mine,
    ...x,
  });
  switch (e.t) {
    case 'agent.message': {
      const to: Party = e.to === 'commons' ? COMMONS : party(e.to, me);
      const words = eventWords(e, mine, me ? { me } : {}).now;
      const text = say ? clean(say) : clean(words);
      const alert =
        e.kind === 'conflict' || e.kind === 'option_dropped' || e.kind === 'query_denied';
      const kind: ExchangeKind =
        e.kind.startsWith('psi.') || e.kind.startsWith('share.') ? 'privacy' : 'mesh';
      return [
        mk({
          kind,
          from: party(e.from, me),
          to,
          text,
          parts: [e.from, ...(e.to !== 'commons' ? [e.to] : [])],
          ...(alert ? { alert: true } : {}),
        }),
      ];
    }
    case 'council.opinion': {
      const text = say ?? e.text;
      return [
        mk({
          kind: 'council',
          from: { id: e.councilId, label: `${cap(e.member)} (council)` },
          to: { id: e.councilId, label: 'the chair' },
          text: text ? clean(text) : 'Gave an opinion',
          parts: [e.councilId, ...(meId ? [meId] : [])],
        }),
      ];
    }
    case 'council.rank':
      return [
        mk({
          kind: 'rank',
          from: { id: e.councilId, label: `${cap(e.member)} (council)` },
          to: { id: e.councilId, label: 'the other members' },
          text: say
            ? clean(say)
            : e.order?.length
              ? `Ranked the other answers without names: ${e.order.join(' > ')}`
              : 'Ranked the other answers without names',
          parts: [e.councilId, ...(meId ? [meId] : [])],
        }),
      ];
    case 'council.verdict': {
      const dissenter = e.dissenter ?? (e.dissent ? e.member : undefined);
      const text = say ?? e.text ?? 'Decided';
      return [
        mk({
          kind: 'verdict',
          from: { id: e.councilId, label: `${cap(e.member)} (chair)` },
          to: meId ? { id: meId, label: 'You' } : EVERYONE,
          text: clean(text) + (dissenter ? ` Dissent recorded: ${dissenter}.` : ''),
          parts: [e.councilId, ...(meId ? [meId] : [])],
          ...(dissenter ? { dissent: true } : {}),
        }),
      ];
    }
    case 'quiz.question': {
      const target = e.target ? `student:${e.target}` : undefined;
      const text = say ?? e.text ?? `Asked a question on ${chapterName(e.chapter)}`;
      return [
        mk({
          kind: 'quiz',
          from: party(`expert:${e.chapter}`, me),
          to: target ? party(target, me) : EVERYONE,
          text: clean(text),
          parts: [`expert:${e.chapter}`, ...(target ? [target] : [])],
        }),
      ];
    }
    case 'quiz.answer':
      if (!e.student) return [];
      return [
        mk({
          kind: 'quiz',
          from: party(`student:${e.student}`, me),
          to: party(`expert:${e.chapter}`, me),
          text: mine
            ? 'Sent an answer'
            : `${studentName(e.student)} sent an answer (the answer itself stays private)`,
          parts: [`student:${e.student}`, `expert:${e.chapter}`],
        }),
      ];
    case 'quiz.result':
      if (!e.student) return [];
      return [
        mk({
          kind: 'quiz',
          from: party(`expert:${e.chapter}`, me),
          to: party(`student:${e.student}`, me),
          text:
            mine && e.correct !== undefined
              ? e.correct
                ? 'Marked it correct'
                : 'Marked it not yet'
              : 'Finished marking',
          parts: [`expert:${e.chapter}`, `student:${e.student}`],
        }),
      ];
    case 'call.caption': {
      if (!mine) return [];
      const to = meId ? party(meId, me) : EVERYONE;
      return [
        mk({
          kind: 'call',
          from: party(e.agent, me),
          to,
          text: clean(e.text ?? say ?? ''),
          parts: [e.agent, ...(meId ? [meId] : [])],
          ...(e.cite ? { cite: e.cite } : {}),
        }),
      ].filter((x) => x.text);
    }
    case 'discussion.turn':
    case 'discussion.interrupted': {
      if (!e.agent) return [];
      const text =
        e.t === 'discussion.turn' ? (e.text ? clean(e.text) : '') : 'Yielded to the student';
      if (!text) return [];
      return [
        mk({
          kind: 'discussion',
          from: party(e.agent, me),
          to: e.to ? party(e.to, me) : EVERYONE,
          text,
          parts: [e.agent, ...(e.to ? [e.to] : [])],
        }),
      ];
    }
    case 'confirm.pending':
      if (!mine) return [];
      return [
        mk({
          kind: 'confirm',
          from: { id: `student:${e.student}`, label: 'Your agent' },
          to: { id: `student:${e.student}`, label: 'You' },
          text: `Asked for your yes: ${e.question}`,
          parts: [`student:${e.student}`],
        }),
      ];
    case 'confirm.done':
      if (!mine) return [];
      return [
        mk({
          kind: 'confirm',
          from: { id: `student:${e.student}`, label: 'You' },
          to: { id: `student:${e.student}`, label: 'Your agent' },
          text: 'Said yes',
          parts: [`student:${e.student}`],
        }),
      ];
    case 'ledger.entry': {
      const who = studentName(e.student);
      const iAm = me !== undefined && e.student === me;
      const text = e.blocked
        ? `The privacy gate blocked ${e.field}`
        : e.withheld === 'hidden' || e.shared === undefined
          ? `Kept ${e.field} hidden`
          : iAm
            ? `Shared ${e.field}: ${e.shared}`
            : `Shared ${e.field}`;
      return [
        mk({
          kind: 'privacy',
          from: { id: `student:${e.student}`, label: iAm ? 'You' : who },
          to: { id: 'commons', label: 'the notice board' },
          text,
          parts: [`student:${e.student}`],
          ...(e.blocked ? { alert: true } : {}),
        }),
      ];
    }
    case 'trip.confirmed':
      return [
        mk({
          kind: 'trip',
          from: party('mediator', me),
          to: EVERYONE,
          text: 'Everyone said yes: the trip is confirmed',
          parts: ['mediator'],
        }),
      ];
    case 'agent.state':
    case 'call.start':
    case 'call.end':
    case 'mastery.changed':
    case 'discussion.started':
    case 'discussion.ended':
    case 'discussion.takeaway':
      return [];
    default: {
      const _x: never = e;
      void _x;
      return [];
    }
  }
}

/* ------------------------------------------------------------------ per-agent view */

export interface ThreadLine {
  readonly seq: number;
  readonly at: number;
  readonly kind: ExchangeKind;
  /** 'out' = this agent said it; 'in' = it was said to this agent; 'seen' = it was part of the exchange. */
  readonly direction: 'out' | 'in' | 'seen';
  readonly from: Party;
  readonly to: Party;
  readonly text: string;
  readonly dissent: boolean;
  readonly alert: boolean;
  readonly cite?: Citation;
}
export interface Partner {
  readonly id: string;
  readonly label: string;
  readonly selectable: boolean;
  readonly count: number;
  /** An exchange with this partner within the last few seconds: the line pulses. */
  readonly active: boolean;
}
export interface ChatLine {
  readonly seq: number;
  readonly at: number;
  readonly who: 'agent' | 'you';
  readonly name: string;
  readonly text: string;
  readonly cite?: Citation;
}
export interface Conversation {
  readonly thread: readonly ThreadLine[];
  readonly partners: readonly Partner[];
  /** What this agent and the viewer said to each other (calls, quiz, confirms). Never anyone else's. */
  readonly chat: readonly ChatLine[];
}

export const ACTIVE_MS = 6000;
const THREAD_MAX = 30;

/** Exchanges of one agent as a thread (newest first), its current partners, and the viewer-only chat. */
export function describeConversation(
  agentId: string,
  all: readonly Exchange[],
  opts: { me?: string; now: number },
): Conversation {
  const mine = all.filter((x) => x.parts.includes(agentId));
  const thread: ThreadLine[] = mine
    .slice(-THREAD_MAX)
    .reverse()
    .map((x) => ({
      seq: x.seq,
      at: x.at,
      kind: x.kind,
      direction:
        x.from.id === agentId && x.to.id !== agentId
          ? 'out'
          : x.to.id === agentId && x.from.id !== agentId
            ? 'in'
            : 'seen',
      from: x.from,
      to: x.to,
      text: x.text,
      dissent: !!x.dissent,
      alert: !!x.alert,
      ...(x.cite ? { cite: x.cite } : {}),
    }));

  const partners = new Map<string, { p: Party; count: number; last: number }>();
  for (const x of mine) {
    const other = x.from.id === agentId ? x.to : x.to.id === agentId ? x.from : undefined;
    if (!other || other.id === agentId || other.id === 'everyone') continue;
    const cur = partners.get(other.id) ?? { p: other, count: 0, last: 0 };
    cur.count++;
    cur.last = Math.max(cur.last, x.at);
    partners.set(other.id, cur);
  }
  const partnerList: Partner[] = [...partners.values()]
    .sort((a, b) => b.last - a.last)
    .slice(0, 8)
    .map(({ p, count, last }) => ({
      id: p.id,
      label: p.label,
      selectable: isSelectable(p),
      count,
      active: opts.now - last <= ACTIVE_MS,
    }));

  const chat: ChatLine[] = mine
    .filter((x) => x.mine && (x.kind === 'call' || x.kind === 'quiz' || x.kind === 'confirm'))
    .filter((x) => x.parts.includes(agentId))
    .slice(-THREAD_MAX)
    .map((x) => {
      const fromYou = x.from.label === 'You';
      return {
        seq: x.seq,
        at: x.at,
        who: fromYou ? ('you' as const) : ('agent' as const),
        name: fromYou ? 'You' : x.from.label,
        text: x.text,
        ...(x.cite ? { cite: x.cite } : {}),
      };
    })
    .reverse();
  return { thread, partners: partnerList, chat };
}

/** Pairs of selectable agents that exchanged something within `windowMs` (for the village link). */
export function activeLinks(
  all: readonly Exchange[],
  now: number,
  windowMs = 4000,
): Array<{ a: string; b: string; at: number }> {
  const out = new Map<string, { a: string; b: string; at: number }>();
  for (let i = all.length - 1; i >= 0; i--) {
    const x = all[i]!;
    if (now - x.at > windowMs) break;
    if (!isSelectable(x.from) || !isSelectable(x.to) || x.from.id === x.to.id) continue;
    const key = [x.from.id, x.to.id].sort().join('|');
    if (!out.has(key)) out.set(key, { a: x.from.id, b: x.to.id, at: x.at });
  }
  return [...out.values()];
}
