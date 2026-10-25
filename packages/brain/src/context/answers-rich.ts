import type { ChatCitation } from '@squad/core';
import { fmtDue } from './answers';
import { bestQuote } from './retrieve';
import type { ContextStore } from './store';
import { courseLabel, type ContextSource } from './types';

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

/** First `Course:` line of a source's evidence (Canvas / Classroom payloads write it), else empty (a raw id is never shown). */
function courseOf(store: ContextStore, s: ContextSource, names: ReadonlyMap<string, string>): string {
  const labelled = courseLabel({ courseName: s.courseName, courseCode: s.courseCode });
  if (labelled) return labelled; // "HIST 140: Modern World History" from the stored course record
  const named = s.courseId ? names.get(s.courseId) : undefined;
  if (named) return named;
  const line = /^Course:\s*(.+)$/m.exec(store.chunks(s.id)[0]?.text ?? '')?.[1]?.trim();
  return line || '';
}

export interface DueWindow {
  from: number;
  to: number;
  label: string;
  /** `all` = no window words in the question (next items, soonest first). */
  kind: 'today' | 'tomorrow' | 'week' | 'nextweek' | 'after' | 'all';
}

/** UTC offset (ms) of `tz` at instant `ms`; 0 for UTC or an unknown zone. */
function tzOffset(ms: number, tz: string): number {
  if (tz === 'UTC') return 0;
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(ms)
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - ms;
  } catch {
    return 0;
  }
}
const endOfDay = (ms: number, tz: string): number => {
  const off = tzOffset(ms, tz);
  return Math.floor((ms + off) / DAY) * DAY + DAY - off;
};

/**
 * The due window a question asks for (docs/context-store.md): "today" = until the end of the viewer's local day,
 * "tomorrow" = the next local day, "this week" = now through the next 7 days, "next week" = days 7..14,
 * "after this week" / "later" = day 7 through day 37. No window words: no window.
 */
export function dueWindow(q: string, now: number, tz = 'UTC'): DueWindow {
  if (/\b(after this week|next after this week|later|further out)\b/i.test(q))
    return { from: now + 7 * DAY, to: now + 37 * DAY, label: 'after this week', kind: 'after' };
  if (/\bnext week\b/i.test(q))
    return { from: now + 7 * DAY, to: now + 14 * DAY, label: 'next week', kind: 'nextweek' };
  if (/\btomorrow\b/i.test(q)) {
    const from = endOfDay(now, tz);
    return { from, to: from + DAY, label: 'tomorrow', kind: 'tomorrow' };
  }
  if (/\btoday\b/i.test(q)) return { from: now, to: endOfDay(now, tz), label: 'today', kind: 'today' };
  if (/\b(this week|the week|next 7 days|coming week)\b/i.test(q))
    return { from: now, to: now + 7 * DAY, label: 'this week', kind: 'week' };
  return { from: now, to: Infinity, label: 'upcoming', kind: 'all' };
}

const exactDue = (ms: number, tz: string): string => {
  const o = { timeZone: tz } as const;
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', ...o });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...o });
  return `${day}, ${time}${tz === 'UTC' ? ' UTC' : ''}`;
};

/**
 * "What is due?": Canvas assignments and Classroom items, soonest first, one citation per listed item. A window word in
 * the question ("this week", "today", "tomorrow", "next week", "after this week") filters BEFORE anything is listed or
 * cited. Every line carries the course ("CODE: Name") and the exact due date; an empty window says so and offers the
 * next step instead of listing outside it.
 */
export function dueReply(
  store: ContextStore,
  sources: ContextSource[],
  now: number,
  courseNames: ReadonlyMap<string, string> = new Map(),
  q = '',
  tz = 'UTC',
): RichReply | null {
  const all = sources.filter((s) => DUE_KINDS.has(s.kind));
  if (all.length === 0) return null;
  const win = dueWindow(q, now, tz);
  const dated = all
    .filter((a) => a.dueAt !== null)
    .sort((a, b) => a.dueAt! - b.dueAt!);
  const inWin =
    win.kind === 'all'
      ? all
          .filter((a) => a.dueAt === null || a.dueAt >= now - DAY)
          .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
      : dated.filter((a) => a.dueAt! >= win.from && a.dueAt! < win.to);
  const line = (a: ContextSource) => {
    const course = courseOf(store, a, courseNames);
    const where = a.kind === 'classroom_item' ? ' [Google Classroom]' : '';
    const when = a.dueAt === null ? 'no due date' : exactDue(a.dueAt, tz);
    return `- ${a.title}${course ? ` (${course})` : ''}${where}: due ${when}`;
  };
  const cite = (a: ContextSource): ChatCitation => {
    const c = chatCitationFor(store, a);
    const course = courseOf(store, a, courseNames);
    const when = a.dueAt === null ? undefined : exactDue(a.dueAt, tz);
    return {
      ...c,
      label: when ? `${a.title}, due ${when}` : a.title,
      source: {
        ...c.source!,
        provenance: a.provenance.endsWith(':fixture') ? 'fixture' : 'real',
        ...(course ? { courseName: course } : {}),
        ...(when ? { locationLabel: `Due ${when}` } : {}),
      },
    };
  };
  if (inWin.length === 0) {
    const next = dated.find((a) => a.dueAt! >= (win.kind === 'all' ? now : win.to));
    const upTo = win.kind === 'all' ? '' : ` ${win.label}`;
    const head = `Nothing due${upTo}${win.kind === 'week' ? ` (through ${exactDue(now + 7 * DAY, tz).replace(/, .*$/, '')})` : ''}.`;
    const nextLine = next
      ? ` Next after that: ${next.title} (${courseOf(store, next, courseNames) || 'no course'}), due ${exactDue(next.dueAt!, tz)}. Ask "@cubbie what is due after this week?" to see later items.`
      : " You're all caught up.";
    return { text: head + nextLine, citations: next ? [cite(next)] : [] };
  }
  const top = inWin.slice(0, 8);
  const title = win.kind === 'all' ? `Next ${top.length} due` : `Due ${win.label} (${top.length})`;
  const later = win.kind === 'week' ? dated.filter((a) => a.dueAt! >= win.to).length : 0;
  const followUp = later
    ? `\nNext after this week: ${later} more due later. Ask "@cubbie what is due after this week?" to list them.`
    : '';
  return { text: `${title}:\n${top.map(line).join('\n')}${followUp}`, citations: top.map(cite) };
}

const range = (q: string, now: number): { from: number; to: number; label: string } => {
  if (/\btoday\b/i.test(q)) return { from: now, to: now + DAY, label: 'today' };
  if (/\btomorrow\b/i.test(q)) return { from: now + DAY, to: now + 2 * DAY, label: 'tomorrow' };
  if (/\bmonth\b/i.test(q)) return { from: now, to: now + 30 * DAY, label: 'the next 30 days' };
  if (/\b(next week|two weeks|fortnight)\b/i.test(q))
    return { from: now, to: now + 14 * DAY, label: 'the next 14 days' };
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
