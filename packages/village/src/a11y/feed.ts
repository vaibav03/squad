import type { VillageEvent, VillageSource } from '@squad/core';
import { parseAgentId } from '@squad/core';
import { adaptUnknown, agentName } from '../adapter';
import type { AdapterContext, AgentState, OverlayRequest, SceneCommand } from '../adapter';

/**
 * Text-alternative model for the web `AgentList` ("Agents and places") and the live region.
 * Built on adapter output (the same commands the canvas executes), so list and canvas cannot disagree.
 * Only display-safe strings from commands ever enter it: withheld values never exist here.
 */

export type StateIcon = 'moon' | 'lamp' | 'phone' | 'hourglass';
export interface FeedAction {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly request?: OverlayRequest;
}
export interface FeedEntry {
  readonly id: string;
  readonly kind: 'student' | 'expert' | 'council' | 'dean' | 'mediator' | 'place';
  readonly name: string;
  readonly state: string;
  readonly stateIcon: StateIcon | 'place';
  readonly detail: string;
  readonly actions: readonly FeedAction[];
}
export interface AgentFeedSnapshot {
  readonly entries: readonly FeedEntry[];
}
export interface Announcement {
  readonly text: string;
  readonly politeness: 'polite' | 'assertive';
}

export interface FeedOptions {
  me: string;
  /** Squad size when known; under 3 the list shows no counts. */
  squadSize?: number;
  /** Injectable clock for the announcement rate limit. */
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

export interface AgentFeed {
  /** Feed one VillageEvent (validated; malformed events are ignored). */
  apply(event: unknown): void;
  /** Fold commands executed elsewhere (used by the in-canvas module). */
  applyCommands(commands: readonly SceneCommand[]): void;
  snapshot(): AgentFeedSnapshot;
  subscribe(fn: (s: AgentFeedSnapshot) => void): () => void;
  onAnnounce(fn: (a: Announcement) => void): () => void;
  attach(source: VillageSource): () => void;
  dispose(): void;
}

const STATE_WORDS: Record<AgentState, { words: string; icon: StateIcon }> = {
  idle: { words: 'idle', icon: 'moon' },
  studying: { words: 'studying', icon: 'lamp' },
  in_call: { words: 'in a call', icon: 'phone' },
  waiting_for_student: { words: 'waiting for you', icon: 'hourglass' },
};
const MIN_GAP_MS = 600;
const QUEUE_CAP = 20;
const DETAIL_MAX = 80;

interface AgentRec {
  id: string;
  state: AgentState;
  detail: string;
  call?: { callId: string; mine: boolean };
  quiz?: { quizId: string; chapter: string };
  confirm?: { taskId: string; question: string };
}

export function createAgentFeed(opts: FeedOptions): AgentFeed {
  const ctx: AdapterContext = {
    me: opts.me,
    ...(opts.squadSize !== undefined ? { squadSize: opts.squadSize } : {}),
  };
  const now = opts.now ?? (() => Date.now());
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  const agents = new Map<string, AgentRec>();
  let ledgerCount = 0;
  let verdict = '';
  let tripConfirmed = false;
  const subs = new Set<(s: AgentFeedSnapshot) => void>();
  const annSubs = new Set<(a: Announcement) => void>();
  const queue: Announcement[] = [];
  let lastAnn = -Infinity;
  let lastText = '';
  let timer: unknown;
  let disposed = false;

  const rec = (id: string): AgentRec => {
    let r = agents.get(id);
    if (!r) agents.set(id, (r = { id, state: 'idle', detail: '' }));
    return r;
  };
  const clip = (s: string) => (s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s);

  const entryFor = (r: AgentRec): FeedEntry => {
    const { kind } = parseAgentId(r.id);
    const k = (
      ['student', 'expert', 'council', 'dean', 'mediator'].includes(kind) ? kind : 'expert'
    ) as FeedEntry['kind'];
    const sw = STATE_WORDS[r.state];
    const actions: FeedAction[] = [];
    if (r.call?.mine) {
      actions.push({
        id: `call:${r.call.callId}`,
        label: 'Join call',
        enabled: true,
        request: { overlay: 'openCall', agent: r.id, callId: r.call.callId },
      });
    }
    if (r.quiz) {
      actions.push({
        id: `quiz:${r.quiz.quizId}`,
        label: 'Answer quiz',
        enabled: true,
        request: { overlay: 'openQuiz', quizId: r.quiz.quizId, chapter: r.quiz.chapter },
      });
    }
    if (r.confirm) {
      actions.push({
        id: `confirm:${r.confirm.taskId}`,
        label: 'Open confirmation',
        enabled: true,
        request: { overlay: 'openConfirm', taskId: r.confirm.taskId, question: r.confirm.question },
      });
    }
    return {
      id: r.id,
      kind: k,
      name: agentName(r.id),
      state: sw.words,
      stateIcon: sw.icon,
      detail: r.detail,
      actions,
    };
  };

  const snapshot = (): AgentFeedSnapshot => {
    const order = { dean: 0, expert: 1, council: 2, student: 3, mediator: 4, place: 5 } as const;
    const list = [...agents.values()]
      .map(entryFor)
      .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
    const small = opts.squadSize !== undefined && opts.squadSize < 3;
    const places: FeedEntry[] = [
      {
        id: 'place:council-hall',
        kind: 'place',
        name: 'Council Hall',
        state: 'open',
        stateIcon: 'place',
        detail: verdict,
        actions: [{ id: 'go:hall', label: 'Open Council Hall', enabled: true }],
      },
      {
        id: 'place:commons',
        kind: 'place',
        name: 'Campfire commons',
        state: 'open',
        stateIcon: 'place',
        detail: '',
        actions: [],
      },
      {
        id: 'place:board',
        kind: 'place',
        name: 'Notice board',
        state: 'open',
        stateIcon: 'place',
        detail:
          small || ledgerCount === 0
            ? ''
            : `${ledgerCount} ${ledgerCount === 1 ? 'entry' : 'entries'}`,
        actions: [{ id: 'go:board', label: 'Open notice board', enabled: true }],
      },
    ];
    if (tripConfirmed) {
      places.push({
        id: 'place:trip-door',
        kind: 'place',
        name: 'Trip door',
        state: 'open',
        stateIcon: 'place',
        detail: 'Everyone said yes.',
        actions: [{ id: 'go:trip', label: 'Go to Trip door', enabled: true }],
      });
    }
    return { entries: [...list, ...places] };
  };

  const notify = () => {
    if (disposed) return;
    const s = snapshot();
    subs.forEach((f) => f(s));
  };

  const drain = () => {
    timer = undefined;
    if (disposed) return;
    const next = queue.shift();
    if (!next) return;
    if (next.text === lastText) {
      drain();
      return;
    }
    lastText = next.text;
    lastAnn = now();
    annSubs.forEach((f) => f(next));
    if (queue.length) timer = setT(drain, MIN_GAP_MS);
  };
  const enqueue = (a: Announcement) => {
    if (queue.length && queue[queue.length - 1]!.text === a.text) return;
    if (!queue.length && a.text === lastText) return;
    if (queue.length >= QUEUE_CAP) queue.shift();
    queue.push(a);
    if (timer === undefined) {
      const wait = Math.max(0, MIN_GAP_MS - (now() - lastAnn));
      if (wait === 0) drain();
      else timer = setT(drain, wait);
    }
  };

  const fold = (commands: readonly SceneCommand[]) => {
    if (commands.length === 0) return;
    for (const c of commands) {
      switch (c.type) {
        case 'setAgentState': {
          const r = rec(c.agent);
          r.state = c.state;
          if (c.state === 'idle') delete r.call;
          break;
        }
        case 'callPortrait': {
          const r = rec(c.agent);
          if (c.on) r.call = { callId: r.call?.callId ?? '', mine: c.student === ctx.me };
          else delete r.call;
          break;
        }
        case 'openOverlay': {
          const q = c.request;
          if (q.overlay === 'openCall') {
            const r = rec(q.agent);
            r.call = { callId: q.callId, mine: true };
          } else if (q.overlay === 'openQuiz') {
            rec(`expert:${q.chapter}`).quiz = { quizId: q.quizId, chapter: q.chapter };
          } else if (q.overlay === 'openConfirm') {
            rec(`student:${ctx.me}`).confirm = { taskId: q.taskId, question: q.question };
          } else if (q.overlay === 'close') {
            if (q.which === 'call')
              for (const r of agents.values())
                if (r.call?.callId === q.callId || q.callId === undefined) delete r.call;
            if (q.which === 'confirm') delete agents.get(`student:${ctx.me}`)?.confirm;
          }
          break;
        }
        case 'chalkboard':
          if (c.mark !== 'question') delete agents.get(`expert:${c.chapter}`)?.quiz;
          break;
        case 'showBubble':
          if (c.style === 'caption' && c.at.kind === 'agent') rec(c.at.agent).detail = clip(c.text);
          break;
        case 'councilVerdict':
          verdict = clip(`Verdict: ${c.text || 'decided'}`);
          break;
        case 'ledgerCard':
          ledgerCount++;
          break;
        case 'playTrip':
          tripConfirmed = true;
          break;
        case 'announce':
          enqueue({ text: c.text, politeness: c.politeness });
          break;
        default:
          break;
      }
    }
    notify();
  };

  return {
    apply(event) {
      fold(adaptUnknown(event as VillageEvent, ctx));
    },
    applyCommands: fold,
    snapshot,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    onAnnounce(fn) {
      annSubs.add(fn);
      return () => annSubs.delete(fn);
    },
    attach(source) {
      return source.subscribe((e) => this.apply(e));
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearT(timer);
      subs.clear();
      annSubs.clear();
      queue.length = 0;
    },
  };
}
