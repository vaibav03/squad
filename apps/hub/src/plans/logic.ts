// Pure study-plan logic: generation, edits with the optimistic version rule, rebalancing. No I/O, no clock.
// See docs/study-plan.md for the conflict rule.
import { assignChapters } from '@squad/brain';
import type {
  Plan,
  PlanConflict,
  PlanItem,
  PlanItemFields,
  PlanItemPatch,
  PlanSource,
} from '@squad/core';

export interface PlanChapter {
  id: string;
  title: string;
  file: string;
  pageStart: number;
}
export interface DueLite {
  title: string;
  dueAt: number;
  kind: string;
}

const DAY = 86_400_000;
export const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, n: number): string =>
  ymd(Date.parse(`${date}T00:00:00Z`) + n * DAY);
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const isRealDate = (s: string): boolean => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && ymd(t) === s;
};

export interface GenInput {
  now: number;
  members: { id: string; name: string }[];
  organizerId: string;
  chapters: PlanChapter[];
  /** PRIVATE: student -> chapter -> Leitner box. Used to pick strengths only; never copied into the plan. */
  boxes: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** PRIVATE: student -> busy `YYYY-MM-DD` days. Used to avoid clashes only. */
  busyDays: ReadonlyMap<string, ReadonlySet<string>>;
  due: DueLite[];
  examDate: string | null;
  newId: () => string;
}

export interface Generated {
  items: PlanItem[];
  citations: PlanSource[];
}

/** One review item per chapter (owner leads it), spread over the days before the exam, plus a group practice day. */
export function generateItems(g: GenInput): Generated {
  const today = ymd(g.now);
  const lastDay = g.examDate ? addDays(g.examDate, -1) : addDays(today, 14);
  const firstDay = daysBetween(today, lastDay) >= 1 ? addDays(today, 1) : lastDay;
  const span = Math.max(1, daysBetween(firstDay, lastDay) + 1);
  const students = g.members.map((m) => m.id);
  const owners = assignChapters({
    students,
    chapters: g.chapters.map((c) => c.id),
    mastery: g.boxes,
  });
  const nameOf = (id: string) => g.members.find((m) => m.id === id)?.name ?? id;
  const sorted = [...g.chapters].sort((a, b) => a.id.localeCompare(b.id));
  const reserve = span >= 3 ? 1 : 0; // keep the last day for the group practice
  const usable = Math.max(1, span - reserve);
  const items: PlanItem[] = [];
  const citations: PlanSource[] = [];
  const dueIn = g.due.filter((d) => d.dueAt >= g.now);
  const dueSources: PlanSource[] = dueIn.map((d) => ({
    kind: 'due',
    label: `${d.title}: ${ymd(d.dueAt)}`,
  }));
  sorted.forEach((c, i) => {
    const ownerId = owners.get(c.id) ?? students[0]!;
    const nominal = Math.floor((i * usable) / sorted.length);
    const busy = g.busyDays.get(ownerId);
    let pick = nominal;
    for (let k = 0; k < usable; k++) {
      const d = (nominal + k) % usable;
      if (!busy?.has(addDays(firstDay, d))) {
        pick = d;
        break;
      }
    }
    const src: PlanSource = {
      kind: 'material',
      label: `${c.file} p.${c.pageStart}`,
      file: c.file,
      page: c.pageStart,
      chapter: c.id,
    };
    citations.push(src);
    items.push({
      id: `it_${g.newId()}`,
      ownerId,
      ownerName: nameOf(ownerId),
      kind: 'review',
      title: `${c.id} review: ${c.title}`.slice(0, 120),
      chapter: c.id,
      topic: c.title,
      date: addDays(firstDay, pick),
      durationMin: 60,
      status: 'todo',
      rev: 1,
      sources: [src],
    });
  });
  if (sorted.length > 1) {
    items.push({
      id: `it_${g.newId()}`,
      ownerId: g.organizerId,
      ownerName: nameOf(g.organizerId),
      kind: 'practice',
      title: 'Group practice quiz',
      date: lastDay,
      durationMin: 45,
      status: 'todo',
      rev: 1,
      sources: dueSources.slice(0, 2),
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { items, citations: [...citations, ...dueSources] };
}

export const fieldsOf = (i: PlanItem): PlanItemFields => ({
  ownerId: i.ownerId,
  date: i.date,
  durationMin: i.durationMin,
  title: i.title,
  ...(i.topic ? { topic: i.topic } : {}),
});

export function applyFields(
  item: PlanItem,
  f: PlanItemFields,
  rev: number,
  by: string,
  nameOf: (id: string) => string,
): void {
  item.ownerId = f.ownerId;
  item.ownerName = nameOf(f.ownerId);
  item.date = f.date;
  item.durationMin = f.durationMin;
  item.title = f.title;
  if (f.topic) item.topic = f.topic;
  item.rev = rev;
  item.updatedBy = by;
}

export type EditOutcome =
  | { kind: 'applied'; item: PlanItem; changed: boolean }
  | { kind: 'conflict'; conflict: PlanConflict }
  | { kind: 'rejected'; code: string; message: string };

export interface EditCtx {
  by: string;
  now: number;
  newId: () => string;
  nameOf: (id: string) => string;
  isMember: (id: string) => boolean;
}

/**
 * The conflict rule: an edit carries the plan `rev` the editor last saw. If the item has changed after that rev, the
 * edit does not apply and is stored as an open conflict holding both versions; nothing is overwritten. Edits to
 * other items never conflict (they merge). While a conflict is open the item accepts no further edits.
 */
export function editItem(
  plan: Plan,
  itemId: string,
  baseRev: number,
  patch: PlanItemPatch,
  c: EditCtx,
): EditOutcome {
  const item = plan.items.find((i) => i.id === itemId);
  if (!item) return { kind: 'rejected', code: 'not_found', message: 'No such item.' };
  if (plan.status !== 'proposed' && plan.status !== 'active')
    return { kind: 'rejected', code: 'plan_closed', message: 'This plan is not open for edits.' };
  if (patch.ownerId && !c.isMember(patch.ownerId))
    return { kind: 'rejected', code: 'invalid_request', message: 'That person is not in the plan.' };
  if (patch.date) {
    if (!isRealDate(patch.date))
      return { kind: 'rejected', code: 'invalid_request', message: 'That is not a real date.' };
    if (plan.examDate && patch.date >= plan.examDate)
      return {
        kind: 'rejected',
        code: 'after_exam',
        message: 'Items have to be before the exam day.',
      };
    if (patch.date < ymd(c.now))
      return { kind: 'rejected', code: 'in_past', message: 'That day has passed.' };
  }
  const open = plan.conflicts.find((x) => x.itemId === itemId && x.status === 'open');
  const mine: PlanItemFields = { ...fieldsOf(item), ...patch };
  if (open || (item.rev > baseRev && item.updatedBy !== c.by)) {
    const same = JSON.stringify(mine) === JSON.stringify(fieldsOf(item));
    if (same) return { kind: 'applied', item, changed: false };
    if (open && open.mineBy === c.by) {
      open.mine = mine; // the same person revising their pending edit
      open.ts = c.now;
      return { kind: 'conflict', conflict: open };
    }
    if (open)
      return {
        kind: 'rejected',
        code: 'conflict_open',
        message: 'This item has an unresolved conflict. Pick a version first.',
      };
    const conflict: PlanConflict = {
      id: `cf_${c.newId()}`,
      itemId,
      status: 'open',
      theirs: fieldsOf(item),
      theirsBy: item.updatedBy ?? plan.organizerId,
      mine,
      mineBy: c.by,
      baseRev,
      ts: c.now,
    };
    plan.conflicts.push(conflict);
    return { kind: 'conflict', conflict };
  }
  if (JSON.stringify(mine) === JSON.stringify(fieldsOf(item)))
    return { kind: 'applied', item, changed: false };
  plan.rev += 1;
  applyFields(item, mine, plan.rev, c.by, c.nameOf);
  return { kind: 'applied', item, changed: true };
}

export function resolveConflict(
  plan: Plan,
  conflictId: string,
  pick: 'theirs' | 'mine',
  by: string,
  nameOf: (id: string) => string,
): PlanConflict | undefined {
  const cf = plan.conflicts.find((x) => x.id === conflictId && x.status === 'open');
  if (!cf) return undefined;
  const item = plan.items.find((i) => i.id === cf.itemId);
  cf.status = 'resolved';
  cf.resolution = pick;
  cf.resolvedBy = by;
  if (item && pick === 'mine') {
    plan.rev += 1;
    applyFields(item, cf.mine, plan.rev, by, nameOf);
  } else if (item) {
    plan.rev += 1;
    item.rev = plan.rev; // keeps their version, but invalidates stale edits made against the old rev
  }
  return cf;
}

/** A member declined: their items go to the remaining members, lightest load first. Returns how many moved. */
export function rebalance(
  plan: Plan,
  declinedId: string,
  by: string,
  nameOf: (id: string) => string,
): number {
  const keep = plan.members.filter((m) => m.optedIn && m.id !== declinedId).map((m) => m.id);
  if (keep.length === 0) return 0;
  const minutes = new Map(keep.map((id) => [id, 0]));
  for (const i of plan.items) if (minutes.has(i.ownerId)) minutes.set(i.ownerId, minutes.get(i.ownerId)! + i.durationMin);
  let moved = 0;
  for (const i of plan.items.filter((x) => x.ownerId === declinedId && x.status === 'todo')) {
    const to = [...minutes].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]![0];
    minutes.set(to, minutes.get(to)! + i.durationMin);
    plan.rev += 1;
    applyFields(i, { ...fieldsOf(i), ownerId: to }, plan.rev, by, nameOf);
    moved += 1;
  }
  return moved;
}

/** Match `ch6 review`-style references to items. Every word must appear in the item's title/chapter/topic. */
export function matchItems(items: PlanItem[], ref: string): PlanItem[] {
  const words = ref
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && w !== 'the' && w !== 'my' && w !== 'with');
  if (words.length === 0) return [];
  const hay = (i: PlanItem) =>
    `${i.title} ${i.chapter ?? ''} ${i.topic ?? ''} ${i.kind}`.toLowerCase();
  const hit = items.filter((i) => words.every((w) => hay(i).includes(w)));
  if (hit.length > 1) {
    // a bare chapter like `ch6` prefers the exact chapter id
    const exact = hit.filter((i) => i.chapter === words[0]);
    if (exact.length === 1) return exact;
  }
  return hit;
}

/** Exam date from free text: ISO, `Nov 4`, `November 4 2026`, `11/4`, `tomorrow`. Returns a `YYYY-MM-DD` or undefined. */
export function parseExamDate(text: string, now: number): string | undefined {
  const t = text.toLowerCase();
  const year = new Date(now).getUTCFullYear();
  const mk = (y: number, m: number, d: number): string | undefined => {
    const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!isRealDate(s)) return undefined;
    if (s < ymd(now) && y === year) return mk(year + 1, m, d); // a bare month/day means the next one
    return s;
  };
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return isRealDate(iso[0]) ? iso[0] : undefined;
  const months = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ];
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(t);
  if (named) return mk(named[3] ? Number(named[3]) : year, months.indexOf(named[1]!) + 1, Number(named[2]));
  const rev = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:,?\s+(\d{4}))?/.exec(t);
  if (rev) return mk(rev[3] ? Number(rev[3]) : year, months.indexOf(rev[2]!) + 1, Number(rev[1]));
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (slash) {
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : year;
    return mk(y, Number(slash[1]), Number(slash[2]));
  }
  if (/\btomorrow\b/.test(t)) return ymd(now + DAY);
  const inDays = /\bin\s+(\d{1,2})\s+days?\b/.exec(t);
  if (inDays) return ymd(now + Number(inDays[1]) * DAY);
  const inWeeks = /\bin\s+(\d{1,2})\s+weeks?\b/.exec(t);
  if (inWeeks) return ymd(now + Number(inWeeks[1]) * 7 * DAY);
  return undefined;
}
