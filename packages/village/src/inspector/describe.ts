import { SENTINELS, parseAgentId } from '@squad/core';
import type { VillageEvent } from '@squad/core';
import { agentName, chapterName, kindWords, shortCaption, studentName } from '../adapter/labels';

/**
 * Agent Inspector: pure mapping from the (already per-viewer filtered) event stream to plain words.
 * No Phaser, no clock, no randomness. Nothing here reads anything but the events it is given, and
 * values that are withheld stay withheld ('hidden'). Other students' private numbers never appear.
 */

export type RunState = 'idle' | 'studying' | 'in_call' | 'waiting_for_student';
export type Tier = 'fast' | 'main' | 'chair';

/** An event plus when the viewer received it and whether it concerns the viewer. */
export interface StampedEvent {
  readonly at: number;
  readonly event: VillageEvent;
  /** True when the event is about the viewing student (their own call, confirm, quiz, ...). */
  readonly mine: boolean;
}

export interface AgentSnapshot {
  readonly id: string;
  readonly state: RunState;
  /** Agents (anywhere in the squad) currently waiting for a yes. */
  readonly squadWaiting?: number;
}

export interface DescribeOptions {
  readonly me?: string;
  readonly now?: number;
}

export interface LogLine {
  readonly at: number;
  readonly text: string;
}
export interface ThoughtView {
  readonly text: string;
  /** shared = the agent said it; stream = built from public event text; none = honest fallback. */
  readonly source: 'shared' | 'stream' | 'none';
}
export interface ActivityView {
  readonly id: string;
  readonly name: string;
  readonly kind: 'student' | 'expert' | 'council' | 'dean' | 'mediator';
  readonly role: string;
  readonly isMe: boolean;
  readonly state: RunState;
  readonly stateLabel: string;
  /** The one clear current-activity line. Never blank. */
  readonly headline: string;
  readonly place: string;
  readonly heading?: string;
  readonly waitingOn?: string;
  readonly skill?: string;
  readonly tier?: Tier;
  readonly tierLabel?: string;
  readonly demo: boolean;
  readonly thinking: boolean;
  readonly thought: ThoughtView;
  readonly thoughtHistory: readonly string[];
  readonly log: readonly LogLine[];
}

export const STATE_LABEL: Record<RunState, string> = {
  idle: 'Idle',
  studying: 'Studying',
  in_call: 'On a call',
  waiting_for_student: 'Waiting for a yes',
};
export const TIER_LABEL: Record<Tier, string> = {
  fast: 'Fast model',
  main: 'Main model',
  chair: 'Chair model',
};
export const NO_REASONING = 'Working on it: no reasoning shared yet';
const SAFE_GENERIC = 'Something is happening in the village';
const HEADING_WINDOW_MS = 12_000;
const LOG_MAX = 10;
const THOUGHT_HISTORY_MAX = 4;

/* ------------------------------------------------------------------ privacy */

/** Currency-looking amounts and the known sentinels become 'hidden' in text about other students. */
export function redact(text: string): string {
  let out = text.replace(/[$€£]\s?\d[\d,.]*/g, 'hidden');
  for (const s of SENTINELS) {
    out = out.replace(new RegExp(s.replace(/[$.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'hidden');
  }
  return out;
}
const safe = (text: string, mine: boolean): string => (mine ? text : redact(text));

/** Event kinds whose free text is public squad-wide, so another student's agent may show a `thought` from them. */
const PUBLIC_THOUGHT_KINDS = new Set<string>([
  'agent.state',
  'agent.message',
  'council.opinion',
  'council.rank',
  'council.verdict',
  'quiz.question',
  'trip.confirmed',
]);

/* ------------------------------------------------------------------ names and places */

export function agentKind(id: string): ActivityView['kind'] {
  const k = parseAgentId(id).kind;
  return k === 'student' || k === 'expert' || k === 'council' || k === 'dean' || k === 'mediator'
    ? k
    : 'expert';
}

export function displayName(id: string, me?: string): string {
  const n = agentName(id);
  return me && id === `student:${me}` ? `${n} (you)` : n;
}

export function roleOf(id: string, me?: string): string {
  switch (agentKind(id)) {
    case 'student':
      return me && id === `student:${me}`
        ? 'Your study agent'
        : `${agentName(id)}'s study agent (public activity only)`;
    case 'expert':
      return `${agentName(id)}: answers questions about its chapter`;
    case 'council':
      return 'Council: several voices argue, a chair decides';
    case 'dean':
      return 'Dean: helps plan the term';
    case 'mediator':
      return 'Mediator: finds a plan that works for everyone without seeing private details';
  }
}

export function placeOf(id: string, state: RunState): string {
  const base = (() => {
    switch (agentKind(id)) {
      case 'student':
        return `${agentName(id)}'s house`;
      case 'expert':
        return `the ${agentName(id).replace(' expert', '')} house`;
      case 'council':
        return 'the Council Hall';
      case 'dean':
        return "the Dean's office";
      case 'mediator':
        return 'the campfire commons';
    }
  })();
  return state === 'waiting_for_student' ? `at the front door of ${base}` : `in ${base}`;
}

export function taskWords(taskId: string): string {
  const t = taskId.toLowerCase();
  if (t.includes('trip')) return 'the trip plan';
  if (t.includes('study')) return 'the study plan';
  const w = t
    .replace(/^task[_-]?/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 30);
  return w ? `the ${w} plan` : 'a plan';
}

/** 'asks: budget' -> 'budget' (labels the mesh already marks shareable). */
const stripLabel = (s: string): string => s.replace(/^[a-z ]+:\s*/i, '').trim();

/* ------------------------------------------------------------------ per-event words */

export interface EventWords {
  /** Log line with a subject: 'Ben blinded calendar tokens'. */
  readonly log: string;
  /** What the agent is doing right now, no subject: 'Blinding calendar tokens'. */
  readonly now: string;
  /** Public text this event carries that works as a 'stream' thought (never invented). */
  readonly context?: string;
  readonly skill?: string;
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lc = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function messageWords(e: Extract<VillageEvent, { t: 'agent.message' }>, mine: boolean): EventWords {
  const shared = e.shared.map((s) => safe(s, mine));
  const first = shared[0] ?? '';
  const k = e.kind;
  const make = (now: string, extra: Partial<EventWords> = {}): EventWords => ({
    now,
    log: `${agentName(e.from)}: ${lc(now)}`,
    skill: 'Squad planning',
    ...extra,
  });
  if (k === 'task.open') return make(`Opening ${taskWords(e.taskId)}${first ? ` (${first})` : ''}`);
  if (k === 'psi.blind') return make('Blinding calendar tokens so raw calendars stay private');
  if (k === 'psi.tokens') return make('Sharing blinded calendar tokens with the mediator');
  if (k === 'psi.common')
    return make(`Finding free slots everyone shares${first ? `: ${first}` : ''}`);
  if (k === 'share.vec') return make('Splitting a private value into secret shares');
  if (k === 'share.sum') return make('Adding up secret shares with the others');
  if (k === 'query')
    return make(`Asking the others about ${stripLabel(first) || 'a detail'}`, {
      context: first ? `Question: ${stripLabel(first)}` : undefined,
    });
  if (k === 'query_denied')
    return make(`A request was denied by the privacy gate${first ? `: ${stripLabel(first)}` : ''}`);
  if (k === 'conflict')
    return make(`Conflict found${first ? `: ${first}` : ''}`, {
      context: first ? `Unsure: ${first}` : 'Unsure: the plans conflict',
    });
  if (k === 'option_dropped')
    return make(`Dropping an option${first ? ` (${stripLabel(first)})` : ''}`, {
      context: first ? `Comparing plan options: ${first}` : 'Comparing plan options',
    });
  if (k === 'result') return make(`Reporting: ${first || 'a result'}`);
  const words = kindWords(k);
  return make(shared.length ? `${words}: ${shared.join(', ')}` : words);
}

/** Words for one event. Total over the union: every kind returns non-empty text. */
export function eventWords(
  event: VillageEvent,
  mine: boolean,
  opts: { me?: string; agentId?: string; state?: RunState } = {},
): EventWords {
  const e = event;
  switch (e.t) {
    case 'agent.state': {
      const who = agentName(e.agent);
      const place = placeOf(e.agent, e.state);
      const now = {
        idle: `Idle ${place}`,
        studying: `Studying ${place}`,
        in_call: 'On a call',
        waiting_for_student: `Waiting for a yes ${place}`,
      }[e.state];
      const log = {
        idle: `${who} is resting`,
        studying: `${who} started studying`,
        in_call: `${who} is on a call`,
        waiting_for_student: `${who} is waiting for a yes`,
      }[e.state];
      return { now, log };
    }
    case 'agent.message':
      return messageWords(e, mine);
    case 'ledger.entry': {
      const who = studentName(e.student);
      const iAm = opts.me !== undefined && e.student === opts.me;
      if (e.blocked)
        return {
          now: `Blocked by the privacy gate: ${e.field}`,
          log: `The privacy gate blocked ${who}'s ${e.field}`,
          skill: 'Privacy ledger',
        };
      if (e.withheld === 'hidden' || e.shared === undefined)
        return {
          now: `Keeping ${e.field} hidden`,
          log: `${who} kept ${e.field} hidden`,
          skill: 'Privacy ledger',
        };
      return {
        now: iAm ? `Sharing ${e.field}: ${e.shared}` : `Sharing ${e.field}`,
        log: iAm ? `${who} shared ${e.field}: ${e.shared}` : `${who} shared ${e.field}`,
        skill: 'Privacy ledger',
      };
    }
    case 'confirm.pending':
      return {
        now: mine ? `Waiting for your yes: ${e.question}` : 'Waiting for a yes',
        log: mine ? `Asked for a yes: ${e.question}` : 'Asked for a yes',
        context: mine ? `Waiting to hear: ${e.question}` : undefined,
        skill: 'Confirm',
      };
    case 'confirm.done':
      return { now: 'Got a yes', log: `${studentName(e.student)} said yes`, skill: 'Confirm' };
    case 'council.opinion': {
      const text = e.text ? safe(e.text, mine) : '';
      return {
        now: `Giving an opinion as ${e.member}`,
        log: text ? `${cap(e.member)} says: ${shortCaption(text, 90)}` : `${cap(e.member)} gave an opinion`,
        context: text ? `${cap(e.member)}'s stance: ${shortCaption(text, 140)}` : undefined,
        skill: 'Council',
      };
    }
    case 'council.rank':
      return {
        now: `Ranking the answers as ${e.member}`,
        log: e.order?.length
          ? `${cap(e.member)} ranked: ${e.order.join(', ')}`
          : `${cap(e.member)} ranked the answers`,
        skill: 'Council',
      };
    case 'council.verdict': {
      const text = e.text ? safe(e.text, mine) : '';
      const dissenter = e.dissenter ?? (e.dissent ? e.member : undefined);
      return {
        now: `Council decided${text ? `: ${shortCaption(text, 100)}` : ''}${dissenter ? ` (${dissenter} dissented)` : ''}`,
        log: `Council verdict${text ? `: ${shortCaption(text, 90)}` : ''}${dissenter ? `; ${dissenter} dissented` : ''}`,
        context: dissenter ? `Unsure: ${dissenter} dissented, so ask your TA` : undefined,
        skill: 'Council',
      };
    }
    case 'quiz.question': {
      const chapter = chapterName(e.chapter);
      const target = e.target ? studentName(e.target) : undefined;
      const text = e.text ? safe(e.text, mine) : '';
      return {
        now: target ? `Asking ${target} a question on ${chapter}` : `Asking a question on ${chapter}`,
        log: target ? `Asked ${target} a question on ${chapter}` : `Asked a question on ${chapter}`,
        context: text ? `Working on: ${shortCaption(text, 160)}` : undefined,
        skill: 'Quiz',
      };
    }
    case 'quiz.answer': {
      const who = e.student ? studentName(e.student) : 'a student';
      return {
        now: `Checking ${who}'s quiz answer on ${chapterName(e.chapter)}`,
        log: `${cap(who)} answered a ${chapterName(e.chapter)} question`,
        skill: 'Quiz',
      };
    }
    case 'quiz.result': {
      const chapter = chapterName(e.chapter);
      const verdict =
        mine && e.correct !== undefined ? (e.correct ? ' (correct)' : ' (not yet)') : '';
      return {
        now: `Wrapping up the ${chapter} quiz round${verdict}`,
        log: `Quiz round finished for ${chapter}${verdict}`,
        skill: 'Quiz',
      };
    }
    case 'call.start':
      return {
        now: mine ? 'Starting a call with you' : 'Starting a call',
        log: `${agentName(e.agent)} started a call`,
        skill: 'Expert call',
      };
    case 'call.caption': {
      const text = shortCaption(safe(e.text ?? '', mine), 90);
      const cite = mine ? e.cite : undefined;
      const who = opts.me ? studentName(opts.me) : 'you';
      const reading = cite
        ? `Reading ${cite.file}${cite.page !== undefined ? ` p.${cite.page}` : ''} for ${who}'s question`
        : '';
      return {
        now: reading || (text ? `Explaining: ${text}` : 'Talking on a call'),
        log: text ? `${agentName(e.agent)}: ${text}` : `${agentName(e.agent)} spoke`,
        ...(cite
          ? {
              context: `Weighing a source: ${cite.file}${cite.page !== undefined ? `, page ${cite.page}` : ''}`,
            }
          : {}),
        skill: 'Expert call',
      };
    }
    case 'call.end':
      return {
        now: 'Finished a call',
        log: `${agentName(e.agent)} ended the call`,
        skill: 'Expert call',
      };
    case 'trip.confirmed':
      return {
        now: 'Celebrating: everyone said yes',
        log: 'Everyone said yes: trip confirmed',
        skill: 'Trip',
      };
    case 'mastery.changed':
      return {
        now: `Tracking progress on ${chapterName(e.chapter)}`,
        log: mine
          ? `${chapterName(e.chapter)} is getting stronger`
          : `${studentName(e.student)} practised ${chapterName(e.chapter)}`,
        skill: 'Mastery',
      };
    default: {
      const _x: never = e;
      void _x;
      return { now: SAFE_GENERIC, log: SAFE_GENERIC };
    }
  }
}

/** Fallback-proof wrapper: never throws, never blank, unknown shapes become a generic line. */
export function wordsFor(
  event: unknown,
  mine: boolean,
  opts: { me?: string } = {},
): EventWords {
  try {
    const w = eventWords(event as VillageEvent, mine, opts);
    if (w.now.trim() && w.log.trim()) return w;
  } catch {
    /* fall through to the generic line */
  }
  return { now: SAFE_GENERIC, log: SAFE_GENERIC };
}

/* ------------------------------------------------------------------ who an event concerns */

/** Agent ids an event belongs to (their inspector shows it). `known` lets a chapter map to an existing expert. */
export function involved(event: VillageEvent, me?: string): string[] {
  const mine = me ? [`student:${me}`] : [];
  switch (event.t) {
    case 'agent.state':
      return [event.agent];
    case 'agent.message':
      return [event.from, ...(event.to !== 'commons' ? [event.to] : [])];
    case 'ledger.entry':
    case 'confirm.pending':
    case 'confirm.done':
    case 'mastery.changed':
      return [`student:${event.student}`];
    case 'council.opinion':
    case 'council.rank':
    case 'council.verdict':
      return [event.councilId, ...mine];
    case 'quiz.question':
      return [...(event.target ? [`student:${event.target}`] : []), `expert:${event.chapter}`];
    case 'quiz.answer':
    case 'quiz.result':
      return [...(event.student ? [`student:${event.student}`] : []), `expert:${event.chapter}`];
    case 'call.start':
    case 'call.caption':
    case 'call.end':
      return [event.agent, ...(event.student ? [`student:${event.student}`] : [])];
    case 'trip.confirmed':
      return []; // the store fans this out to every student agent
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ the activity view */

export function relTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function councilCounts(recent: readonly StampedEvent[], councilId: string) {
  let lastVerdict = -1;
  recent.forEach((r, i) => {
    if (r.event.t === 'council.verdict' && r.event.councilId === councilId) lastVerdict = i;
  });
  const answered = new Set<string>();
  const seen = new Set<string>();
  recent.forEach((r, i) => {
    const e = r.event;
    if ((e.t === 'council.opinion' || e.t === 'council.rank') && e.councilId === councilId) {
      seen.add(e.member);
      if (e.t === 'council.opinion' && i > lastVerdict) answered.add(e.member);
    }
  });
  return { answered: answered.size, total: Math.max(3, seen.size), decided: lastVerdict >= 0 };
}

/**
 * Everything the inspector shows for one agent. `recent` holds the events concerning this agent
 * (oldest first); the latest one that is not a bare state echo decides the headline. Total: never
 * throws and never returns a blank headline.
 */
export function describeActivity(
  agent: AgentSnapshot,
  recent: readonly StampedEvent[],
  opts: DescribeOptions = {},
): ActivityView {
  const me = opts.me;
  const now = opts.now ?? (recent.at(-1)?.at ?? 0);
  const id = agent.id;
  const kind = agentKind(id);
  const isMe = me !== undefined && id === `student:${me}`;
  const state = agent.state;
  const place = placeOf(id, state);
  const latest = recent.at(-1);
  const words = (r: StampedEvent) => wordsFor(r.event, r.mine, { ...(me ? { me } : {}) });

  // Headline: the latest event about this agent; state is the baseline when nothing else happened.
  let headline = '';
  if (latest) headline = words(latest).now;
  if (!headline.trim())
    headline = {
      idle: `Idle ${place}`,
      studying: `Studying ${place}`,
      in_call: 'On a call',
      waiting_for_student: `Waiting for a yes ${place}`,
    }[state];
  // A state that moved on after the last non-state event wins (the stream said so).
  if (latest && latest.event.t !== 'agent.state') {
    const lastState = [...recent].reverse().find((r) => r.event.t === 'agent.state');
    if (lastState && lastState.at > latest.at) headline = words(lastState).now;
  }

  // Council progress overrides: "Asking the council: 2 of 3 answered".
  const councilId = [...recent]
    .reverse()
    .map((r) => (r.event.t.startsWith('council.') ? (r.event as { councilId: string }).councilId : ''))
    .find(Boolean);
  let waitingOn: string | undefined;
  if (councilId && latest && latest.event.t.startsWith('council.')) {
    const c = councilCounts(recent, councilId);
    const line = c.decided
      ? 'The council has decided'
      : `${c.answered} of ${c.total} council members answered`;
    if (kind === 'council') headline = c.decided ? line : `Deliberating: ${line}`;
    else {
      headline = c.decided ? 'The council has decided' : `Asking the council: ${line}`;
      if (!c.decided) waitingOn = `The council: ${line}`;
    }
  }

  // Waiting on.
  if (state === 'waiting_for_student') {
    const pending = [...recent].reverse().find((r) => r.event.t === 'confirm.pending' && r.mine);
    const q = pending && pending.event.t === 'confirm.pending' ? pending.event.question : '';
    if (isMe) waitingOn = q ? `Your yes: ${q}` : 'Your yes';
    else {
      const n = agent.squadWaiting ?? 1;
      waitingOn = n > 1 ? `${n} yeses in all (${agentName(id)} is one)` : `A yes from ${agentName(id).replace(/ \(.*/, '')}`;
    }
    if (isMe && headline.toLowerCase().startsWith('waiting')) {
      const t = q ? `Waiting for your yes: ${q}` : 'Waiting for your yes';
      headline = t;
    }
  }

  // Heading: an envelope carried to the commons or a door in the last few seconds.
  let heading: string | undefined;
  const msg = [...recent].reverse().find((r) => r.event.t === 'agent.message');
  if (msg && msg.event.t === 'agent.message' && msg.event.from === id && now - msg.at <= HEADING_WINDOW_MS) {
    const dest = msg.event.to === 'commons' ? 'the campfire commons' : `${agentName(msg.event.to)}'s door`;
    heading = `Walking to ${dest} with a message`;
  }

  // Skill, tier, demo, thinking from the latest event that carries them.
  let skill: string | undefined;
  let tier: Tier | undefined;
  let demo = false;
  let thinking = false;
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i]!;
    const w = (r.event as { work?: { tier?: Tier; demo?: boolean; skill?: string; thinking?: boolean } }).work;
    if (i === recent.length - 1) thinking = w?.thinking === true;
    if (!skill && w?.skill) skill = w.skill;
    if (!tier && w?.tier) tier = w.tier;
    if (w?.demo === true) demo = true;
    if (skill && tier) break;
  }
  if (!skill) for (let i = recent.length - 1; i >= 0 && !skill; i--) skill = words(recent[i]!).skill;

  // Thinking.
  const shared: { at: number; text: string }[] = [];
  for (const r of recent) {
    const raw = (r.event as { thought?: string }).thought;
    if (!raw?.trim()) continue;
    if (!isMe && !r.mine && !PUBLIC_THOUGHT_KINDS.has(r.event.t)) continue;
    shared.push({ at: r.at, text: safe(raw.trim(), r.mine) });
  }
  const lastShared = shared.at(-1);
  let thought: ThoughtView;
  const ctxLine = [...recent].reverse().map((r) => words(r).context).find((c) => !!c);
  if (lastShared && (!latest || lastShared.at >= latest.at - 20_000))
    thought = { text: lastShared.text, source: 'shared' };
  else if (ctxLine) thought = { text: ctxLine, source: 'stream' };
  else if (lastShared) thought = { text: lastShared.text, source: 'shared' };
  else
    thought = {
      text: state === 'idle' && !thinking ? 'Resting: nothing in progress' : NO_REASONING,
      source: 'none',
    };
  const thoughtHistory = shared
    .map((s) => s.text)
    .filter((t, i, a) => !(i === a.length - 1 && thought.source === 'shared' && t === thought.text))
    .slice(-THOUGHT_HISTORY_MAX)
    .reverse();

  const log: LogLine[] = recent
    .slice(-LOG_MAX)
    .reverse()
    .map((r) => ({ at: r.at, text: words(r).log }));

  const tierLabel = tier ? TIER_LABEL[tier] : undefined;
  return {
    id,
    name: displayName(id, me),
    kind,
    role: roleOf(id, me),
    isMe,
    state,
    stateLabel: STATE_LABEL[state],
    headline: headline.trim() || SAFE_GENERIC,
    place,
    ...(heading ? { heading } : {}),
    ...(waitingOn ? { waitingOn } : {}),
    ...(skill ? { skill } : {}),
    ...(tier ? { tier } : {}),
    ...(tierLabel ? { tierLabel } : {}),
    demo,
    thinking,
    thought,
    thoughtHistory,
    log,
  };
}
