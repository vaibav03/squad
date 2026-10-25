import {
  LIVE_PERSONAS,
  type LiveCitation,
  type LivePersonaId,
  type LiveSayBody,
  type LiveSnapshot,
  type LiveStartBody,
  type LiveStreamEvent,
  type LiveTakeaways,
  type LiveTurn,
} from '@squad/core';
import { LiveClientError, type LiveStreamHandlers, type LiveTransport } from './live-client';

/** Scripted discussion for `?livemock=1`, unit tests and a missing hub route. Always labelled Demo mode. */

export const MOCK_ID = 'ld_mock00000001';
export const MOCK_TOPIC = 'How do I split ch5 and ch6 before Friday exam?';

export const EMPTY_TAKEAWAYS: LiveTakeaways = {
  whereWeAre: 'Starting up.',
  decisions: [],
  disagreements: [],
  nextSteps: [],
  sources: [],
  quiz: [],
  grounding: 'general',
};

const CITE_A: LiveCitation = {
  file: 'ch6.pdf',
  page: 3,
  label: 'ch6.pdf p.3',
  quote: 'The expected waiting time for a pattern is found by writing one equation per state.',
};
const CITE_B: LiveCitation = {
  file: 'ch5.pdf',
  page: 7,
  label: 'ch5.pdf p.7',
  quote: 'Conditioning on the first outcome splits the sample space into disjoint cases.',
};

interface Scene {
  speaker: LivePersonaId;
  to?: LivePersonaId;
  text: string;
  citations?: LiveCitation[];
  /** takeaways after this turn is finished (turn ids resolved by position). */
  tk?: (n: number) => Partial<LiveTakeaways>;
}

export const MOCK_SCENES: Scene[] = [
  {
    speaker: 'chair',
    to: 'tutor',
    text: 'Welcome. The question is how to split chapters five and six before Friday. Tutor, start us with what each chapter is really about.',
    tk: () => ({ whereWeAre: 'Chair opened: how to split ch5 and ch6 before Friday.' }),
  },
  {
    speaker: 'tutor',
    to: 'skeptic',
    text: 'Chapter five is conditioning, chapter six is waiting times built on states. Six leans on five, so five comes first.',
    citations: [CITE_B],
    tk: (n) => ({
      whereWeAre: 'Tutor: chapter 6 builds on chapter 5.',
      sources: [{ ...CITE_B, turnId: `t${n}` }],
      grounding: 'course',
    }),
  },
  {
    speaker: 'skeptic',
    to: 'planner',
    text: 'Is that really true for the exam? Past papers lean on chapter six. Spending two days on five might waste time.',
    tk: (n) => ({
      whereWeAre: 'Open question: does chapter 5 deserve two days?',
      disagreements: [
        {
          id: 'd1',
          topic: 'Time on chapter 5',
          stances: [
            { who: 'Tutor', view: 'Chapter 5 first, it is the base.' },
            { who: 'Skeptic', view: 'Past papers weight chapter 6; cap chapter 5.' },
          ],
          why: 'Depends on how much of chapter 5 you already know.',
          turnId: `t${n}`,
        },
      ],
    }),
  },
  {
    speaker: 'planner',
    to: 'examiner',
    text: 'Compromise: one evening on chapter five basics, then three evenings on chapter six. Examiner, what would a test ask?',
    tk: (n) => ({
      whereWeAre: 'Planner proposes 1 evening on ch5, 3 on ch6.',
      nextSteps: [
        {
          id: 'n1',
          text: 'Review ch5 conditioning basics',
          owner: 'You',
          due: 'Tue evening',
          turnId: `t${n}`,
        },
      ],
    }),
  },
  {
    speaker: 'examiner',
    to: 'chair',
    text: 'Expect a state-machine waiting time problem, like the two heads in a row. That is chapter six, page three.',
    citations: [CITE_A],
    tk: (n) => ({
      sources: [
        { ...CITE_B, turnId: 't2' },
        { ...CITE_A, turnId: `t${n}` },
      ],
      quiz: [
        {
          id: 'q1',
          question: 'Write the state equations for waiting for two heads in a row.',
          turnId: `t${n}`,
        },
      ],
      nextSteps: [
        {
          id: 'n1',
          text: 'Review ch5 conditioning basics',
          owner: 'You',
          due: 'Tue evening',
          turnId: 't4',
        },
        {
          id: 'n2',
          text: 'Work three waiting-time problems from ch6',
          owner: 'You',
          due: 'Wed to Thu',
          turnId: `t${n}`,
        },
      ],
    }),
  },
  {
    speaker: 'chair',
    text: 'Decision: one evening on chapter five, then chapter six first for the rest. The disagreement about chapter five stays open until you check what you know.',
    tk: (n) => ({
      whereWeAre: 'Decided: 1 evening ch5, then ch6. Ch5 depth stays open.',
      decisions: [
        {
          id: 'dc1',
          text: 'One evening on ch5, then ch6 for the rest of the week.',
          turnId: `t${n}`,
        },
      ],
    }),
  },
];

const personaName = (id: string) => LIVE_PERSONAS.find((p) => p.id === id)?.name ?? id;

export function mockSnapshot(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    id: MOCK_ID,
    topic: MOCK_TOPIC,
    status: 'connecting',
    mode: 'captions',
    demo: true,
    audio: false,
    note: 'Scripted discussion, no live model.',
    personas: [...LIVE_PERSONAS],
    turns: [],
    takeaways: EMPTY_TAKEAWAYS,
    visibility: 'squad',
    askedBy: 'You',
    startedAt: 0,
    limits: { maxTurns: 24, maxSeconds: 600 },
    ...over,
  };
}

/** The finished snapshot of the whole script: used for card and read-mode fixtures. */
export function mockEndedSnapshot(topic = MOCK_TOPIC): LiveSnapshot {
  const turns: LiveTurn[] = [];
  let tk: LiveTakeaways = { ...EMPTY_TAKEAWAYS };
  MOCK_SCENES.forEach((s, i) => {
    turns.push({
      id: `t${i + 1}`,
      n: i + 1,
      speaker: s.speaker,
      ...(s.to ? { to: s.to } : {}),
      text: s.text,
      citations: s.citations ?? [],
      ts: 1_700_000_000_000 + i * 12_000,
    });
    if (s.tk) tk = { ...tk, ...s.tk(i + 1) };
  });
  return mockSnapshot({
    topic,
    status: 'ended',
    endReason: 'wrapped',
    turns,
    takeaways: tk,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_072_000,
  });
}

export interface MockOptions {
  /** ms per word (0 = flush instantly in tests). */
  wordMs?: number;
  /** ms pause between turns. */
  gapMs?: number;
  /** Replay a finished snapshot instead of the stock script. */
  replay?: LiveSnapshot;
}

/** Deterministic scripted transport. `say()` cuts the open turn, answers, then resumes the script. */
export function mockLiveTransport(opts: MockOptions = {}): LiveTransport {
  const wordMs = opts.wordMs ?? 80;
  const gapMs = opts.gapMs ?? 400;
  const scenes: Scene[] = opts.replay
    ? opts.replay.turns
        .filter((t) => t.speaker !== 'user')
        .map((t) => ({
          speaker: t.speaker as LivePersonaId,
          ...(t.to ? { to: t.to } : {}),
          text: t.text,
          citations: t.citations,
        }))
    : MOCK_SCENES;
  const base = opts.replay ?? mockSnapshot();
  let handlers: LiveStreamHandlers | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let next = 0; // next scene index
  let turnN = 0;
  let open: { id: string; speaker: LivePersonaId; text: string; to?: LivePersonaId } | null = null;
  let pendingWords: string[] = [];
  let pendingScene: Scene | null = null;
  const userQueue: { text: string; to?: LivePersonaId; kind: LiveSayBody['kind'] }[] = [];
  let taken: LiveTakeaways = EMPTY_TAKEAWAYS;
  const done: LiveTurn[] = [];

  const emit = (e: LiveStreamEvent) => handlers?.onEvent(e);
  const later = (ms: number, fn: () => void) => {
    clearTimeout(timer);
    if (ms <= 0) {
      timer = setTimeout(fn, 0);
    } else timer = setTimeout(fn, ms);
  };

  const finishTurn = () => {
    if (!open || !pendingScene) return;
    const t: LiveTurn = {
      id: open.id,
      n: Number(open.id.slice(1)),
      speaker: open.speaker,
      ...(open.to ? { to: open.to } : {}),
      text: pendingScene.text,
      citations: pendingScene.citations ?? [],
      ts: Date.now(),
    };
    done.push(t);
    emit({ k: 'turn', turn: t });
    if (pendingScene.tk && !opts.replay) {
      taken = { ...taken, ...pendingScene.tk(t.n) };
      emit({ k: 'takeaways', takeaways: taken });
    }
    open = null;
    pendingScene = null;
    later(gapMs, nextScene);
  };

  const streamWords = () => {
    if (!open) return;
    const w = pendingWords.shift();
    if (w === undefined) return finishTurn();
    const delta = (open.text ? ' ' : '') + w;
    open.text += delta;
    emit({ k: 'caption', turnId: open.id, speaker: open.speaker, delta });
    later(wordMs, streamWords);
  };

  const beginScene = (s: Scene) => {
    turnN += 1;
    pendingScene = s;
    open = { id: `t${turnN}`, speaker: s.speaker, text: '', ...(s.to ? { to: s.to } : {}) };
    pendingWords = s.text.split(' ');
    emit({ k: 'floor', speaker: s.speaker, ...(s.to ? { to: s.to } : {}) });
    streamWords();
  };

  const nextScene = () => {
    if (!handlers) return;
    const u = userQueue.shift();
    if (u) {
      const who: LivePersonaId =
        u.to ?? (u.kind === 'summarize' ? 'chair' : u.kind === 'disagree' ? 'skeptic' : 'tutor');
      const reply =
        u.kind === 'lost' || u.kind === 'simpler'
          ? 'Simply put: chapter five teaches you to split a problem into cases, chapter six reuses that to count waiting times.'
          : u.kind === 'summarize'
            ? `So far: one evening on chapter five, then chapter six first. ${done.length} turns in.`
            : u.kind === 'disagree'
              ? 'Fair push. I would want to see which chapter five questions you already get right before cutting it.'
              : `${personaName(who)} here. Good point, I will take that on board before we move on.`;
      emit({ k: 'floor', speaker: null, thinking: who });
      later(wordMs * 2, () => beginScene({ speaker: who, text: reply }));
      return;
    }
    const s = scenes[next++];
    if (!s) return end();
    emit({ k: 'floor', speaker: null, thinking: s.speaker });
    later(gapMs, () => beginScene(s));
  };

  const end = () => {
    emit({ k: 'floor', speaker: null });
    emit({ k: 'status', status: 'wrapping_up' });
    const snap = opts.replay
      ? { ...opts.replay, takeaways: opts.replay.takeaways }
      : mockSnapshot({
          status: 'ended',
          endReason: 'wrapped',
          turns: [...done],
          takeaways: taken,
          endedAt: Date.now(),
        });
    emit({ k: 'ended', reason: 'wrapped', snapshot: { ...snap, status: 'ended' } });
    handlers = null;
  };

  return {
    mock: true,
    start: async (b: LiveStartBody) => {
      void b;
      return {
        id: MOCK_ID,
        streamUrl: `/v1/live/${MOCK_ID}/stream`,
        resultUrl: `/v1/live/${MOCK_ID}`,
      };
    },
    get: async () => {
      if (opts.replay) return opts.replay;
      return mockEndedSnapshot();
    },
    open: (_id, h) => {
      handlers = h;
      next = 0;
      turnN = 0;
      taken = EMPTY_TAKEAWAYS;
      done.length = 0;
      const { endedAt: _e, endReason: _r, ...rest } = base;
      void _e;
      void _r;
      emit({
        k: 'snapshot',
        snapshot: { ...rest, status: 'live', turns: [], takeaways: EMPTY_TAKEAWAYS },
      });
      emit({ k: 'status', status: 'live' });
      later(gapMs, nextScene);
      return () => {
        clearTimeout(timer);
        handlers = null;
      };
    },
    say: async (_id, body) => {
      if (!handlers) throw new LiveClientError('not_found');
      const kind = body.kind ?? 'say';
      const text = body.text;
      if (open) {
        const cutId = open.id;
        const partial: LiveTurn = {
          id: cutId,
          n: Number(cutId.slice(1)),
          speaker: open.speaker,
          text: open.text,
          citations: [],
          ts: Date.now(),
          interrupted: true,
        };
        clearTimeout(timer);
        emit({ k: 'interrupted', turnId: cutId, by: 'user' });
        done.push(partial);
        emit({ k: 'turn', turn: partial });
        open = null;
        pendingScene = null;
        pendingWords = [];
      } else clearTimeout(timer);
      turnN += 1;
      const ut: LiveTurn = {
        id: `t${turnN}`,
        n: turnN,
        speaker: 'user',
        ...(body.to ? { to: body.to } : {}),
        text,
        citations: [],
        ts: Date.now(),
      };
      done.push(ut);
      emit({ k: 'turn', turn: ut });
      userQueue.push({ text, ...(body.to ? { to: body.to } : {}), kind });
      later(gapMs, nextScene);
    },
    stop: async () => {
      clearTimeout(timer);
      const snap = mockSnapshot({
        status: 'ended',
        endReason: 'user_left',
        turns: [...done],
        takeaways: taken,
        endedAt: Date.now(),
      });
      emit({ k: 'ended', reason: 'user_left', snapshot: snap });
      handlers = null;
    },
    postToChat: async () => ({ ok: true, ref: 'm_mock' }),
    makeQuiz: async () => ({ ok: true, ref: 'qz_mock', count: 5 }),
    addToPlan: async () => ({ ok: true, count: 2 }),
  };
}
