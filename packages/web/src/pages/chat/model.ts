import type { ChatCitation, ChatMessage, ChatSender, ChatSummary } from '@squad/core';

/** Pure chat logic: grouping, labels, citation markers, mentions, small formatters. No React, no DOM. */

export const MAX_TEXT = 4000;
export const COUNTER_FROM = 3500;
export const GROUP_GAP_MS = 5 * 60_000;
export const TYPING_TTL_MS = 45_000;
export const MAX_ATTACHMENTS = 4;

// ------------------------------------------------------------------ senders

export const senderKey = (s: ChatSender): string =>
  s.kind === 'system' ? 'system' : `${s.kind}:${s.id}`;

export const isOwn = (s: ChatSender, me: string | null | undefined): boolean =>
  !!me && s.kind === 'student' && s.id === me;

/** Short role tag shown next to a sender name (pixel label). */
export function roleTag(s: ChatSender): string | null {
  if (s.kind === 'persona') return 'Bot';
  if (s.kind === 'system') return 'Notice';
  return null;
}

const STUDENT_PORTRAITS = ['student', 'ta', 'expert', 'mediator', 'dean', 'examiner'] as const;
const KNOWN_STUDENTS: Record<string, number> = { s_ana: 0, s_ben: 1, s_chi: 2, s_dev: 3 };
const hash = (id: string) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Deterministic pixel portrait id for a student: the four demo students always differ. */
export function studentPortraitId(id: string): string {
  const known = KNOWN_STUDENTS[id];
  return STUDENT_PORTRAITS[known ?? hash(id) % STUDENT_PORTRAITS.length]!;
}

const RINGS = [
  '--sq-ember',
  '--sq-cloud-hi',
  '--sq-ok',
  '--sq-skin-lt',
  '--sq-leaf-lit',
  '--sq-hill-far',
] as const;
/** Palette token for a student's avatar ring. Known students get distinct rings. */
export function studentRing(id: string): string {
  const known = KNOWN_STUDENTS[id];
  return RINGS[known ?? hash(id) % RINGS.length]!;
}

// ------------------------------------------------------------------ time

const DAY = 86_400_000;
const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const dateFmt = (ts: number, withWeekday: boolean, withYear: boolean) =>
  new Date(ts).toLocaleDateString('en-US', {
    ...(withWeekday ? { weekday: 'long' } : {}),
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });

/** Date separator label: Today, Yesterday, a weekday inside the last week, else a date. */
export function dayLabel(ts: number, now: number = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  if (diff > 1 && diff < 7) return new Date(ts).toLocaleDateString('en-US', { weekday: 'long' });
  return dateFmt(ts, false, !sameYear);
}

/** Right-aligned time in a chat list row. */
export function listTime(ts: number, now: number = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (diff === 0) return timeLabel(ts);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return new Date(ts).toLocaleDateString('en-US', { weekday: 'short' });
  return dateFmt(ts, false, false);
}

// ------------------------------------------------------------------ rows

export type ThreadRow =
  | { kind: 'day'; key: string; label: string }
  | {
      kind: 'msg';
      key: string;
      message: ChatMessage;
      /** first of a run from one sender: show avatar and name */
      head: boolean;
      /** last of a run: show the time */
      tail: boolean;
      own: boolean;
      state: 'sent' | 'pending' | 'failed';
      acked?: boolean;
      localId?: string;
      error?: string;
    };

export interface ThreadItem {
  message: ChatMessage;
  state: 'sent' | 'pending' | 'failed';
  /** the hub acknowledged this message after an optimistic send */
  acked?: boolean;
  localId?: string;
  error?: string;
}

/**
 * Hides answers created by redelivery: a bot message with the same trigger (`replyTo`) and the same text as an earlier
 * one, or an identical bot text straight after an identical one (no replyTo, e.g. history from before triggers were
 * recorded). Cards are compared by type and run/plan id. Never touches student messages or differing answers.
 */
export function dropRedelivered(items: readonly ThreadItem[]): ThreadItem[] {
  const seen = new Set<string>();
  let lastBot: string | undefined;
  return items.filter((it) => {
    const m = it.message;
    if (m.sender.kind !== 'persona') {
      lastBot = undefined;
      return true;
    }
    const card = m.card ? `${m.card.type}:${JSON.stringify(m.card)}` : '';
    const text = m.text.trim().replace(/\s+/g, ' ');
    const sig = `${m.sender.id}|${text}|${card}`;
    const k = m.replyTo ? `${m.replyTo}|${sig}` : undefined;
    const dup = (k && seen.has(k)) || (!m.replyTo && lastBot === sig && !m.card);
    if (k) seen.add(k);
    lastBot = sig;
    return !dup;
  });
}

/** Date separators plus runs of consecutive messages from one sender (same day, within 5 minutes). */
export function buildRows(
  items: readonly ThreadItem[],
  me: string | null | undefined,
  now: number = Date.now(),
): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let prev: ThreadItem | undefined;
  items.forEach((it, i) => {
    const m = it.message;
    if (!prev || !sameDay(prev.message.ts, m.ts))
      rows.push({ kind: 'day', key: `day-${startOfDay(m.ts)}`, label: dayLabel(m.ts, now) });
    const continues =
      !!prev &&
      sameDay(prev.message.ts, m.ts) &&
      senderKey(prev.message.sender) === senderKey(m.sender) &&
      m.sender.kind !== 'system' &&
      m.ts - prev.message.ts <= GROUP_GAP_MS;
    const next = items[i + 1];
    const nextContinues =
      !!next &&
      sameDay(next.message.ts, m.ts) &&
      senderKey(next.message.sender) === senderKey(m.sender) &&
      m.sender.kind !== 'system' &&
      next.message.ts - m.ts <= GROUP_GAP_MS;
    rows.push({
      kind: 'msg',
      key: it.localId ?? m.id,
      message: m,
      head: !continues,
      tail: !nextContinues,
      own: isOwn(m.sender, me),
      state: it.state,
      ...(it.acked ? { acked: true } : {}),
      ...(it.localId ? { localId: it.localId } : {}),
      ...(it.error ? { error: it.error } : {}),
    });
    prev = it;
  });
  return rows;
}

/** Insert or replace by id, keep seq order (pending messages sort last). */
export function mergeMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) {
    const old = byId.get(m.id);
    // A refetch can be older than a live `chat.update`: a settled confirm card never goes back to pending.
    if (
      old?.card?.type === 'confirm' &&
      old.card.status !== 'pending' &&
      m.card?.type === 'confirm' &&
      m.card.status === 'pending'
    )
      byId.set(m.id, { ...m, card: old.card });
    else byId.set(m.id, m);
  }
  // a send id is one message: if the same sender's clientId shows up under two ids, keep the first
  const seenClient = new Map<string, string>();
  const out: ChatMessage[] = [];
  for (const m of [...byId.values()].sort((a, b) => a.seq - b.seq)) {
    if (m.clientId && m.sender.kind === 'student') {
      const key = `${m.chatId}|${m.sender.id}|${m.clientId}`;
      if (seenClient.has(key)) continue;
      seenClient.set(key, m.id);
    }
    out.push(m);
  }
  return out;
}

// ------------------------------------------------------------------ citations

export interface CiteMarker {
  file: string;
  page: number;
  raw: string;
  start: number;
  end: number;
}

/**
 * Canonical marker the hub writes: `[<file> p.<N>]`, e.g. `[ch6-the-normal-distribution.pdf p.2]`. Older spellings
 * (`[ch6.pdf p4]`, `[ch6.pdf, p. 4]`) match too. Brackets only; markdown links never match.
 */
const MARKER = /\[([^[\]\n,]+?\.[A-Za-z]{2,4})[,\s]+p\.?\s?(\d{1,4})\]/g;

export function findCitationMarkers(text: string): CiteMarker[] {
  const out: CiteMarker[] = [];
  for (const m of text.matchAll(MARKER)) {
    const start = m.index ?? 0;
    out.push({
      file: m[1]!.trim(),
      page: Number(m[2]),
      raw: m[0],
      start,
      end: start + m[0].length,
    });
  }
  return out;
}

const norm = (f: string) => f.toLowerCase().replace(/\.[a-z]{2,4}$/, '');
const stem = (f: string) => norm(f).split(/[-_ ]/)[0]!;

/** The verified citation a marker points at: same page and the same file, or a file name that extends it. */
export const citationFor = (
  marker: Pick<CiteMarker, 'file' | 'page'>,
  citations: readonly ChatCitation[],
): ChatCitation | undefined => {
  const same = citations.filter((c) => c.page === marker.page);
  return (
    same.find((c) => norm(c.file) === norm(marker.file)) ??
    same.find((c) => stem(c.file) === stem(marker.file)) ??
    (same.length === 1 && citations.length === 1 ? same[0] : undefined)
  );
};

/** Citation for every marker in the text: the hub's own (with its label) or one derived from the marker. */
export function resolveCitations(text: string, citations: readonly ChatCitation[]): ChatCitation[] {
  const out: ChatCitation[] = [];
  for (const mk of findCitationMarkers(text))
    out.push(
      citationFor(mk, citations) ?? {
        file: mk.file,
        page: mk.page,
        label: `${mk.file} p.${mk.page}`,
      },
    );
  // citations the text does not mark inline still show as chips
  return uniqueCitations([...out, ...citations]);
}

const citeKey = (c: Pick<ChatCitation, 'file' | 'page'>) => `${norm(c.file)}#${c.page}`;

/**
 * Prepares message text for the Markdown primitive: every marker becomes a small numbered chip (`[cite: 2]`) that
 * matches the numbered chips under the message, so the text stays quiet and the sources stay readable.
 */
export function withInlineCites(text: string, citations: readonly ChatCitation[]): string {
  const markers = findCitationMarkers(text);
  if (markers.length === 0) return text;
  const list = resolveCitations(text, citations);
  let out = '';
  let at = 0;
  for (const mk of markers) {
    out += text.slice(at, mk.start);
    const c = citationFor(mk, citations) ?? { file: mk.file, page: mk.page };
    out += `[cite: ${list.findIndex((x) => citeKey(x) === citeKey(c)) + 1}]`;
    at = mk.end;
  }
  return out + text.slice(at);
}

/** Unique citations in reading order. */
export function uniqueCitations(citations: readonly ChatCitation[]): ChatCitation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const k = citeKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ------------------------------------------------------------------ mentions

export interface MentionOption {
  id: 'cubbie' | 'squad';
  insert: string;
  hint: string;
}
export const MENTION_OPTIONS: readonly MentionOption[] = [
  { id: 'cubbie', insert: '@cubbie', hint: 'Ask your study buddy' },
  { id: 'squad', insert: '@squad', hint: 'Ask the squad helpers' },
];

export interface MentionQuery {
  /** index of the `@` */
  start: number;
  query: string;
}

/** The `@word` being typed right before the caret (the `@` must start a word), or null. */
export function activeMention(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([A-Za-z]{0,12})$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[2]!.length - 1, query: m[2]!.toLowerCase() };
}

export function matchMentions(query: string): MentionOption[] {
  const q = query.toLowerCase();
  return MENTION_OPTIONS.filter((o) => o.id.startsWith(q));
}

export function applyMention(
  text: string,
  caret: number,
  mq: MentionQuery,
  opt: MentionOption,
): { text: string; caret: number } {
  const tail = text.slice(caret);
  const insert = `${opt.insert} `;
  const next = text.slice(0, mq.start) + insert + tail.replace(/^ /, '');
  return { text: next, caret: mq.start + insert.length };
}

/** True when a group message addresses the bot (client-side hint only; the hub decides). */
export const mentionsBot = (text: string): boolean => /(^|\W)@(cubbie|squad)\b/i.test(text);

/** True when the bubble text only repeats what its card already says (so it is left out). */
export function textRepeatsCard(text: string, card: { type: string; question?: string }): boolean {
  const t = text.trim().toLowerCase();
  if (card.type === 'quiz') return /^question \d+/.test(t);
  return !!card.question && t === card.question.trim().toLowerCase();
}

export const QUICK_PROMPTS_GROUP = [
  '@cubbie what is a z-score?',
  '@cubbie quiz me on chapter 6',
  '@cubbie podcast ch6',
  '@cubbie study plan',
] as const;
export const QUICK_PROMPTS_DM = [
  'am I behind?',
  'what is the difference between mean and median?',
  'study plan',
] as const;

/** What a quiz answer is sent as: a group needs the mention so the bot always runs; a DM never does. */
export const quizAnswerText = (chatId: string, answer: string): string =>
  chatId.startsWith('dm:') ? answer : `@cubbie ${answer}`;

// ------------------------------------------------------------------ misc

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const ACCEPT_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Client-side pre-check for an upload; returns user-facing copy or null when fine. */
export function uploadProblem(file: { type: string; size: number }): string | null {
  if (!(ACCEPT_IMAGES as readonly string[]).includes(file.type))
    return 'Only PNG, JPEG, WebP or GIF images can be sent.';
  if (file.size > MAX_UPLOAD_BYTES) return 'That image is over 8 MB.';
  return null;
}

/** Chat list preview line: "Ana: text", attachments and cards read as words. */
export function previewLine(c: ChatSummary, meName?: string): string {
  if (!c.last) return c.kind === 'dm' ? 'Only you and Cubbie' : 'No messages yet';
  const text = c.last.text.replace(/\s+/g, ' ').trim() || 'Sent an attachment';
  if (meName && c.last.senderName === meName) return `You: ${text}`;
  return c.kind === 'group' ? `${c.last.senderName}: ${text}` : text;
}

/** Unread count: stream messages from others newer than the last seen seq. */
export const countUnread = (
  messages: readonly ChatMessage[],
  seen: number,
  me: string | null | undefined,
): number => messages.filter((m) => m.seq > seen && !isOwn(m.sender, me)).length;

/** Screen reader name for a citation chip: "Source: chapter 6, page 4". */
export function citationSpeech(c: Pick<ChatCitation, 'file' | 'page'>): string {
  const ch = /^ch(?:apter)?[-_ ]?(\d+)/i.exec(c.file);
  const what = ch ? `chapter ${ch[1]}` : c.file.replace(/\.[A-Za-z]{2,4}$/, '');
  return `Source: ${what}, page ${c.page}`;
}

/** What a screen reader (and the player) calls an attachment, from the message it came in. */
export function attachmentLabel(
  att: { kind: 'image' | 'audio' | 'file'; name?: string },
  sender: ChatSender,
  me: string | null | undefined,
): string {
  const bot = sender.kind === 'persona';
  if (att.kind === 'audio') return bot ? 'Podcast audio' : 'Audio message';
  if (att.kind === 'image')
    return bot
      ? `Picture from ${sender.name}`
      : isOwn(sender, me)
        ? 'Image you sent'
        : `Image from ${sender.name}`;
  return att.name ?? 'File';
}

/** Name a screen reader hears at the start of a message. */
export const senderSpeech = (s: ChatSender, me: string | null | undefined): string =>
  isOwn(s, me) ? 'You' : s.kind === 'persona' ? `${s.name}, bot` : s.name;

/** Host to show next to a link whose text hides where it goes (URL-looking text, or text without the host). */
export function linkHost(text: string, href: string): string | null {
  let host: string;
  try {
    host = new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const t = text.trim().toLowerCase();
  const urlish = /^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/.test(t);
  return urlish || !t.includes(host.toLowerCase()) ? host : null;
}

export const dmIdFor = (me: string): string => `dm:${me}`;

// ------------------------------------------------------------------ waiting for an answer

export const SLOW_AFTER_MS = 8_000;
export const GIVE_UP_AFTER_MS = 90_000;
/** Older unanswered messages are history, not "still waiting". */
export const WAIT_WINDOW_MS = 5 * 60_000;

export interface Waiting {
  /** the student message the answer is for (the trigger) */
  id: string;
  /** reused on retry so no second prompt is created */
  clientId: string | undefined;
  text: string;
  since: number;
}

/** Own sent messages that address the bot and have no answer yet: ONE entry per trigger message. */
export function waitingTriggers(
  items: readonly ThreadItem[],
  me: string,
  isDm: boolean,
  now: number,
  startedAt: (id: string, ts: number) => number = (_id, ts) => ts,
): Waiting[] {
  const out: Waiting[] = [];
  for (const [i, it] of items.entries()) {
    const m = it.message;
    if (it.state !== 'sent' || m.sender.kind !== 'student' || m.sender.id !== me) continue;
    if (!isDm && !mentionsBot(m.text)) continue;
    if (now - m.ts > WAIT_WINDOW_MS) continue;
    const answered = items.some(
      (o, j) =>
        o.message.sender.kind === 'persona' &&
        (o.message.replyTo === m.id || (!o.message.replyTo && j > i)),
    );
    if (answered) continue;
    out.push({ id: m.id, clientId: m.clientId, text: m.text, since: startedAt(m.id, m.ts) });
  }
  return out;
}

export type WaitPhase = 'thinking' | 'slow' | 'failed';
export const waitPhase = (elapsedMs: number, failed: boolean): WaitPhase =>
  failed || elapsedMs >= GIVE_UP_AFTER_MS
    ? 'failed'
    : elapsedMs >= SLOW_AFTER_MS
      ? 'slow'
      : 'thinking';
