import {
  PHASE_LABEL,
  phaseHasData,
  summarizeConnections,
  type ConnPhase,
} from '../../lib/connection-phase';
import { notSetUp } from '../../lib/state-labels';
import type { Connection } from '../connections/api';
import { arr, obj } from '../home/setup-state';

/**
 * The four setup steps, DERIVED from the same server state the Connections page shows (GET /v1/connections through
 * summarizeConnections, plus the iMessage status, the library and the account). Setup and Home both read this, so
 * they can never disagree with Connections about what is connected.
 */
export type StepKey = 'context' | 'availability' | 'messaging' | 'agent';
export const STEP_ORDER: readonly StepKey[] = ['context', 'availability', 'messaging', 'agent'];

export type StepStatus = 'loading' | 'done' | 'demo' | 'working' | 'attention' | 'todo' | 'error';

export interface SourceLine {
  id: string;
  name: string;
  /** "Live", "Demo data", "Not connected", "Imported" ... */
  state: string;
  /** "1 Classroom item", "4 PDFs" or null. */
  count: string | null;
}
export interface StepLink {
  label: string;
  to: string;
}
export interface Step {
  key: StepKey;
  title: string;
  status: StepStatus;
  /** The one badge text: Done, Demo-connected, Practice mode, Not set up yet, Degraded, Ready, Offline, Not assigned ... */
  badge: string;
  /** One plain sentence about where this step stands. */
  summary: string;
  lines: SourceLine[];
  /** Messaging only: the missing settings in plain words, with the exact names for the collapsed detail. */
  missing: { plain: string; names: string[] } | null;
  review: StepLink;
  change: StepLink;
  /** True when the step counts as complete (real or demo). */
  complete: boolean;
}

export const STEP_TITLE: Record<StepKey, string> = {
  context: 'Learning context',
  availability: 'Availability',
  messaging: 'Messaging',
  agent: 'Agent',
};
export const STEP_LEDE: Record<StepKey, string> = {
  context:
    'The courses and documents your study agent learns from: Canvas, Google Classroom and your own PDFs, together.',
  availability:
    'Your busy and free times, so the agents can find study times that work for everyone. Event titles never leave your account.',
  messaging:
    'How your agent texts you and your group: iMessage through Sendblue, or practice mode while it is not set up.',
  agent: 'Your own study agent: the helper that answers for you in the group chat and the council.',
};
export const STEP_LINKS: Record<StepKey, { review: StepLink; change: StepLink }> = {
  context: {
    review: { label: 'Review imported context', to: '/squad/connections#imported' },
    change: { label: 'Change source', to: '/squad/connections#canvas' },
  },
  availability: {
    review: { label: 'Review imported context', to: '/squad/connections#imported' },
    change: { label: 'Change source', to: '/squad/connections#google' },
  },
  messaging: {
    review: { label: 'Review imported context', to: '/squad/connections#messaging' },
    change: { label: 'Change source', to: '/squad/connections#messaging' },
  },
  agent: {
    review: { label: 'Review imported context', to: '/squad/connections#imported' },
    change: { label: 'Change agent', to: '/squad/personas' },
  },
};

/** A read that is still loading, failed, or answered. */
export type Slot<T> = { s: 'loading' } | { s: 'error' } | { s: 'ok'; v: T };
export const loadingSlot = { s: 'loading' } as const;

export interface MessagingRaw {
  status: unknown;
  setup: unknown;
  linked: number;
}
export interface MeRaw {
  personaId: string;
  projector: boolean | undefined;
}
export interface SetupRaw {
  connections: Slot<Connection[]>;
  pdfs: Slot<number>;
  ics: Slot<boolean>;
  messaging: Slot<MessagingRaw>;
  me: Slot<MeRaw>;
}
export const emptyRaw = (s: 'loading' | 'error' = 'loading'): SetupRaw => ({
  connections: { s },
  pdfs: { s },
  ics: { s },
  messaging: { s },
  me: { s },
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const line = (id: string, name: string, phase: ConnPhase, count: string | null): SourceLine => ({
  id,
  name,
  state: PHASE_LABEL[phase],
  count,
});

const ENV_WORDS: Record<string, string> = {
  SENDBLUE_API_KEY: 'the Sendblue key',
  SENDBLUE_API_SECRET: 'the Sendblue secret',
  SENDBLUE_FROM_NUMBER: 'the Sendblue phone number',
  SENDBLUE_WEBHOOK_SECRET: 'the message-check secret',
};
export function missingInWords(names: string[]): string {
  const words = Array.from(new Set(names.map((n) => ENV_WORDS[n] ?? 'a Sendblue setting')));
  if (words.length === 0) return 'the Sendblue settings';
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function base(
  key: StepKey,
): Pick<Step, 'key' | 'title' | 'review' | 'change' | 'missing' | 'lines'> {
  return {
    key,
    title: STEP_TITLE[key],
    review: STEP_LINKS[key].review,
    change: STEP_LINKS[key].change,
    missing: null,
    lines: [],
  };
}
function pending(key: StepKey, status: 'loading' | 'error'): Step {
  return {
    ...base(key),
    status,
    badge: status === 'loading' ? 'Checking...' : 'Could not check',
    summary: status === 'loading' ? 'Checking...' : 'We could not check this. Try again.',
    complete: false,
  };
}

function context(raw: SetupRaw): Step {
  const { connections, pdfs } = raw;
  if (connections.s !== 'ok' && pdfs.s !== 'ok')
    return pending(
      'context',
      connections.s === 'error' || pdfs.s === 'error' ? 'error' : 'loading',
    );
  const sum = summarizeConnections(connections.s === 'ok' ? connections.v : []);
  const pdfCount = pdfs.s === 'ok' ? pdfs.v : 0;
  const lines: SourceLine[] = [
    line(
      'canvas',
      'Canvas',
      sum.canvas.phase,
      sum.canvas.items ? plural(sum.canvas.items, 'Canvas item', 'Canvas items') : null,
    ),
    line(
      'classroom',
      'Google Classroom',
      sum.classroom.phase,
      sum.classroom.items ? plural(sum.classroom.items, 'Classroom item', 'Classroom items') : null,
    ),
    {
      id: 'pdfs',
      name: 'PDFs',
      state: pdfCount ? 'Imported' : 'None added',
      count: pdfCount ? plural(pdfCount, 'PDF', 'PDFs') : null,
    },
  ];
  const withData = [
    ...(phaseHasData(sum.canvas.phase) && sum.canvas.items > 0 ? [sum.canvas.phase] : []),
    ...(phaseHasData(sum.classroom.phase) && sum.classroom.items > 0 ? [sum.classroom.phase] : []),
    ...(pdfCount > 0 ? (['live'] as ConnPhase[]) : []),
  ];
  const phases = [sum.canvas.phase, sum.classroom.phase];
  let status: StepStatus;
  let summary: string;
  if (withData.length) {
    const demoOnly = withData.every((p) => p === 'demo');
    status = demoOnly ? 'demo' : 'done';
    summary = demoOnly
      ? 'Example items are imported. Connect your own account to use your real courses.'
      : 'Your agent can read what was imported.';
  } else if (phases.some((p) => p === 'syncing' || p === 'connecting')) {
    status = 'working';
    summary = 'Importing your items. This can take a minute.';
  } else if (phases.some((p) => p === 'degraded' || p === 'reauth')) {
    status = 'attention';
    summary = 'A source needs attention before anything is imported.';
  } else if (connections.s === 'error' || pdfs.s === 'error') {
    return pending('context', 'error');
  } else {
    status = 'todo';
    summary = 'Nothing imported yet. Connect Canvas or Google Classroom, or add PDFs.';
  }
  const badge = {
    done: 'Done',
    demo: 'Demo-connected',
    working: 'Syncing...',
    attention: 'Needs attention',
    todo: 'To do',
  }[status as 'done'];
  return {
    ...base('context'),
    status,
    badge,
    summary,
    lines,
    complete: status === 'done' || status === 'demo',
  };
}

function availability(raw: SetupRaw): Step {
  const { connections, ics } = raw;
  if (connections.s !== 'ok') {
    if (connections.s === 'error' && ics.s === 'ok' && ics.v) {
      /* the calendar file alone is enough */
    } else return pending('availability', connections.s);
  }
  const sum = summarizeConnections(connections.s === 'ok' ? connections.v : []);
  const icsDone = ics.s === 'ok' && ics.v;
  const gcal = sum.calendar;
  const n = gcal.items;
  const lines: SourceLine[] = [
    line(
      'gcal',
      'Google Calendar',
      gcal.phase,
      n ? plural(n, 'calendar event', 'calendar events') : null,
    ),
    { id: 'ics', name: 'Calendar file', state: icsDone ? 'Imported' : 'Not imported', count: null },
  ];
  if (sum.canvasCalendar.items > 0)
    lines.splice(
      1,
      0,
      line(
        'canvas-cal',
        'Canvas calendar',
        sum.canvasCalendar.phase,
        plural(sum.canvasCalendar.items, 'calendar event', 'calendar events'),
      ),
    );
  const data = phaseHasData(gcal.phase) && gcal.phase !== 'syncing';
  let status: StepStatus;
  let summary: string;
  if (icsDone || (data && gcal.phase !== 'demo')) {
    status = 'done';
    summary = 'Your agent can see when you are free or busy.';
  } else if (data) {
    status = 'demo';
    summary = 'An example calendar is connected. Connect your own to use your real schedule.';
  } else if (gcal.phase === 'syncing' || gcal.phase === 'connecting') {
    status = 'working';
    summary = 'Importing your calendar. This can take a minute.';
  } else if (gcal.phase === 'reauth' || gcal.phase === 'degraded') {
    status = 'attention';
    summary = 'Google Calendar needs attention.';
  } else {
    status = 'todo';
    summary = 'Not connected yet. Connect Google Calendar, or import a calendar file.';
  }
  const badge = {
    done: 'Done',
    demo: 'Demo-connected',
    working: 'Syncing...',
    attention: 'Needs attention',
    todo: 'To do',
  }[status as 'done'];
  return {
    ...base('availability'),
    status,
    badge,
    summary,
    lines,
    complete: status === 'done' || status === 'demo',
  };
}

function messaging(raw: SetupRaw): Step {
  const m = raw.messaging;
  if (m.s !== 'ok') return pending('messaging', m.s);
  const st = obj(m.v.status);
  const bridge = obj(st.bridge);
  const setup = obj(m.v.setup);
  const bstate = typeof bridge.state === 'string' ? bridge.state : '';
  const names = (a: unknown) => arr(a).filter((x): x is string => typeof x === 'string');
  const missingNames = names(setup.missingEnv).length
    ? names(setup.missingEnv)
    : names(bridge.missingEnv);
  const linkedLine: SourceLine = {
    id: 'phone',
    name: 'Your phone number',
    state: m.v.linked > 0 ? 'Linked' : 'Not linked',
    count: null,
  };
  const mk = (
    status: StepStatus,
    badge: string,
    summary: string,
    missing: Step['missing'] = null,
  ): Step => ({
    ...base('messaging'),
    status,
    badge,
    summary,
    missing,
    lines: [
      {
        id: 'sendblue',
        name: 'iMessage via Sendblue',
        state:
          { todo: 'Not connected', demo: 'Simulated', attention: 'Needs attention' }[
            status as 'todo'
          ] ?? 'Live',
        count: null,
      },
      linkedLine,
    ],
    complete: status === 'done' || status === 'demo',
  });
  if (bstate === 'not_configured' || bstate === 'off' || (st.enabled !== true && bstate === '')) {
    const plain = missingInWords(missingNames);
    return mk('todo', 'Not set up yet', notSetUp(plain), { plain, names: missingNames });
  }
  if (bstate === 'fixture' || st.mode === 'fixture')
    return mk(
      'demo',
      'Practice mode',
      'Practice mode: texts are simulated, nothing is really sent.',
    );
  if (bstate === 'dry_run' || st.mode === 'dry_run')
    return mk('demo', 'Practice mode', 'Practice mode: messages are prepared but not sent.');
  if (bstate === 'degraded' || st.transport === 'degraded') {
    const why = typeof st.degradedReason === 'string' ? st.degradedReason : 'sends are failing';
    return mk('attention', 'Degraded', `Degraded: ${why}.`);
  }
  return mk(
    'done',
    'Connected',
    m.v.linked > 0
      ? 'Connected. Your agent can text you.'
      : 'Connected. Link your phone number so your agent can text you.',
  );
}

function agent(raw: SetupRaw): Step {
  const me = raw.me;
  if (me.s !== 'ok') return pending('agent', me.s);
  const lines = (state: string): SourceLine[] => [
    { id: 'agent', name: 'Your study agent', state, count: null },
  ];
  if (!me.v.personaId)
    return {
      ...base('agent'),
      status: 'todo',
      badge: 'Not assigned',
      summary: 'No study agent yet. Pick one so you have someone to ask.',
      lines: lines('Not assigned'),
      complete: false,
    };
  if (me.v.projector === false)
    return {
      ...base('agent'),
      status: 'attention',
      badge: 'Offline',
      summary: 'Your study agent is offline right now.',
      lines: lines('Offline'),
      complete: true,
    };
  return {
    ...base('agent'),
    status: 'done',
    badge: 'Ready',
    summary: 'Your study agent is ready to answer.',
    lines: lines('Ready'),
    complete: true,
  };
}

export function deriveSteps(raw: SetupRaw): Record<StepKey, Step> {
  return {
    context: context(raw),
    availability: availability(raw),
    messaging: messaging(raw),
    agent: agent(raw),
  };
}

export function firstIncomplete(steps: Record<StepKey, Step>): StepKey | null {
  return STEP_ORDER.find((k) => !steps[k].complete) ?? null;
}
export const stepsLoading = (steps: Record<StepKey, Step>) =>
  STEP_ORDER.some((k) => steps[k].status === 'loading');
export const stepsAnyError = (steps: Record<StepKey, Step>) =>
  STEP_ORDER.some((k) => steps[k].status === 'error');
