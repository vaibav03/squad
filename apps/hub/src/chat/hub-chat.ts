// The chat core inside the hub: persistence, per-viewer fan-out, typing, rate limit, and the leak guard for bot output.
// The bot engine (router + skills over the web Transport) attaches through `setEngine`, see engine.ts.
import { findLeak, SENTINELS } from '@squad/core';
import type {
  ChatAttachment,
  ChatCard,
  ChatCitation,
  ChatMessage,
  ChatSendBody,
  ChatSummary,
  ChatTyping,
  ChatUpdate,
} from '@squad/core';
import type { HubDeps, Viewer } from '../types';
import { canAccessChat, chatIdsOf, dmChatId, groupChatId } from './access';
import { createChatFiles, type ChatFiles } from './files';
import { createChatStore, type ChatStore } from './store';

export interface BotPost {
  chatId: string;
  personaId: string;
  personaName: string;
  emoji?: string;
  text: string;
  citations: ChatCitation[];
  attachments: { path: string; mime: string }[];
  card?: ChatCard;
}

export interface ChatEngine {
  /** Run a student's message through the router. Resolves when the router is done with it. */
  inject(m: {
    chatId: string;
    from: string;
    text: string;
    attachments: { path: string; mime: string }[];
  }): Promise<void>;
  /** Would this message get an answer (mention or DM)? Used for the typing indicator. */
  mentions(text: string, chatId: string): boolean;
  /** The page text a citation was verified against. */
  excerpt(
    file: string,
    page: number,
  ): { chapter?: string; title?: string; text: string } | undefined;
  stop?(): Promise<void> | void;
}

export type ChatWire =
  | { event: 'chat.message'; id: number; data: ChatMessage }
  | { event: 'chat.update'; data: ChatUpdate }
  | { event: 'chat.typing'; data: ChatTyping }
  | { event: 'chat.resync'; data: { seq: number } };

export interface ChatSub {
  readonly events: AsyncIterable<ChatWire>;
  close(): void;
}

export type SendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; status: 400 | 403 | 404 | 429 | 503; code: string };

export interface ChatHub {
  store: ChatStore;
  files: ChatFiles;
  engine?: ChatEngine;
  setEngine(e: ChatEngine): void;
  subscribe(viewer: Viewer, afterSeq?: number): ChatSub;
  send(viewer: Viewer, body: ChatSendBody): Promise<SendResult>;
  postBot(p: BotPost): ChatMessage | undefined;
  resolveConfirm(student: string, taskId: string, answer: string): void;
  summaries(viewer: Viewer): ChatSummary[];
  count(): number;
  close(): void;
}

const RATE_PER_MIN = 30;
const TYPING_MAX_MS = 45_000;
const MAX_QUEUE = 256;
const PRIVATE_FALLBACK = 'I kept that private. Ask me in a DM.';

class Sub implements ChatSub {
  private queue: ChatWire[] = [];
  private waiter: ((r: IteratorResult<ChatWire>) => void) | null = null;
  private closed = false;
  constructor(
    readonly viewer: Viewer,
    private readonly onClose: (s: Sub) => void,
  ) {}
  push(w: ChatWire): void {
    if (this.closed) return;
    if (this.waiter) {
      const r = this.waiter;
      this.waiter = null;
      r({ value: w, done: false });
    } else if (this.queue.length >= MAX_QUEUE) this.close();
    else this.queue.push(w);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.onClose(this);
    if (this.waiter) {
      const r = this.waiter;
      this.waiter = null;
      r({ value: undefined, done: true });
    }
  }
  readonly events: AsyncIterable<ChatWire> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const v = this.queue.shift();
        if (v) return Promise.resolve({ value: v, done: false as const });
        if (this.closed) return Promise.resolve({ value: undefined, done: true as const });
        return new Promise<IteratorResult<ChatWire>>((res) => {
          this.waiter = res;
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true as const });
      },
    }),
  };
}

export function createChatHub(
  deps: Pick<HubDeps, 'db' | 'directory' | 'ledger' | 'log' | 'now' | 'config' | 'runtime'>,
  filesDir: string,
): ChatHub {
  const store = createChatStore(deps.db);
  const files = createChatFiles(deps.db, filesDir, deps.now);
  const subs = new Set<Sub>();
  const rate = new Map<string, number[]>();
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const typingCount = new Map<string, number>();
  /** Replies are labelled demo whenever the hub's runtime says the real model is not answering. */
  const isDemo = () => (deps.runtime ? deps.runtime.llm().llm !== 'real' : true);

  /** The ONE fan-out: nobody gets an item for a chat they cannot access. */
  const fan = (chatId: string, w: ChatWire) => {
    for (const s of [...subs]) if (canAccessChat(s.viewer, chatId)) s.push(w);
  };
  const publish = (m: ChatMessage) => fan(m.chatId, { event: 'chat.message', id: m.seq, data: m });

  const nameOf = (id: string) => deps.directory.student(id)?.name ?? id;

  function typing(chatId: string, personaId: string, name: string, on: boolean) {
    const key = `${chatId}|${personaId}`;
    const n = Math.max(0, (typingCount.get(key) ?? 0) + (on ? 1 : -1));
    typingCount.set(key, n);
    const clear = () => {
      const t = typingTimers.get(key);
      if (t) clearTimeout(t);
      typingTimers.delete(key);
    };
    if (on) {
      if (n === 1)
        fan(chatId, { event: 'chat.typing', data: { chatId, personaId, name, on: true } });
      clear();
      const t = setTimeout(() => {
        typingCount.set(key, 0);
        typingTimers.delete(key);
        fan(chatId, { event: 'chat.typing', data: { chatId, personaId, name, on: false } });
      }, TYPING_MAX_MS);
      t.unref?.();
      typingTimers.set(key, t);
    } else if (n === 0) {
      clear();
      fan(chatId, { event: 'chat.typing', data: { chatId, personaId, name, on: false } });
    }
  }

  const hub: ChatHub = {
    store,
    files,
    setEngine(e) {
      hub.engine = e;
    },
    subscribe(viewer, afterSeq) {
      const sub = new Sub(viewer, (s) => subs.delete(s));
      if (afterSeq !== undefined) {
        // backlog and live registration are synchronous: no gap, no duplicate
        if (afterSeq > store.lastSeq())
          sub.push({ event: 'chat.resync', data: { seq: store.lastSeq() } });
        else
          for (const m of store.since(afterSeq, chatIdsOf(viewer)))
            sub.push({ event: 'chat.message', id: m.seq, data: m });
      }
      subs.add(sub);
      return sub;
    },
    async send(viewer, body) {
      if (!canAccessChat(viewer, body.chatId)) return { ok: false, status: 403, code: 'forbidden' };
      const text = body.text.trim();
      if (!text && !(body.attachments?.length ?? 0))
        return { ok: false, status: 400, code: 'invalid' };
      const t = deps.now();
      const recent = (rate.get(viewer.studentId) ?? []).filter((x) => t - x < 60_000);
      if (recent.length >= RATE_PER_MIN) return { ok: false, status: 429, code: 'rate_limited' };
      recent.push(t);
      rate.set(viewer.studentId, recent);

      let attachments: ChatAttachment[] = [];
      let paths: { path: string; mime: string }[] = [];
      if (body.attachments?.length) {
        const c = files.claim(
          viewer.studentId,
          body.attachments.map((a) => a.id),
          body.chatId,
        );
        if (!c) return { ok: false, status: 404, code: 'unknown_attachment' };
        attachments = c.attachments;
        paths = c.paths;
      }
      const message = store.append({
        chatId: body.chatId,
        ts: t,
        sender: { kind: 'student', id: viewer.studentId, name: nameOf(viewer.studentId) },
        text,
        private: body.chatId.startsWith('dm:'),
        attachments,
        citations: [],
        demo: false,
      });
      publish(message);

      const engine = hub.engine;
      if (engine) {
        const answers = engine.mentions(text, body.chatId);
        const run = async () => {
          if (answers) typing(body.chatId, 'cubbie', 'Cubbie', true);
          try {
            await engine.inject({
              chatId: body.chatId,
              from: viewer.studentId,
              text,
              attachments: paths,
            });
          } catch (e) {
            deps.log.error('chat inject failed', { err: (e as Error).name });
          } finally {
            if (answers) typing(body.chatId, 'cubbie', 'Cubbie', false);
          }
        };
        void run();
      }
      return { ok: true, message };
    },
    postBot(p) {
      if (!/^(group|dm):[A-Za-z0-9_-]{1,64}$/.test(p.chatId)) return undefined;
      const isGroup = p.chatId.startsWith('group:');
      let { text } = p;
      let card = p.card;
      let citations = p.citations;
      let paths = p.attachments;
      if (isGroup) {
        // Defense in depth: a group message must never carry a private ledger value or a sentinel.
        const secrets = [...SENTINELS, ...deps.ledger.privateValues()];
        if (findLeak({ text, card, citations }, secrets)) {
          deps.log.warn('chat: group reply withheld by leak guard', { chatId: p.chatId });
          text = PRIVATE_FALLBACK;
          card = undefined;
          citations = [];
          paths = [];
        }
      }
      const attachments = paths.flatMap((a) => files.adopt(a.path, a.mime, p.chatId) ?? []);
      if (!text && attachments.length === 0 && !card) return undefined;
      const m = store.append({
        chatId: p.chatId,
        ts: deps.now(),
        sender: {
          kind: 'persona',
          id: p.personaId,
          name: p.personaName,
          ...(p.emoji ? { emoji: p.emoji } : {}),
        },
        text,
        private: !isGroup,
        attachments,
        citations,
        ...(card ? { card } : {}),
        demo: isDemo(),
      });
      publish(m);
      return m;
    },
    resolveConfirm(student, taskId, answer) {
      const chatId = dmChatId(student);
      const m = store.findConfirm(chatId, taskId);
      if (!m || m.card?.type !== 'confirm') return;
      const card: ChatCard = {
        ...m.card,
        status: answer === 'timeout' ? 'timeout' : 'answered',
        ...(answer === 'timeout' ? {} : { answer }),
      };
      store.updateCard(m.id, card);
      fan(chatId, { event: 'chat.update', data: { chatId, messageId: m.id, card } });
    },
    summaries(viewer) {
      const members = deps.directory.members(viewer.squadId);
      const group = groupChatId(viewer.squadId);
      const dm = dmChatId(viewer.studentId);
      const last = (id: string): ChatSummary['last'] => {
        const m = store.last(id);
        return m
          ? {
              text: m.text || (m.attachments[0] ? `[${m.attachments[0].kind}]` : ''),
              ts: m.ts,
              senderName: m.sender.name,
              seq: m.seq,
            }
          : undefined;
      };
      const count = deps.directory.visibleMemberCount(viewer.squadId);
      const lg = last(group);
      const ld = last(dm);
      return [
        {
          id: group,
          kind: 'group',
          title: deps.directory.squad(viewer.squadId)?.name ?? 'Squad',
          ...(count !== null ? { subtitle: `${count} members and Cubbie` } : {}),
          private: false,
          members: members.map((s) => ({ id: s.id, name: s.name })),
          ...(lg ? { last: lg } : {}),
        },
        {
          id: dm,
          kind: 'dm',
          title: 'Cubbie',
          subtitle: 'Only you and Cubbie',
          private: true,
          members: [{ id: viewer.studentId, name: nameOf(viewer.studentId) }],
          ...(ld ? { last: ld } : {}),
        },
      ];
    },
    count: () => subs.size,
    close() {
      void hub.engine?.stop?.();
      for (const s of [...subs]) s.close();
      for (const t of typingTimers.values()) clearTimeout(t);
      typingTimers.clear();
    },
  };
  return hub;
}
