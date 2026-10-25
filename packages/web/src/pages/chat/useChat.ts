import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  ChatAttachment,
  ChatCard,
  ChatContextRef,
  ChatMessage,
  ChatSummary,
  ChatTyping,
  HubStatus,
} from '@squad/core';
import {
  ChatApiError,
  chatErrorText,
  chatLoadReason,
  isExpired,
  type ChatApi,
  type ChatSyncEvent,
  type StreamState,
} from './api';
import { applySyncPatch } from './sync/applySyncPatch';
import { isOwn, mergeMessages, quizAnswerText, TYPING_TTL_MS, type ThreadItem } from './model';

/**
 * Chat state for one viewer: status, chat list, per-chat history, live stream, optimistic sends, typing, unread.
 * Everything talks to a `ChatApi`, so tests and the gallery inject a fake. Browser storage is wrapped in try/catch.
 */

export type ChatPhase = 'idle' | 'loading' | 'ready' | 'error' | 'expired';
export type ChatConn = 'connecting' | 'live' | 'offline' | 'expired';

interface Pending {
  localId: string;
  message: ChatMessage;
  state: 'pending' | 'failed';
  error?: string;
  files: ChatAttachment[];
  context?: ChatContextRef[];
  /** the confirm card this numeric answer belongs to */
  confirmTaskId?: string;
}
interface Bucket {
  items: ChatMessage[];
  pending: Pending[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingOlder: boolean;
  error: boolean;
  /** plain-words reason for `error` */
  errorText?: string;
}
const emptyBucket = (): Bucket => ({
  items: [],
  pending: [],
  hasMore: false,
  loaded: false,
  loading: false,
  loadingOlder: false,
  error: false,
});

interface State {
  phase: ChatPhase;
  /** why the phase is `error`, in plain words */
  error?: string;
  /** ids of messages the hub acknowledged after an optimistic send (they show Sent) */
  acked: Record<string, true>;
  status: HubStatus | null;
  chats: ChatSummary[];
  buckets: Record<string, Bucket>;
  typing: Record<string, Record<string, { name: string; until: number }>>;
  unread: Record<string, number>;
  conn: ChatConn;
  /** bumps whenever an incoming message lands, so views can decide about scroll anchoring */
  tick: number;
}
const initial: State = {
  phase: 'idle',
  acked: {},
  status: null,
  chats: [],
  buckets: {},
  typing: {},
  unread: {},
  conn: 'connecting',
  tick: 0,
};

type Action =
  | { t: 'phase'; phase: ChatPhase; error?: string }
  | { t: 'boot'; status: HubStatus | null; chats: ChatSummary[]; unread: Record<string, number> }
  | { t: 'chats'; chats: ChatSummary[] }
  | { t: 'status'; status: HubStatus }
  | { t: 'conn'; conn: ChatConn }
  | { t: 'msg'; m: ChatMessage; unread: boolean; own: boolean }
  | { t: 'card'; chatId: string; messageId: string; card: ChatCard }
  | { t: 'sync'; e: ChatSyncEvent }
  | { t: 'typing'; ty: ChatTyping; now: number }
  | { t: 'prune'; now: number }
  | { t: 'bucket'; chatId: string; patch: Partial<Bucket> }
  | { t: 'history'; chatId: string; messages: ChatMessage[]; hasMore: boolean; older: boolean }
  | { t: 'pend'; chatId: string; item: Pending }
  | { t: 'pendState'; chatId: string; localId: string; state: Pending['state']; error?: string }
  | { t: 'sentOk'; chatId: string; localId: string; message: ChatMessage }
  | { t: 'pendDrop'; chatId: string; localId: string }
  | { t: 'read'; chatId: string };

const bucketOf = (s: State, id: string) => s.buckets[id] ?? emptyBucket();
const withBucket = (s: State, id: string, f: (b: Bucket) => Bucket): State => ({
  ...s,
  buckets: { ...s.buckets, [id]: f(bucketOf(s, id)) },
});

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'phase':
      return { ...s, phase: a.phase, error: a.phase === 'error' ? a.error : undefined };
    case 'boot':
      return {
        ...s,
        phase: 'ready',
        error: undefined,
        status: a.status,
        chats: a.chats,
        unread: a.unread,
      };
    case 'chats':
      return { ...s, chats: a.chats };
    case 'status':
      return { ...s, status: a.status };
    case 'conn':
      return { ...s, conn: a.conn };
    case 'msg': {
      const m = a.m;
      let n = withBucket(s, m.chatId, (b) => {
        // the stream echo of our own message replaces its optimistic copy (the POST answer may come later)
        let dropped = !a.own;
        return {
          ...b,
          items: mergeMessages(b.items, [m]),
          pending: b.pending.filter((p) => {
            // the hub echoes the sender's clientId (our localId): that match is exact, text is the fallback
            const same = m.clientId
              ? m.clientId === p.localId
              : p.message.text === m.text && p.message.attachments.length === m.attachments.length;
            if (dropped || p.state !== 'pending' || !same) return true;
            dropped = true;
            return false;
          }),
        };
      });
      const known = n.chats.some((c) => c.id === m.chatId);
      if (known)
        n = {
          ...n,
          chats: n.chats.map((c) =>
            c.id === m.chatId && (!c.last || m.seq >= c.last.seq)
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
          ),
        };
      // a persona message ends that persona's typing indicator
      const ty = n.typing[m.chatId];
      if (m.sender.kind === 'persona' && ty?.[m.sender.id]) {
        const { [m.sender.id]: _gone, ...rest } = ty;
        void _gone;
        n = { ...n, typing: { ...n.typing, [m.chatId]: rest } };
      }
      return {
        ...n,
        tick: n.tick + 1,
        unread: a.unread ? { ...n.unread, [m.chatId]: (n.unread[m.chatId] ?? 0) + 1 } : n.unread,
      };
    }
    case 'sync':
      return withBucket(s, a.e.chatId, (b) => ({
        ...b,
        items: applySyncPatch(b.items, a.e.messageId, a.e.patch),
      }));
    case 'card':
      return withBucket(s, a.chatId, (b) => ({
        ...b,
        items: b.items.map((m) => (m.id === a.messageId ? { ...m, card: a.card } : m)),
      }));
    case 'typing': {
      const cur = { ...(s.typing[a.ty.chatId] ?? {}) };
      if (a.ty.on) cur[a.ty.personaId] = { name: a.ty.name, until: a.now + TYPING_TTL_MS };
      else delete cur[a.ty.personaId];
      return { ...s, typing: { ...s.typing, [a.ty.chatId]: cur } };
    }
    case 'prune': {
      let changed = false;
      const typing: State['typing'] = {};
      for (const [cid, who] of Object.entries(s.typing)) {
        const keep = Object.fromEntries(Object.entries(who).filter(([, v]) => v.until > a.now));
        if (Object.keys(keep).length !== Object.keys(who).length) changed = true;
        typing[cid] = keep;
      }
      return changed ? { ...s, typing } : s;
    }
    case 'bucket':
      return withBucket(s, a.chatId, (b) => ({ ...b, ...a.patch }));
    case 'history':
      return withBucket(s, a.chatId, (b) => ({
        ...b,
        items: mergeMessages(b.items, a.messages),
        // a first load knows hasMore; refreshes never flip it back on
        hasMore: a.older || !b.loaded ? a.hasMore : b.hasMore,
        loaded: true,
        loading: false,
        loadingOlder: false,
        error: false,
      }));
    case 'pend':
      return withBucket(s, a.chatId, (b) => ({ ...b, pending: [...b.pending, a.item] }));
    case 'pendState':
      return withBucket(s, a.chatId, (b) => ({
        ...b,
        pending: b.pending.map((p) =>
          p.localId === a.localId
            ? { ...p, state: a.state, ...(a.error ? { error: a.error } : { error: undefined }) }
            : p,
        ),
      }));
    case 'sentOk':
      return withBucket({ ...s, acked: { ...s.acked, [a.message.id]: true } }, a.chatId, (b) => ({
        ...b,
        pending: b.pending.filter((p) => p.localId !== a.localId),
        items: mergeMessages(b.items, [a.message]),
      }));
    case 'pendDrop':
      return withBucket(s, a.chatId, (b) => ({
        ...b,
        pending: b.pending.filter((p) => p.localId !== a.localId),
      }));
    case 'read':
      return { ...s, unread: { ...s.unread, [a.chatId]: 0 } };
  }
}

// ------------------------------------------------------------------ storage (viewer-local, never throws)

const seenKey = (me: string) => `squad.chat.seen.${me}`;
const quizKey = (me: string) => `squad.chat.quiz.${me}`;
function readJson<T extends Record<string, unknown>>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : ({} as T);
  } catch {
    return {} as T;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode or blocked storage: state stays in memory */
  }
}

export interface UseChatOptions {
  /** hub student id of the viewer, e.g. `s_ana` */
  me: string;
  /** called whenever the hub says the session is over */
  onExpired?: () => void;
}

export interface SendInput {
  text: string;
  files?: ChatAttachment[];
  /** Imported items attached with "Ask Cubbie" (the hub re-verifies every one). */
  context?: ChatContextRef[];
  /** set when the text is the option number of a confirm card */
  confirmTaskId?: string;
}

interface SendResult {
  ok: boolean;
  code?: string;
  localId: string;
}
export type ConfirmResult = 'ok' | 'stale' | 'failed';

export interface ChatController {
  phase: ChatPhase;
  /** plain-words reason when `phase` is `error` */
  errorText: string;
  status: HubStatus | null;
  chats: ChatSummary[];
  conn: ChatConn;
  online: boolean;
  unread: Record<string, number>;
  totalUnread: number;
  tick: number;
  me: string;
  api: ChatApi | null;
  thread(chatId: string): ThreadItem[];
  bucket(chatId: string): {
    loaded: boolean;
    loading: boolean;
    loadingOlder: boolean;
    errorText: string;
    hasMore: boolean;
    error: boolean;
  };
  typing(chatId: string): { personaId: string; name: string }[];
  setActive(chatId: string | null): void;
  loadHistory(chatId: string): Promise<void>;
  loadOlder(chatId: string): Promise<void>;
  send(chatId: string, input: SendInput): Promise<boolean>;
  confirm(chatId: string, taskId: string, option: number): Promise<ConfirmResult>;
  /** when a message came in over the stream (ms), for the short entrance of live arrivals */
  arrivedAt(messageId: string): number | undefined;
  retry(chatId: string, localId: string): Promise<boolean>;
  /** No answer came: ask again for the SAME message (same clientId, hub never stores a second prompt). */
  retryAnswer(chatId: string, message: ChatMessage): Promise<boolean>;
  discard(chatId: string, localId: string): void;
  /** Retry a failed iMessage delivery; the new state arrives as a `chat.sync` event. */
  retryDelivery(messageId: string): Promise<boolean>;
  reload(): void;
  quizAnswer(messageId: string): string | undefined;
  answerQuiz(chatId: string, messageId: string, choice: string): Promise<boolean>;
}

export function useChat(api: ChatApi | null, { me, onExpired }: UseChatOptions): ChatController {
  const [s, dispatch] = useReducer(reducer, initial);
  const sRef = useRef(s);
  sRef.current = s;
  const activeRef = useRef<string | null>(null);
  const seenRef = useRef<Record<string, number>>({});
  const quizRef = useRef<Record<string, string>>({});
  const [, force] = useReducer((n: number) => n + 1, 0);
  const onlineRef = useRef(typeof navigator === 'undefined' ? true : navigator.onLine);
  const localN = useRef(0);
  const arrived = useRef(new Map<string, number>());
  const prevConn = useRef<ChatConn>('connecting');
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;
  const bootN = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const expire = useCallback(() => {
    dispatch({ t: 'phase', phase: 'expired' });
    dispatch({ t: 'conn', conn: 'expired' });
    expiredRef.current?.();
  }, []);

  const markSeen = useCallback(
    (chatId: string) => {
      const st = sRef.current;
      const b = st.buckets[chatId];
      const last = Math.max(
        b?.items[b.items.length - 1]?.seq ?? 0,
        st.chats.find((c) => c.id === chatId)?.last?.seq ?? 0,
      );
      if (last > (seenRef.current[chatId] ?? 0)) {
        seenRef.current = { ...seenRef.current, [chatId]: last };
        writeJson(seenKey(me), seenRef.current);
      }
      dispatch({ t: 'read', chatId });
    },
    [me],
  );

  // ---- boot + stream
  const refreshHistory = useCallback(
    async (chatId: string) => {
      if (!api) return;
      try {
        const r = await api.history(chatId, { limit: 50 });
        dispatch({ t: 'history', chatId, ...r, older: false });
      } catch (e) {
        if (isExpired(e)) expire();
      }
    },
    [api, expire],
  );

  useEffect(() => {
    if (!api) {
      dispatch({ t: 'phase', phase: 'idle' });
      return;
    }
    const run = ++bootN.current;
    let dead = false;
    let close: (() => void) | undefined;
    seenRef.current = readJson<Record<string, number>>(seenKey(me));
    quizRef.current = readJson<Record<string, string>>(quizKey(me));
    dispatch({ t: 'phase', phase: 'loading' });
    // The demo notice clears itself when real answers return: poll every minute and after each bot reply.
    const refreshStatus = () =>
      void api.status().then(
        (status) => {
          if (dead) return;
          dispatch({ t: 'status', status });
          // the hub is still checking its providers: look again shortly so "Checking services..." resolves
          if (status.probing) setTimeout(refreshStatus, 1500);
        },
        () => undefined,
      );
    const statusTimer = setInterval(refreshStatus, 60_000);
    let replyTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const [status, chats] = await Promise.all([
          api.status().catch(() => null),
          api.chats(),
          api.prepare?.(),
        ]).then(([a, b]) => [a, b] as const);
        if (dead) return;
        const unread: Record<string, number> = {};
        for (const c of chats) {
          const mine = c.members.find((x) => x.id === me)?.name;
          const fromMe = !!c.last && c.last.senderName === mine;
          unread[c.id] = c.last && !fromMe && c.last.seq > (seenRef.current[c.id] ?? 0) ? 1 : 0;
        }
        dispatch({ t: 'boot', status, chats, unread });
        if (status?.probing) setTimeout(refreshStatus, 1500);
        const lastSeq = Math.max(0, ...chats.map((c) => c.last?.seq ?? 0));
        close = api.subscribe(
          {
            onMessage: (m) => {
              const watching = activeRef.current === m.chatId && visible();
              const fromOther = !isOwn(m.sender, me);
              arrived.current.set(m.id, Date.now());
              dispatch({ t: 'msg', m, unread: fromOther && !watching, own: !fromOther });
              if (m.sender.kind === 'persona') {
                clearTimeout(replyTimer);
                replyTimer = setTimeout(refreshStatus, 800);
              }
              if (watching) {
                // keep the persisted seen marker moving while the thread is open
                if (m.seq > (seenRef.current[m.chatId] ?? 0)) {
                  seenRef.current = { ...seenRef.current, [m.chatId]: m.seq };
                  writeJson(seenKey(me), seenRef.current);
                }
              }
              if (!sRef.current.chats.some((c) => c.id === m.chatId))
                void api.chats().then(
                  (cs) => !dead && dispatch({ t: 'chats', chats: cs }),
                  () => undefined,
                );
            },
            onUpdate: (u) =>
              dispatch({ t: 'card', chatId: u.chatId, messageId: u.messageId, card: u.card }),
            onSync: (e) => dispatch({ t: 'sync', e }),
            onTyping: (ty) => dispatch({ t: 'typing', ty, now: Date.now() }),
            onResync: () => {
              void api.chats().then(
                (cs) => !dead && dispatch({ t: 'chats', chats: cs }),
                () => undefined,
              );
              for (const [id, b] of Object.entries(sRef.current.buckets))
                if (b.loaded) void refreshHistory(id);
            },
            onState: (st: StreamState) => {
              if (dead) return;
              if (st === 'expired') {
                expire();
                return;
              }
              // back after a drop: history may have gaps (or older card states), so refetch what is open
              if (st === 'live' && prevConn.current === 'offline') {
                void api.chats().then(
                  (cs) => !dead && dispatch({ t: 'chats', chats: cs }),
                  () => undefined,
                );
                for (const [id, b] of Object.entries(sRef.current.buckets))
                  if (b.loaded) void refreshHistory(id);
              }
              prevConn.current = st;
              dispatch({ t: 'conn', conn: st });
            },
          },
          lastSeq || undefined,
        );
      } catch (e) {
        if (dead || run !== bootN.current) return;
        if (isExpired(e)) expire();
        else
          dispatch({
            t: 'phase',
            phase: 'error',
            error: chatLoadReason(e, onlineRef.current),
          });
      }
    })();
    return () => {
      dead = true;
      clearInterval(statusTimer);
      clearTimeout(replyTimer);
      close?.();
    };
  }, [api, me, expire, refreshHistory, reloadKey]);

  // typing safety timeout: prune expired indicators every second, only while something is on
  const anyTyping = Object.values(s.typing).some((w) => Object.keys(w).length > 0);
  useEffect(() => {
    if (!anyTyping) return;
    const id = setInterval(() => dispatch({ t: 'prune', now: Date.now() }), 1000);
    return () => clearInterval(id);
  }, [anyTyping]);

  // online/offline
  useEffect(() => {
    const on = () => {
      onlineRef.current = true;
      force();
      if (api && sRef.current.phase === 'error') setReloadKey((k) => k + 1);
    };
    const off = () => {
      onlineRef.current = false;
      force();
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [api]);

  // coming back to the tab with a thread open counts as reading it
  useEffect(() => {
    const onVis = () => {
      if (visible() && activeRef.current) markSeen(activeRef.current);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [markSeen]);

  // ---- actions
  const loadHistory = useCallback(
    async (chatId: string) => {
      if (!api) return;
      dispatch({
        t: 'bucket',
        chatId,
        patch: { loading: true, error: false, errorText: undefined },
      });
      try {
        const r = await api.history(chatId, { limit: 50 });
        dispatch({ t: 'history', chatId, ...r, older: false });
      } catch (e) {
        if (isExpired(e)) expire();
        dispatch({
          t: 'bucket',
          chatId,
          patch: { loading: false, error: true, errorText: chatLoadReason(e, onlineRef.current) },
        });
      }
    },
    [api, expire],
  );

  const loadOlder = useCallback(
    async (chatId: string) => {
      const b = sRef.current.buckets[chatId];
      if (!api || !b || !b.hasMore || b.loadingOlder || b.items.length === 0) return;
      dispatch({ t: 'bucket', chatId, patch: { loadingOlder: true } });
      try {
        const r = await api.history(chatId, { before: b.items[0]!.seq, limit: 50 });
        dispatch({ t: 'history', chatId, ...r, older: true });
      } catch (e) {
        if (isExpired(e)) expire();
        dispatch({ t: 'bucket', chatId, patch: { loadingOlder: false } });
      }
    },
    [api, expire],
  );

  const setActive = useCallback(
    (chatId: string | null) => {
      activeRef.current = chatId;
      if (!chatId) return;
      const b = sRef.current.buckets[chatId];
      if (!b?.loaded && !b?.loading) void loadHistory(chatId);
      markSeen(chatId);
    },
    [loadHistory, markSeen],
  );

  const doSend = useCallback(
    async (chatId: string, p: Pending): Promise<SendResult> => {
      if (!api) return { ok: false, localId: p.localId };
      dispatch({ t: 'pendState', chatId, localId: p.localId, state: 'pending' });
      try {
        const message = await api.send({
          chatId,
          text: p.message.text,
          // the same id on every retry, so the hub never stores a message twice
          clientId: p.localId,
          ...(p.files.length ? { attachments: p.files.map((f) => ({ id: f.id })) } : {}),
          ...(p.confirmTaskId ? { confirmTaskId: p.confirmTaskId } : {}),
          ...(p.context?.length ? { context: p.context } : {}),
        });
        dispatch({ t: 'sentOk', chatId, localId: p.localId, message });
        return { ok: true, localId: p.localId };
      } catch (e) {
        if (isExpired(e)) expire();
        dispatch({
          t: 'pendState',
          chatId,
          localId: p.localId,
          state: 'failed',
          error: chatErrorText(e, 'Not sent. Check your connection and try again.'),
        });
        return {
          ok: false,
          localId: p.localId,
          ...(e instanceof ChatApiError && e.code ? { code: e.code } : {}),
        };
      }
    },
    [api, expire],
  );

  const sendInner = useCallback(
    (chatId: string, input: SendInput): Promise<SendResult> => {
      const chat = sRef.current.chats.find((c) => c.id === chatId);
      const name = chat?.members.find((m) => m.id === me)?.name ?? 'You';
      const localId = `c_${Date.now().toString(36)}_${++localN.current}`;
      const files = input.files ?? [];
      const item: Pending = {
        localId,
        state: 'pending',
        files,
        ...(input.context?.length ? { context: input.context } : {}),
        ...(input.confirmTaskId ? { confirmTaskId: input.confirmTaskId } : {}),
        message: {
          id: localId,
          seq: 0,
          chatId,
          ts: Date.now(),
          sender: { kind: 'student', id: me, name },
          text: input.text,
          private: chatId.startsWith('dm:'),
          attachments: files,
          citations: [],
          demo: false,
          ...(input.context?.length ? { context: input.context } : {}),
        },
      };
      dispatch({ t: 'pend', chatId, item });
      return doSend(chatId, item);
    },
    [doSend, me],
  );
  const send = useCallback(
    async (chatId: string, input: SendInput) => (await sendInner(chatId, input)).ok,
    [sendInner],
  );
  const confirm = useCallback(
    async (chatId: string, taskId: string, option: number): Promise<ConfirmResult> => {
      const r = await sendInner(chatId, { text: String(option), confirmTaskId: taskId });
      if (r.ok) return 'ok';
      if (r.code === 'stale_confirm') {
        // the question closed (answered elsewhere or timed out): drop our answer and show the real state
        dispatch({ t: 'pendDrop', chatId, localId: r.localId });
        void refreshHistory(chatId);
        return 'stale';
      }
      return 'failed';
    },
    [sendInner, refreshHistory],
  );

  const retry = useCallback(
    (chatId: string, localId: string) => {
      const p = sRef.current.buckets[chatId]?.pending.find((x) => x.localId === localId);
      return p ? doSend(chatId, p).then((r) => r.ok) : Promise.resolve(false);
    },
    [doSend],
  );
  const retryAnswer = useCallback(
    async (chatId: string, message: ChatMessage) => {
      if (!api || !message.clientId) return false;
      try {
        await api.send({
          chatId,
          text: message.text,
          clientId: message.clientId,
          retryAnswer: true,
        });
        return true;
      } catch (e) {
        if (isExpired(e)) expire();
        return false;
      }
    },
    [api, expire],
  );
  const retryDelivery = useCallback(
    (messageId: string) =>
      api?.retryImessage ? api.retryImessage(messageId) : Promise.resolve(false),
    [api],
  );
  const discard = useCallback(
    (chatId: string, localId: string) => dispatch({ t: 'pendDrop', chatId, localId }),
    [],
  );

  const answerQuiz = useCallback(
    async (chatId: string, messageId: string, choice: string) => {
      quizRef.current = { ...quizRef.current, [messageId]: choice };
      writeJson(quizKey(me), quizRef.current);
      force();
      const ok = await send(chatId, { text: quizAnswerText(chatId, choice) });
      if (!ok) {
        const { [messageId]: _x, ...rest } = quizRef.current;
        void _x;
        quizRef.current = rest;
        writeJson(quizKey(me), rest);
        force();
      }
      return ok;
    },
    [me, send],
  );

  const thread = useCallback(
    (chatId: string): ThreadItem[] => {
      const b = sRef.current.buckets[chatId];
      if (!b) return [];
      return [
        ...b.items.map((message) => ({
          message,
          state: 'sent' as const,
          ...(s.acked[message.id] ? { acked: true } : {}),
        })),
        ...b.pending.map((p) => ({
          message: p.message,
          state: p.state,
          localId: p.localId,
          ...(p.error ? { error: p.error } : {}),
        })),
      ];
    },
    // re-derive when buckets change
    [s.buckets, s.acked],
  );

  const totalUnread = Object.values(s.unread).reduce((a, n) => a + n, 0);
  return {
    phase: s.phase,
    errorText: s.error ?? chatLoadReason(null),
    status: s.status,
    chats: s.chats,
    conn: s.conn,
    online: onlineRef.current,
    unread: s.unread,
    totalUnread,
    tick: s.tick,
    me,
    api,
    thread,
    bucket: (chatId) => {
      const b = s.buckets[chatId] ?? emptyBucket();
      return {
        loaded: b.loaded,
        loading: b.loading,
        loadingOlder: b.loadingOlder,
        hasMore: b.hasMore,
        error: b.error,
        errorText: b.errorText ?? chatLoadReason(null),
      };
    },
    typing: (chatId) =>
      Object.entries(s.typing[chatId] ?? {}).map(([personaId, v]) => ({ personaId, name: v.name })),
    setActive,
    loadHistory,
    loadOlder,
    send,
    confirm,
    arrivedAt: (id) => arrived.current.get(id),
    retry,
    retryAnswer,
    retryDelivery,
    discard,
    reload,
    quizAnswer: (id) => quizRef.current[id],
    answerQuiz,
  };
}
