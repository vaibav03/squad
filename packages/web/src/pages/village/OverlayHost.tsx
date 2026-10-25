import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { OverlayEvent } from '@squad/village';
import { CallPanel } from '../../overlays/CallPanel';
import { ConfirmSheet } from '../../overlays/ConfirmSheet';
import { QuizCard } from '../../overlays/QuizCard';
import type {
  CallCaption,
  CallStatus,
  QuizPayload,
  QuizPhase,
  QuizResult,
} from '../../overlays/types';
import { callAgent } from './agents';
import { openHubCall, openStubCall, type CallSession } from './call-session';
import {
  answerQuiz,
  fetchQuiz,
  previewConfirm,
  resolveConfirm,
  userMessage,
  type ConfirmTarget,
  confirmErrorMessage,
  type HubCtx,
} from './hub';

export type OverlayMode = 'live' | 'replay';
interface Common {
  mode: OverlayMode;
  hub: HubCtx | null;
  calm?: boolean;
  returnFocusTo?: HTMLElement | null;
}
type Active = Extract<OverlayEvent, { type: 'openCall' | 'openQuiz' | 'openConfirm' }>;
export const isDomOverlay = (e: OverlayEvent): e is Active =>
  e.type === 'openCall' || e.type === 'openQuiz' || e.type === 'openConfirm';

/** Exit transitions need the node mounted for a beat after `open` flips; the world is told right away. */
const EXIT_MS = 320;
/** How long an `openCall` for an agent we just hung up on is treated as the echo of that same call. */
const ECHO_MS = 2500;
type Kind = 'call' | 'quiz' | 'confirm';
const kindOf = (a: Active): Kind =>
  a.type === 'openCall' ? 'call' : a.type === 'openQuiz' ? 'quiz' : 'confirm';

/**
 * Renders whichever DOM overlay the world asked for. World-agnostic: it only sees OverlayEvents. `onClosed` is the
 * host's cue to call `overlayClosed()` on the world handle (once per overlay). A `closeOverlay` event closes it from
 * the world side; a null event (world torn down) removes it at once.
 */
export function OverlayHost(
  props: Common & { event: OverlayEvent | null; onClosed: (kind: Kind) => void },
) {
  const { event, onClosed, ...common } = props;
  const [shown, setShown] = useState<Active | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef<{ shown: Active | null; open: boolean }>({ shown: null, open: false });
  const lastCall = useRef<{ agent: string; at: number } | null>(null);
  live.current.shown = shown;
  live.current.open = open;

  const close = useCallback(
    (report: boolean) => {
      const cur = live.current;
      if (!cur.shown || !cur.open) return; // idempotent: Esc during the confirm tick, double clicks, late timers
      cur.open = false;
      setOpen(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(null), EXIT_MS);
      if (cur.shown.type === 'openCall')
        lastCall.current = { agent: cur.shown.agent, at: Date.now() };
      if (report) onClosed(kindOf(cur.shown));
    },
    [onClosed],
  );

  useEffect(() => {
    const cur = live.current;
    if (!event) {
      clearTimeout(timer.current);
      cur.open = false;
      setOpen(false);
      setShown(null);
      return;
    }
    if (event.type === 'closeOverlay') {
      const which = (event as { which?: Kind | 'ledger' }).which;
      if (!which || (cur.shown && which === kindOf(cur.shown))) close(true);
      return;
    }
    if (!isDomOverlay(event)) return;
    if (event.type === 'openCall') {
      // Starting a call makes the hub emit `call.start`, which the world turns into another openCall for the same
      // agent (with the hub's call id). It is an echo: never open a second line for it, but release the bridge.
      if (cur.open && cur.shown?.type === 'openCall' && cur.shown.agent === event.agent) return;
      const last = lastCall.current;
      if (last && last.agent === event.agent && Date.now() - last.at < ECHO_MS) {
        onClosed('call');
        return;
      }
    }
    clearTimeout(timer.current);
    cur.open = true;
    setShown(event);
    setOpen(true);
  }, [event]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!shown) return null;
  const key =
    shown.type === 'openCall'
      ? shown.callId
      : shown.type === 'openQuiz'
        ? shown.quizId
        : shown.taskId;
  const done = () => close(true);
  if (shown.type === 'openCall')
    return <CallController key={key} ev={shown} open={open} onDone={done} {...common} />;
  if (shown.type === 'openQuiz')
    return <QuizController key={key} ev={shown} open={open} onDone={done} {...common} />;
  return <ConfirmController key={key} ev={shown} open={open} onDone={done} {...common} />;
}

// ---------------------------------------------------------------- call

interface CallView {
  status: CallStatus;
  captions: CallCaption[];
  speaking: 'agent' | 'you' | 'none';
  level: number;
  message?: string;
}
type CallAct =
  | { k: 'status'; s: CallStatus; message?: string }
  | { k: 'caption'; speaker: 'agent' | 'you'; text: string; cite?: CallCaption['cite'] }
  | { k: 'level'; n: number };
function callView(s: CallView, a: CallAct): CallView {
  if (a.k === 'status')
    return {
      ...s,
      status: a.s,
      message: a.message,
      ...(a.s === 'ended' || a.s === 'error' ? { speaking: 'none', level: 0 } : {}),
    };
  if (a.k === 'level') return { ...s, level: a.n };
  return {
    ...s,
    status: s.status === 'connecting' ? 'live' : s.status,
    speaking: a.speaker,
    captions: [
      ...s.captions,
      {
        id: `c${s.captions.length}`,
        speaker: a.speaker,
        text: a.text,
        ...(a.cite ? { cite: a.cite } : {}),
      },
    ],
  };
}

function CallController(
  props: Common & { ev: Extract<Active, { type: 'openCall' }>; open: boolean; onDone: () => void },
) {
  const { ev, open, onDone, mode, hub, calm, returnFocusTo } = props;
  const [v, dispatch] = useReducer(callView, {
    status: 'connecting',
    captions: [],
    speaking: 'none',
    level: 0,
  });
  const [muted, setMuted] = useState(true);
  const [hand, setHand] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const session = useRef<CallSession | null>(null);
  const agent = useMemo(() => callAgent(ev.agent), [ev.agent]);

  useEffect(() => {
    let dead = false;
    const sinks = {
      status: (s: CallStatus, message?: string) => !dead && dispatch({ k: 'status', s, message }),
      caption: (c: { speaker: 'agent' | 'you'; text: string; cite?: CallCaption['cite'] }) =>
        !dead && dispatch({ k: 'caption', ...c }),
      level: (n: number) => !dead && dispatch({ k: 'level', n }),
    };
    dispatch({ k: 'status', s: 'connecting' });
    // Start on the next tick so a StrictMode remount (or a quick close) never opens a second line on the hub.
    const start = setTimeout(() => {
      if (mode === 'live' && hub) {
        openHubCall(hub, ev.agent, sinks).then(
          (s) => {
            if (dead) s.leave();
            else session.current = s;
          },
          (e: unknown) =>
            sinks.status('error', userMessage(e, 'The call could not start. Try again.')),
        );
      } else session.current = openStubCall(ev.agent, sinks, ev.callId);
    }, 0);
    return () => {
      dead = true;
      clearTimeout(start);
      session.current?.leave();
      session.current = null;
    };
  }, [mode, hub, ev.agent, ev.callId, attempt]);

  useEffect(() => {
    if (v.status !== 'live') return;
    const t0 = Date.now() - elapsed;
    const id = setInterval(() => setElapsed(Date.now() - t0), 500);
    return () => clearInterval(id);
  }, [v.status]);

  // The world (or the host) closed the panel without the Leave button: hang up too.
  useEffect(() => {
    if (!open) session.current?.leave();
  }, [open]);

  const leave = () => {
    session.current?.leave();
    onDone();
  };
  return (
    <CallPanel
      open={open}
      onClose={leave}
      onLeave={leave}
      returnFocusTo={returnFocusTo}
      calm={calm}
      agent={agent}
      status={v.status}
      captions={v.captions}
      speaking={v.speaking}
      level={v.level}
      muted={muted}
      onMuteChange={(m) => {
        setMuted(m);
        session.current?.setMuted(m);
      }}
      handRaised={hand}
      onHandRaiseChange={(r) => {
        setHand(r);
        if (r) session.current?.raiseHand();
      }}
      elapsedMs={elapsed}
      message={v.message}
      onRetry={() => {
        dispatch({ k: 'status', s: 'connecting' });
        setElapsed(0);
        setAttempt((n) => n + 1);
      }}
    />
  );
}

// ---------------------------------------------------------------- quiz

const STUB_QUIZ: Record<string, QuizPayload> = {};
function stubQuiz(ev: { quizId: string; chapter: string }): QuizPayload {
  return (STUB_QUIZ[ev.quizId] ??= {
    quizId: ev.quizId,
    chapter: /^ch\d+$/i.test(ev.chapter) ? `Ch${ev.chapter.slice(2)}` : ev.chapter,
    question: 'A fair die is rolled twice. What is the probability that the sum is 7?',
    choices: [
      { id: 'a', label: '1/6' },
      { id: 'b', label: '1/12' },
      { id: 'c', label: '7/36' },
      { id: 'd', label: '1/36' },
    ],
  });
}

function QuizController(
  props: Common & { ev: Extract<Active, { type: 'openQuiz' }>; open: boolean; onDone: () => void },
) {
  const { ev, open, onDone, mode, hub, calm, returnFocusTo } = props;
  const [phase, setPhase] = useState<QuizPhase>('loading');
  const [quiz, setQuiz] = useState<QuizPayload>();
  const [result, setResult] = useState<QuizResult>();
  const [message, setMessage] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const failed = useRef<'load' | 'submit'>('load');

  useEffect(() => {
    let dead = false;
    setPhase('loading');
    if (mode === 'live' && hub) {
      fetchQuiz(hub, ev.quizId).then(
        (q) => !dead && (setQuiz(q), setPhase('answering')),
        (e: unknown) =>
          !dead &&
          ((failed.current = 'load'),
          setMessage(userMessage(e, 'The question did not load.')),
          setPhase('error')),
      );
    } else {
      const t = setTimeout(() => !dead && (setQuiz(stubQuiz(ev)), setPhase('answering')), 450);
      return () => {
        dead = true;
        clearTimeout(t);
      };
    }
    return () => {
      dead = true;
    };
  }, [mode, hub, ev, attempt]);

  const submit = async (a: { choice?: string; text?: string }) => {
    setPhase('submitting');
    try {
      if (mode === 'live' && hub) setResult(await answerQuiz(hub, ev.quizId, a));
      else {
        await new Promise((r) => setTimeout(r, 400));
        setResult({ recorded: true });
      }
      setPhase('done');
    } catch (e) {
      failed.current = 'submit';
      setMessage(userMessage(e, 'Your answer was not saved. Try again.'));
      setPhase('error');
    }
  };
  return (
    <QuizCard
      open={open}
      onClose={onDone}
      returnFocusTo={returnFocusTo}
      calm={calm}
      phase={phase}
      quiz={quiz}
      result={result}
      message={message}
      onRetry={() =>
        failed.current === 'submit' ? setPhase('answering') : setAttempt((n) => n + 1)
      }
      onSubmit={(a) => void submit(a)}
    />
  );
}

// ---------------------------------------------------------------- confirm

function ConfirmController(
  props: Common & {
    ev: Extract<Active, { type: 'openConfirm' }>;
    open: boolean;
    onDone: () => void;
  },
) {
  const { ev, open, onDone, mode, hub, calm, returnFocusTo } = props;
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string>();
  const [target, setTarget] = useState<ConfirmTarget>();
  const closer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closer.current), []);

  // Show what is being confirmed before the student answers, and answer for exactly that option.
  useEffect(() => {
    if (mode !== 'live' || !hub) return;
    let dead = false;
    previewConfirm(hub, ev.taskId, {
      question: ev.question,
      options: (ev as { options?: string[] }).options,
    }).then(
      (t) => !dead && setTarget(t),
      () => {},
    );
    return () => {
      dead = true;
    };
  }, [mode, hub, ev.taskId]);

  const choose = async (o: string, i: number) => {
    setPhase('submitting');
    try {
      if (mode === 'live' && hub) {
        const t = target ?? (await previewConfirm(hub, ev.taskId, { question: ev.question }));
        const picked = t.options && t.options.length > 0;
        if (picked) await resolveConfirm(hub, t, true, t.options![i] ?? o);
        else await resolveConfirm(hub, t, i === 0);
      } else await new Promise((r) => setTimeout(r, 350));
      setPhase('done');
      closer.current = setTimeout(onDone, 700);
    } catch (e) {
      setMessage(confirmErrorMessage(e));
      setPhase('error');
    }
  };
  return (
    <ConfirmSheet
      open={open}
      onClose={onDone}
      returnFocusTo={returnFocusTo}
      calm={calm}
      question={target?.question ?? ev.question}
      {...(target?.options?.length ? { options: target.options } : {})}
      details={
        target?.label
          ? [
              {
                label: 'Option',
                value: target.cost ? `${target.label}, about ${target.cost}` : target.label,
                tone: 'shared',
              },
            ]
          : undefined
      }
      phase={phase}
      message={message}
      onChoose={(o, i) => void choose(o, i)}
    />
  );
}
