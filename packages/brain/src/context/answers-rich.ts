import type { ChatCitation } from '@squad/core';
import { fmtDue } from './answers';
import { bestQuote } from './retrieve';
import type { ContextStore } from './store';
import type { ContextSource } from './types';

/**
 * Deterministic answers about the viewer's imported schedule, with source citations (no model involved).
 * Pure over the sources the caller already filtered to the asker's own: due items from Canvas AND Google Classroom,
 * and calendar events from Google Calendar / Canvas. Calendar details are owner-only: `aggregate` never carries a
 * title, so a group chat can show it; `details` names events and is for the owner's DM.
 */
export const CALENDAR_RE =
  /\b(calendar|schedule|what'?s on|events?|meetings?|busy|free time|my week)\b/i;
export const isCalendarQuestion = (t: string): boolean => CALENDAR_RE.test(t);

const DAY = 86_400_000;
const DUE_KINDS = new Set(['canvas_assignment', 'classroom_item']);
const CAL_KINDS = new Set(['gcal_event', 'canvas_event']);
const PROVIDER_LABEL: Record<string, string> = {
  canvas_assignment: 'Canvas',
  classroom_item: 'Google Classroom',
  gcal_event: 'Google Calendar',
  canvas_event: 'Canvas calendar',
};

export interface RichReply {
  text: string;
  citations: ChatCitation[];
}

/** A citation chip for one source: the first chunk is the evidence, the quote is a verbatim sentence of it. */
export function chatCitationFor(
  store: ContextStore,
  s: ContextSource,
  query = s.title,
): ChatCitation {
  const chunk = store.chunks(s.id)[0];
  const quote = chunk ? bestQuote(chunk.text, query).slice(0, 300) : '';
  return {
    file: s.title,
    page: 1,
    label: s.title,
    source: {
      kind: s.kind,
      id: s.id,
      ...(chunk ? { anchor: chunk.anchor } : {}),
      title: s.title,
      ...(s.url ? { url: s.url } : {}),
    },
    ...(quote ? { quote } : {}),
  };
}

/** "What is due?": Canvas assignments and Classroom items, soonest first, one citation per listed item. */
export function dueReply(
  store: ContextStore,
  sources: ContextSource[],
  now: number,
  courseNames: ReadonlyMap<string, string> = new Map(),
): RichReply | null {
  const all = sources.filter((s) => DUE_KINDS.has(s.kind));
  if (all.length === 0) return null;
  const upcoming = all
    .filter((a) => a.dueAt === null || a.dueAt >= now - DAY)
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  if (upcoming.length === 0) return { text: "Nothing due. You're all caught up.", citations: [] };
  const top = upcoming.slice(0, 5);
  const lines = top.map((a) => {
    const course = a.courseId ? (courseNames.get(a.courseId) ?? '') : '';
    const where = a.kind === 'classroom_item' ? ' [Google Classroom]' : '';
    return `- ${a.title}${course ? ` (${course})` : ''}${where}: ${fmtDue(a.dueAt, now)}`;
  });
  return {
    text: `Next ${top.length} due:\n${lines.join('\n')}`,
    citations: top.map((a) => chatCitationFor(store, a)),
  };
}

const range = (q: string, now: number): { from: number; to: number; label: string } => {
  if (/\btoday\b/i.test(q)) return { from: now, to: now + DAY, label: 'today' };
  if (/\btomorrow\b/i.test(q)) return { from: now + DAY, to: now + 2 * DAY, label: 'tomorrow' };
  return { from: now, to: now + 7 * DAY, label: 'the next 7 days' };
};

const hoursText = (ms: number): string => {
  const h = ms / 3_600_000;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
};

/**
 * "What's on my calendar this week?": `aggregate` (counts, busy hours, busiest day; NO titles, safe for a group) and
 * `details` (titles, times and one citation per event; owner only).
 */
export function calendarReply(
  store: ContextStore,
  sources: ContextSource[],
  q: string,
  now: number,
): { aggregate: string; details: RichReply; count: number } | null {
  const cal = sources.filter((s) => CAL_KINDS.has(s.kind));
  if (cal.length === 0) return null;
  const r = range(q, now);
  const inRange = cal
    .filter((s) => s.startsAt !== null && s.startsAt < r.to && (s.endsAt ?? s.startsAt) > r.from)
    .sort((a, b) => a.startsAt! - b.startsAt!);
  if (inRange.length === 0) {
    const none = `Nothing on your calendar for ${r.label}.`;
    return { aggregate: none, details: { text: none, citations: [] }, count: 0 };
  }
  const busyMs = inRange.reduce(
    (n, s) => n + Math.max(0, (s.endsAt ?? s.startsAt!) - s.startsAt!),
    0,
  );
  const perDay = new Map<string, number>();
  for (const s of inRange) {
    const d = new Date(s.startsAt!).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    });
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const busiest = [...perDay].sort((a, b) => b[1] - a[1])[0]![0];
  const aggregate = `For ${r.label} you have ${inRange.length} calendar event${inRange.length === 1 ? '' : 's'}, about ${hoursText(busyMs)} busy, busiest on ${busiest}. Titles stay private: only you see the details.`;
  const lines = inRange.slice(0, 8).map((s) => {
    const when = new Date(s.startsAt!).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    return `- ${s.title}: ${when} UTC [${PROVIDER_LABEL[s.kind]}]`;
  });
  return {
    aggregate,
    details: {
      text: `Your calendar for ${r.label} (${inRange.length}):\n${lines.join('\n')}`,
      citations: inRange.slice(0, 8).map((s) => chatCitationFor(store, s)),
    },
    count: inRange.length,
  };
}
