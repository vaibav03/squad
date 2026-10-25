// The chat core inside the hub: persistence, per-viewer fan-out, typing, rate limit, and the leak guard for bot output.
// The bot engine (router + skills over the web Transport) attaches through `setEngine`, see engine.ts.
import { AsyncLocalStorage } from 'node:async_hooks';
import { composeProvenance, findLeak, SENTINELS } from '@squad/core';
import type {
  ChatAttachment,
  ChatCard,
  ChatCitation,
  ChatMessage,
  ChatSender,
  ChatSendBody,
  ChatSyncFields,
  ChatSummary,
  ProvenanceHint,
  ProvenanceMode,
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
  /** What the skill knows about where the reply came from when it has no citations (docs/provenance.md). */
  provenance?: ProvenanceHint;
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
  | { event: 'chat.resync'; data: { seq: number } }
  /** Additive (iMessage sync): a message's delivery state or other sync fields changed. */
  | {
      event: 'chat.sync';
      data: { chatId: string; messageId: string; patch: Partial<ChatSyncFields> };
    };

export interface ChatSub {
  readonly events: AsyncIterable<ChatWire>;
  close(): void;
}

/** Where an inbound message really came from (the iMessage bridge). `ts` is the origin's own message time. */
export type ChatOrigin = Partial<ChatSyncFields> & { ts?: number };

export type SendResult =
  /** `duplicate` is set when nothing new was stored: a retry of a landed send, or the same text again within 3 s. */
  | { ok: true; message: ChatMessage; duplicate?: true; hint?: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429 | 503; code: string };

export interface ChatHub {
  store: ChatStore;
  files: ChatFiles;
  engine?: ChatEngine;
  setEngine(e: ChatEngine): void;
  subscribe(viewer: Viewer, afterSeq?: number): ChatSub;
  /** `via` names the channel a student message came from ('web' by default; the iMessage bridge passes 'imessage'). */
  send(
    viewer: Viewer,
    body: ChatSendBody,
    o?: { via?: string; origin?: ChatOrigin },
  ): Promise<SendResult>;
  /**
   * Store and stream a message that came from another surface and must NOT go to the bot (context from a sender who is
   * not a linked squad member, or an old message found by backfill). Group chats only.
   */
  postExternal(p: {
    chatId: string;
    sender: ChatSender;
    text: string;
    origin: ChatOrigin;
    attachments?: ChatAttachment[];
  }): ChatMessage | undefined;
  /** Merge sync fields into a stored message and tell its viewers. */
  annotate(id: string, patch: Partial<ChatSyncFields>): ChatMessage | undefined;
  postBot(p: BotPost): ChatMessage | undefined;
  /** Observe every stored bot message (after the leak guard), e.g. to mirror it to iMessage. Returns an unsubscribe. */
  onBotPost(fn: (m: ChatMessage) => void): () => void;
  /** Observe every stored student message with the channel it came from. */
  onStudentMessage(fn: (m: ChatMessage, via: string) => void): () => void;
  resolveConfirm(student: string, taskId: string, answer: string): void;
  summaries(viewer: Viewer): ChatSummary[];
  count(): number;
  close(): void;
}

const RATE_PER_MIN = 30;
const TYPING_MAX_MS = 45_000;
const MAX_QUEUE = 256;
const MAX_BACKLOG = 200; // a longer catch-up is a resync, not a replay
const MAX_STREAMS_PER_STUDENT = 3;
const MAX_INFLIGHT = 2; // bot runs per student at once
const CLIENT_ID_TTL_MS = 5 * 60_000;
/** The same text from the same sender in the same chat inside this window is a double-click, not a second ask. */
export const DOUBLE_SEND_MS = 3_000;
const DOUBLE_SEND_MIN_CHARS = 8; // "1", "yes", "A" are legitimate quick repeats (confirm and quiz answers)
export const DUPLICATE_HINT = 'You already sent this';
const PRIVATE_FALLBACK = 'I kept that private. Ask me in a DM.';

const squash = (t: string) =>
  t
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
/** Exact (case-insensitive) match, plus a punctuation/spacing-insensitive match for values long enough to be unambiguous. */
function leaks(value: unknown, secrets: readonly string[]): boolean {
  if (findLeak(value, secrets)) return true;
  const flat = squash(JSON.stringify(value) ?? '');
  return secrets.some((x) => {
    const q = squash(x);
    return q.length >= 6 && flat.includes(q);
  });
}

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
  deps: Pick<HubDeps, 'db' | 'directory' | 'ledger' | 'log' | 'now' | 'config' | 'runtime'> &
    Partial<Pick<HubDeps, 'tripSvc' | 'context' | 'council'>>,
  filesDir: string,
): ChatHub {
  const store = createChatStore(deps.db);
  store.expirePendingConfirms(); // the bot dropped its pending confirms with the old process
  const files = createChatFiles(deps.db, filesDir, deps.now);
  const subs = new Set<Sub>();
  const rate = new Map<string, number[]>();
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const typingRuns = new Map<string, Set<number>>();
  const inflight = new Map<string, number>();
  const clientIds = new Map<string, { at: number; message: ChatMessage }>();
  const lastSent = new Map<string, { at: number; text: string; message: ChatMessage }>();
  /** The student message whose bot turn is running: every bot post made inside it is that message's answer. */
  const trigger = new AsyncLocalStorage<{ id: string }>();
  let runSeq = 0;
  const botListeners = new Set<(m: ChatMessage) => void>();
  const studentListeners = new Set<(m: ChatMessage, via: string) => void>();
  const notify = <A extends unknown[]>(set: Set<(...a: A) => void>, ...a: A) => {
    for (const fn of [...set])
      try {
        fn(...a);
      } catch (e) {
        deps.log.error('chat listener failed', { err: (e as Error).name });
      }
  };
  /** Channel of the latest student message per chat: a bot reply travels back the way the question came. */
  const lastVia = new Map<string, 'web' | 'imessage'>();
  /**
   * Live: the real model answers and the ports are real. Degraded: the real model answers but part of the stack is
   * stubbed or the model reported a problem. Demo: the scripted model is answering.
   */
  const provMode = (): ProvenanceMode => {
    const rt = deps.runtime;
    if (!rt) return 'demo';
    const st = rt.llm();
    if (st.llm !== 'real') return 'demo';
    return st.reason || rt.ports() === 'stub' ? 'degraded' : 'live';
  };
  /** A citation is verified when the page exists in the course store or the synced source exists. */
  const verifyCitation = (c: ChatCitation): boolean => {
    try {
      if (c.source) return !!deps.context?.store.source(c.source.id);
      return !!hub.engine?.excerpt(c.file, c.page);
    } catch {
      return false;
    }
  };
  /** Replies are labelled demo whenever the hub's runtime says the real model is not answering. */
  const isDemo = () => (deps.runtime ? deps.runtime.llm().llm !== 'real' : true);

  /** The ONE fan-out: nobody gets an item for a chat they cannot access. */
  const fan = (chatId: string, w: ChatWire) => {
    for (const s of [...subs]) if (canAccessChat(s.viewer, chatId)) s.push(w);
  };
  const publish = (m: ChatMessage) => fan(m.chatId, { event: 'chat.message', id: m.seq, data: m });

  const nameOf = (id: string) => deps.directory.student(id)?.name ?? id;

  /** A run is one bot turn. The indicator is on while any run is open; a late `off` of a timed-out run is harmless. */
  function typingStart(chatId: string, personaId: string, name: string): () => void {
    const key = `${chatId}|${personaId}`;
    const id = ++runSeq;
    const runs = typingRuns.get(key) ?? new Set<number>();
    typingRuns.set(key, runs);
    const wasOff = runs.size === 0;
    runs.add(id);
    if (wasOff) fan(chatId, { event: 'chat.typing', data: { chatId, personaId, name, on: true } });
    const off = () => {
      const open = typingRuns.get(key);
      if (!open?.delete(id)) return; // already ended (timer): do not touch a newer run
      if (open.size === 0) {
        const t = typingTimers.get(key);
        if (t) clearTimeout(t);
        typingTimers.delete(key);
        fan(chatId, { event: 'chat.typing', data: { chatId, personaId, name, on: false } });
      }
    };
    const prev = typingTimers.get(key);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      typingTimers.delete(key);
      const open = typingRuns.get(key);
      if (open && open.size > 0) {
        open.clear();
        fan(chatId, { event: 'chat.typing', data: { chatId, personaId, name, on: false } });
      }
    }, TYPING_MAX_MS);
    t.unref?.();
    typingTimers.set(key, t);
    return off;
  }

  const hub: ChatHub = {
    store,
    files,
    setEngine(e) {
      hub.engine = e;
    },
    subscribe(viewer, afterSeq) {
      // at most N live streams per student: the oldest one is closed
      const mine = [...subs].filter((x) => x.viewer.studentId === viewer.studentId);
      while (mine.length >= MAX_STREAMS_PER_STUDENT) mine.shift()?.close();
      const sub = new Sub(viewer, (x) => subs.delete(x));
      subs.add(sub); // registered before the backlog: nothing can slip between replay and live
      if (afterSeq !== undefined) {
        const last = store.lastSeq();
        const backlog = afterSeq > last ? [] : store.since(afterSeq, chatIdsOf(viewer));
        if (afterSeq > last || backlog.length > MAX_BACKLOG)
          sub.push({ event: 'chat.resync', data: { seq: last } });
        else for (const m of backlog) sub.push({ event: 'chat.message', id: m.seq, data: m });
      }
      return sub;
    },
    async send(viewer, body, o) {
      if (!canAccessChat(viewer, body.chatId)) return { ok: false, status: 403, code: 'forbidden' };
      const text = body.text.trim();
      if (!text && !(body.attachments?.length ?? 0))
        return { ok: false, status: 400, code: 'invalid' };
      const t = deps.now();
      const cidKey = body.clientId
        ? `${body.chatId}|${viewer.studentId}|${body.clientId}`
        : undefined;
      if (body.clientId && cidKey) {
        for (const [k, v] of clientIds) if (t - v.at > CLIENT_ID_TTL_MS) clientIds.delete(k);
        const seen =
          clientIds.get(cidKey)?.message ??
          // after a restart the in-memory map is empty: the stored message still carries its clientId
          store.findByClientId(body.chatId, viewer.studentId, body.clientId);
        if (seen) return { ok: true, message: seen, duplicate: true }; // a retry of a send that already landed
      }
      // Double-click guard: identical text from this sender in this chat within 3 s is the same ask.
      const guardKey = `${body.chatId}|${viewer.studentId}`;
      const guardText = text.replace(/\s+/g, ' ');
      if (
        !body.confirmTaskId &&
        !body.attachments?.length &&
        guardText.length >= DOUBLE_SEND_MIN_CHARS
      ) {
        for (const [k, v] of lastSent) if (t - v.at > DOUBLE_SEND_MS) lastSent.delete(k);
        const prev = lastSent.get(guardKey);
        if (prev && prev.text === guardText && t - prev.at <= DOUBLE_SEND_MS)
          return { ok: true, message: prev.message, duplicate: true, hint: DUPLICATE_HINT };
      }
      if (body.confirmTaskId) {
        const card = store.findConfirm(dmChatId(viewer.studentId), body.confirmTaskId)?.card;
        if (
          body.chatId !== dmChatId(viewer.studentId) ||
          card?.type !== 'confirm' ||
          card.status !== 'pending'
        )
          return { ok: false, status: 409, code: 'stale_confirm' };
      }
      const recent = (rate.get(viewer.studentId) ?? []).filter((x) => t - x < 60_000);
      if (recent.length >= RATE_PER_MIN) return { ok: false, status: 429, code: 'rate_limited' };
      if (
        (inflight.get(viewer.studentId) ?? 0) >= MAX_INFLIGHT &&
        hub.engine?.mentions(text, body.chatId)
      )
        return { ok: false, status: 429, code: 'busy' };
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
      const { ts: originTs, ...originFields } = o?.origin ?? {};
      const message = store.append({
        chatId: body.chatId,
        ts: originTs ?? t,
        sender: { kind: 'student', id: viewer.studentId, name: nameOf(viewer.studentId) },
        text,
        private: body.chatId.startsWith('dm:'),
        attachments,
        citations: [],
        demo: false,
        ...(body.clientId ? { clientId: body.clientId } : {}),
        ...originFields,
      });
      publish(message);
      lastVia.set(body.chatId, o?.via === 'imessage' ? 'imessage' : 'web');
      notify(studentListeners, message, o?.via ?? 'web');
      if (cidKey) clientIds.set(cidKey, { at: t, message });
      if (!body.confirmTaskId && !attachments.length)
        lastSent.set(guardKey, { at: t, text: guardText, message });

      // Trip intents ("plan a trip to Cabo", "I vote 2", "confirm") are applied by the trip service and never reach
      // the bot. It runs for web and iMessage-origin messages alike (the bridge sends through this method).
      if (!body.confirmTaskId && deps.tripSvc) {
        const handled = await deps.tripSvc
          .handleChat(viewer, body.chatId, text)
          .catch((e: Error) => {
            deps.log.error('trip chat failed', { err: e.name });
            return false;
          });
        if (handled) return { ok: true, message };
      }

      const engine = hub.engine;
      if (engine) {
        const answers = engine.mentions(text, body.chatId);
        const run = async () => {
          const off = answers ? typingStart(body.chatId, 'cubbie', 'Cubbie') : () => {};
          try {
            // one bot turn per stored message: the answers posted inside it are keyed to this message id
            await trigger.run({ id: message.id }, () =>
              engine.inject({
                chatId: body.chatId,
                from: viewer.studentId,
                text,
                attachments: paths,
              }),
            );
          } catch (e) {
            deps.log.error('chat inject failed', { err: (e as Error).name });
          } finally {
            off();
            inflight.set(viewer.studentId, Math.max(0, (inflight.get(viewer.studentId) ?? 1) - 1));
          }
        };
        inflight.set(viewer.studentId, (inflight.get(viewer.studentId) ?? 0) + 1);
        void run();
      }
      return { ok: true, message };
    },
    postExternal(p) {
      if (!/^group:[A-Za-z0-9_-]{1,64}$/.test(p.chatId)) return undefined;
      const { ts, ...fields } = p.origin;
      const m = store.append({
        chatId: p.chatId,
        ts: ts ?? deps.now(),
        sender: p.sender,
        text: p.text,
        private: false,
        attachments: p.attachments ?? [],
        citations: [],
        demo: false,
        ...fields,
      });
      publish(m);
      return m;
    },
    annotate(id, patch) {
      const m = store.annotate(id, patch);
      if (m)
        fan(m.chatId, { event: 'chat.sync', data: { chatId: m.chatId, messageId: m.id, patch } });
      return m;
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
        if (leaks({ text, card, citations }, secrets)) {
          deps.log.warn('chat: group reply withheld by leak guard', { chatId: p.chatId });
          text = PRIVATE_FALLBACK;
          card = undefined;
          citations = [];
          paths = [];
        }
      }
      const replyTo = trigger.getStore()?.id;
      // a redelivered trigger can never produce a second identical answer (same trigger id + same text)
      if (replyTo && !card) {
        const prior = store.findReply(p.chatId, replyTo, text);
        if (prior) return prior;
      }
      const attachments = paths.flatMap((a) => files.adopt(a.path, a.mime, p.chatId) ?? []);
      if (!text && attachments.length === 0 && !card) return undefined;
      let mode = provMode();
      if (card?.type === 'council' && citations.length === 0) {
        // the council card carries its members' verified citations: surface them as chips too
        const r = deps.council?.get(card.runId);
        if (r) {
          if (r.demo) mode = 'demo';
          citations = r.members.flatMap((m) =>
            m.citations.map((c) => ({ file: c.file, page: c.page, label: c.label })),
          );
        }
      }
      // ONE rule for what a reply may claim: only verified citations survive; the rest is an explicit label.
      const composed = composeProvenance({
        text,
        citations,
        verify: verifyCitation,
        mode,
        hint: p.provenance,
        via: lastVia.get(p.chatId) ?? 'web',
      });
      citations = composed.citations;
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
        ...(replyTo ? { replyTo } : {}),
        provenance: composed.provenance,
      });
      publish(m);
      notify(botListeners, m);
      return m;
    },
    onBotPost(fn) {
      botListeners.add(fn);
      return () => void botListeners.delete(fn);
    },
    onStudentMessage(fn) {
      studentListeners.add(fn);
      return () => void studentListeners.delete(fn);
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
