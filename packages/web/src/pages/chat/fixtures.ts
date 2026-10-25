import {
  DEMO_NOTICE,
  type ChatAttachment,
  type ChatCitationExcerpt,
  type ChatMessage,
  type ChatSendBody,
  type ChatSummary,
  type ChatTyping,
  type ChatUpdate,
  type HubStatus,
} from '@squad/core';
import { ChatApiError, type ChatApi, type StreamHandlers, type StreamState } from './api';

/** A realistic in-memory ChatApi for the gallery, the dev flag (`?demo=fixtures`) and tests. */

export const ME = 's_ana';
export const GROUP_ID = 'group:sq_demo';
export const DM_ID = `dm:${ME}`;

const MIN = 60_000;
const NAMES: Record<string, string> = { s_ana: 'Ana', s_ben: 'Ben', s_chi: 'Chi', s_dev: 'Dev' };
const student = (id: string) => ({ kind: 'student' as const, id, name: NAMES[id] ?? id });
const cubbie = { kind: 'persona' as const, id: 'cubbie', name: 'Cubbie' };

/** Tiny worked-solution "Step Diff" picture as an SVG data URI (no network, no binary fixtures). */
const stepDiffSvg = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="#fbf9f3"/><g font-family="Menlo,monospace" font-size="20" fill="#0b1d38"><text x="28" y="48" font-size="14" fill="#56648a">STEP 1</text><text x="28" y="78">z = (x - mean) / sd</text><text x="28" y="124" font-size="14" fill="#56648a">STEP 2</text><text x="28" y="154">z = (82 - 70) / 6</text><rect x="20" y="186" width="440" height="40" fill="#fde2e5"/><text x="28" y="124" font-size="14" fill="#56648a" opacity="0"/><text x="28" y="214" fill="#b8283c">z = 12 / 6 = 3</text><text x="28" y="262" font-size="14" fill="#56648a">Step 3 has a slip: 82 - 70 is 12, so z is 2.</text></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/** A short silent WAV as a data URI so the audio player has real metadata in fixtures. */
export function silentWavUri(seconds = 42, rate = 8000): string {
  const n = seconds * rate;
  const bytes = new Uint8Array(44 + n).fill(128);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  str(36, 'data');
  dv.setUint32(40, n, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

export const EXCERPTS: Record<string, ChatCitationExcerpt> = {
  'ch6.pdf#4': {
    file: 'ch6.pdf',
    page: 4,
    chapter: 'Chapter 6',
    title: 'The normal distribution',
    excerpt:
      'A z-score tells you how many standard deviations a value sits above or below the mean. To standardize a value x, subtract the mean and divide by the standard deviation. A z-score of 0 is exactly average; a z-score of 2 is two standard deviations above it.',
  },
  'ch6.pdf#7': {
    file: 'ch6.pdf',
    page: 7,
    chapter: 'Chapter 6',
    title: 'Using z-scores to compare',
    excerpt:
      'Because z-scores are unitless, they let you compare values from different distributions, such as an exam score and a height.',
  },
};

export interface FixtureData {
  status: HubStatus;
  chats: ChatSummary[];
  messages: Record<string, ChatMessage[]>;
}

export function buildFixtures(now: number = Date.now(), demo = true): FixtureData {
  let seq = 0;
  const m = (
    chatId: string,
    ago: number,
    sender: ChatMessage['sender'],
    text: string,
    extra: Partial<ChatMessage> = {},
  ): ChatMessage => {
    seq += 1;
    return {
      id: `m_${seq}`,
      seq,
      chatId,
      ts: now - ago,
      sender,
      text,
      private: chatId.startsWith('dm:'),
      attachments: [],
      citations: [],
      demo: demo && sender.kind === 'persona',
      ...extra,
    };
  };
  const D = 24 * 60 * MIN;
  const att = (
    id: string,
    kind: ChatAttachment['kind'],
    mime: string,
    url: string,
    name: string,
  ): ChatAttachment => ({ id, kind, mime, url, name });

  const group: ChatMessage[] = [
    m(GROUP_ID, D + 3 * 60 * MIN, student('s_dev'), 'Exam is Thursday. Who has the ch6 notes?'),
    m(GROUP_ID, D + 3 * 60 * MIN - MIN, student('s_chi'), 'I can share mine tonight'),
    m(GROUP_ID, D + 3 * 60 * MIN - 2 * MIN, student('s_chi'), 'they are messy but complete'),
    m(GROUP_ID, 62 * MIN, student('s_ben'), 'I keep mixing up when to use a z-score'),
    m(GROUP_ID, 61 * MIN, student('s_ben'), 'Dev, you were saying it is just standardizing?'),
    m(GROUP_ID, 58 * MIN, student('s_ana'), '@cubbie what is a z-score?'),
    m(
      GROUP_ID,
      57 * MIN,
      cubbie,
      'A **z-score** says how many standard deviations a value is from the mean: subtract the mean, divide by the standard deviation [ch6.pdf p.4]. Because it has no units, you can compare values from different distributions [ch6.pdf p.7].\n\nA z-score of 0 is exactly average.',
      {
        citations: [
          { file: 'ch6.pdf', page: 4, label: 'ch6.pdf p.4' },
          { file: 'ch6.pdf', page: 7, label: 'ch6.pdf p.7' },
        ],
      },
    ),
    m(GROUP_ID, 40 * MIN, student('s_dev'), 'that helped, thanks'),
    m(GROUP_ID, 30 * MIN, student('s_chi'), '@cubbie quiz me on ch6'),
    m(GROUP_ID, 29 * MIN, cubbie, 'Question 1 of 3', {
      card: {
        type: 'quiz',
        index: 0,
        input: 'choice',
        question:
          'A student scores 82 on a test with mean 70 and standard deviation 6. What is the z-score?',
        choices: [
          { id: 'A', text: '0.5' },
          { id: 'B', text: '2' },
          { id: 'C', text: '12' },
          { id: 'D', text: '6' },
        ],
      },
    }),
    m(GROUP_ID, 20 * MIN, student('s_dev'), '@cubbie podcast ch3'),
    m(GROUP_ID, 19 * MIN, cubbie, 'Here is a short audio recap of chapter 3. About 40 seconds.', {
      attachments: [att('a_pod', 'audio', 'audio/mp4', silentWavUri(), 'ch3-recap.m4a')],
    }),
  ];

  const dm: ChatMessage[] = [
    m(DM_ID, 55 * MIN, student('s_ana'), 'am I behind?'),
    m(
      DM_ID,
      55 * MIN - 20_000,
      cubbie,
      'A little. You have covered chapters 1 to 5; chapter 6 is next and it is on Thursday. About 40 minutes would catch you up.',
    ),
    m(DM_ID, 18 * MIN, cubbie, 'Want me to book a 40 minute study block tomorrow at 4 pm?', {
      card: {
        type: 'confirm',
        taskId: 'task_study_block',
        question: 'Book a 40 minute study block tomorrow at 4 pm?',
        options: ['Yes, book it', 'Pick another time', 'Not now'],
        status: 'pending',
      },
    }),
    m(DM_ID, 8 * MIN, student('s_ana'), 'Can you check my working?', {
      attachments: [att('a_diff', 'image', 'image/svg+xml', stepDiffSvg(), 'working.png')],
    }),
    m(
      DM_ID,
      7 * MIN,
      cubbie,
      'Step 3 is where it slips: 82 minus 70 is 12, and 12 divided by 6 is **2**, not 3. Everything before that is right.',
    ),
  ];

  const lastOf = (list: ChatMessage[]) => {
    const l = list[list.length - 1]!;
    return {
      text: l.text,
      ts: l.ts,
      senderName: l.sender.kind === 'system' ? 'Squad' : l.sender.name,
      seq: l.seq,
    };
  };
  const chats: ChatSummary[] = [
    {
      id: GROUP_ID,
      kind: 'group',
      title: 'Stats squad',
      subtitle: 'Ana, Ben, Chi, Dev and Cubbie',
      private: false,
      members: ['s_ana', 's_ben', 's_chi', 's_dev'].map((id) => ({ id, name: NAMES[id]! })),
      last: lastOf(group),
    },
    {
      id: DM_ID,
      kind: 'dm',
      title: 'Cubbie',
      subtitle: 'Only you can see this',
      private: true,
      members: [{ id: ME, name: 'Ana' }],
      last: lastOf(dm),
    },
  ];
  return {
    status: demo
      ? { llm: 'fake', tts: 'none', demo: true, notice: DEMO_NOTICE }
      : { llm: 'gemini', tts: 'elevenlabs', demo: false },
    chats,
    messages: { [GROUP_ID]: group, [DM_ID]: dm },
  };
}

export interface FakeChatOptions {
  me?: string;
  demo?: boolean;
  /** ms of fake network latency (0 for tests) */
  latency?: number;
  /** start with no messages */
  empty?: boolean;
  now?: number;
  /** let the fake bot reply to messages */
  bot?: boolean;
  /** how long the fake bot "thinks" before answering */
  thinkMs?: number;
}

export interface FakeChatApi extends ChatApi {
  /** the next send() rejects with this status */
  failNextSend(status?: number): void;
  setStream(state: StreamState): void;
  pushMessage(m: Omit<ChatMessage, 'id' | 'seq'>): ChatMessage;
  pushUpdate(u: ChatUpdate): void;
  pushTyping(t: ChatTyping): void;
  resync(): void;
  sent: ChatSendBody[];
  data: FixtureData;
  failChats: boolean;
}

export function createFakeChatApi(o: FakeChatOptions = {}): FakeChatApi {
  const me = o.me ?? ME;
  const latency = o.latency ?? 0;
  const data = buildFixtures(o.now, o.demo ?? true);
  if (o.empty) {
    data.messages = { [GROUP_ID]: [], [DM_ID]: [] };
    data.chats = data.chats.map((c) => ({ ...c, last: undefined }));
  }
  let seq = Math.max(
    0,
    ...Object.values(data.messages)
      .flat()
      .map((x) => x.seq),
  );
  const subs = new Set<StreamHandlers>();
  const uploads = new Map<string, ChatAttachment>();
  let failStatus: number | null = null;
  const wait = <T>(v: T): Promise<T> =>
    latency ? new Promise((r) => setTimeout(() => r(v), latency)) : Promise.resolve(v);

  const updateLast = (m: ChatMessage) => {
    data.chats = data.chats.map((c) =>
      c.id === m.chatId
        ? {
            ...c,
            last: {
              text: m.text,
              ts: m.ts,
              seq: m.seq,
              senderName: m.sender.kind === 'system' ? 'Squad' : m.sender.name,
            },
          }
        : c,
    );
  };
  const push = (partial: Omit<ChatMessage, 'id' | 'seq'>): ChatMessage => {
    seq += 1;
    const msg: ChatMessage = { ...partial, id: `m_${seq}`, seq };
    (data.messages[msg.chatId] ??= []).push(msg);
    updateLast(msg);
    subs.forEach((h) => h.onMessage(msg));
    return msg;
  };
  const reply = (chatId: string, text: string, extra: Partial<ChatMessage> = {}) =>
    push({
      chatId,
      ts: Date.now(),
      sender: cubbie,
      text,
      private: chatId.startsWith('dm:'),
      attachments: [],
      citations: [],
      demo: o.demo ?? true,
      ...extra,
    });
  const typing = (chatId: string, on: boolean) =>
    subs.forEach((h) => h.onTyping({ chatId, personaId: 'cubbie', name: 'Cubbie', on }));

  const bot = (body: ChatSendBody) => {
    if (o.bot === false) return;
    const dm = body.chatId.startsWith('dm:');
    const t = body.text.trim();
    const confirmCard = (data.messages[body.chatId] ?? []).find(
      (x) => x.card?.type === 'confirm' && x.card.status === 'pending',
    );
    if (dm && confirmCard && /^[1-9]$/.test(t) && confirmCard.card?.type === 'confirm') {
      const opts = confirmCard.card.options;
      const answer = opts[Number(t) - 1] ?? opts[0]!;
      confirmCard.card = { ...confirmCard.card, status: 'answered', answer };
      setTimeout(
        () =>
          subs.forEach((h) =>
            h.onUpdate({ chatId: body.chatId, messageId: confirmCard.id, card: confirmCard.card! }),
          ),
        latency + 200,
      );
      return;
    }
    if (!dm && /^(@cubbie\s+)?[A-D]$/i.test(t)) {
      setTimeout(
        () =>
          reply(
            `dm:${me}`,
            t.toUpperCase().endsWith('B')
              ? 'Question 1: yes, 2 is right. (82 - 70) / 6 = 2.'
              : 'Question 1: not quite. Subtract the mean first: (82 - 70) / 6 = 2.',
          ),
        latency + 400,
      );
      return;
    }
    const addressed = dm || /(^|\W)@(cubbie|squad)\b/i.test(t) || body.attachments?.length;
    if (!addressed) return;
    const think = o.thinkMs ?? 900;
    setTimeout(() => typing(body.chatId, true), latency + 150);
    setTimeout(() => {
      typing(body.chatId, false);
      reply(
        body.chatId,
        dm
          ? 'Got it. I looked at your notes: you are on track for Thursday.'
          : 'Good question. Here is the short version: a z-score is the distance from the mean in standard deviations [ch6.pdf p.4].',
        dm ? {} : { citations: [{ file: 'ch6.pdf', page: 4, label: 'ch6.pdf p.4' }] },
      );
    }, latency + think);
  };

  const api: FakeChatApi = {
    sent: [],
    data,
    failChats: false,
    status: () => wait(data.status),
    chats: () =>
      api.failChats ? Promise.reject(new ChatApiError(0)) : wait(structuredClone(data.chats)),
    history: (chatId, opts = {}) => {
      const all = data.messages[chatId];
      if (!all) return Promise.reject(new ChatApiError(403, 'forbidden'));
      const limit = opts.limit ?? 50;
      const pool = opts.before ? all.filter((x) => x.seq < opts.before!) : all;
      const slice = pool.slice(-limit);
      return wait({ messages: structuredClone(slice), hasMore: pool.length > slice.length });
    },
    send: async (body) => {
      api.sent.push(body);
      if (failStatus !== null) {
        const s = failStatus;
        failStatus = null;
        await wait(0);
        throw new ChatApiError(s, s === 429 ? 'rate_limited' : undefined);
      }
      await wait(0);
      const attachments = (body.attachments ?? []).flatMap((a) => uploads.get(a.id) ?? []);
      const msg = push({
        chatId: body.chatId,
        ts: Date.now(),
        sender: student(me),
        text: body.text,
        private: body.chatId.startsWith('dm:'),
        attachments,
        citations: [],
        demo: false,
      });
      bot(body);
      return structuredClone(msg);
    },
    upload: async (file) => {
      await wait(0);
      const att: ChatAttachment = {
        id: `up_${uploads.size + 1}`,
        kind: 'image',
        mime: file.type || 'image/png',
        name: file.name,
        bytes: file.size,
        url: stepDiffSvg(),
      };
      uploads.set(att.id, att);
      return att;
    },
    citation: async (file, page) => {
      const e = EXCERPTS[`${file}#${page}`];
      if (!e) throw new ChatApiError(404, 'not_found');
      return wait(e);
    },
    fileUrl: (a) => a.url,
    subscribe(h) {
      subs.add(h);
      queueMicrotask(() => h.onState('live'));
      return () => void subs.delete(h);
    },
    failNextSend: (status = 500) => void (failStatus = status),
    setStream: (s) => subs.forEach((h) => h.onState(s)),
    pushMessage: push,
    pushUpdate: (u) => subs.forEach((h) => h.onUpdate(u)),
    pushTyping: (t) => subs.forEach((h) => h.onTyping(t)),
    resync: () => subs.forEach((h) => h.onResync(seq)),
  };
  return api;
}

/**
 * Dev-only scenarios for screenshots: `/squad/chat?demo=fixtures&fx=empty|real|loading|error|expired|offline`.
 * The page only calls this when `import.meta.env.DEV`.
 */
export function fixtureApiFor(fx: string | null): FakeChatApi {
  const api = createFakeChatApi({
    latency: fx === 'loading' ? 600_000 : 120,
    empty: fx === 'empty',
    demo: fx !== 'real',
  });
  if (fx === 'error') api.failChats = true;
  if (fx === 'expired') api.chats = () => Promise.reject(new ChatApiError(401));
  return api;
}
