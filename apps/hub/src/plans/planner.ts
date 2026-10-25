// The study-plan planner agent: ONE grounded model call with structured output. It reads the viewer-scoped context the
// hub already gated (chapters with page text, due items, Canvas/Google items from the context store, per-member weak
// chapters and busy days as private hints), proposes items with a written rationale and verbatim-quote citations, and
// the code checks every field. The deterministic generator (logic.ts) stays as the labelled fallback.
import { addDays, daysBetween, type Llm, type PlanItem, type PlanSource, ymd } from '@squad/core';
import { quoteOnPage } from '@squad/brain';
import { z } from 'zod';
import type { DueLite, PlanChapter } from './logic';

export interface PlannerContextItem {
  kind: string;
  title: string;
  dueAt: number | null;
  /** `source://...` of the synced item (never shown to the model beyond the title). */
  uri: string;
}

export interface PlannerInput {
  now: number;
  examDate: string | null;
  examLabel: string;
  courseId: string;
  courseTitle: string;
  members: { id: string; name: string }[];
  organizerId: string;
  chapters: PlanChapter[];
  /** Text of one page of the course store (for the prompt and for verifying quotes). */
  pageText: (file: string, page: number) => string | undefined;
  due: DueLite[];
  /** Canvas/Google items the organizer may read (own and squad-shared), already gated by the context store. */
  context: PlannerContextItem[];
  /** PRIVATE hints: chapter -> Leitner box 1..5 per member. Only ever used to choose who leads what. */
  boxes: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** PRIVATE hints: busy `YYYY-MM-DD` days per member (no titles). */
  busyDays: ReadonlyMap<string, ReadonlySet<string>>;
  newId: () => string;
}

export interface PlannerUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Estimated from the token counts and the price table below. */
  costUsd?: number;
}

export interface PlannerOutput {
  items: PlanItem[];
  citations: PlanSource[];
  rationale: string;
  model: string;
  usage?: PlannerUsage;
  /** Items the checker repaired or stripped, for the log and the tests. */
  repaired: string[];
}

export type PlanPlanner = (input: PlannerInput) => Promise<PlannerOutput>;

export class PlannerError extends Error {
  override readonly name = 'PlannerError';
  constructor(
    /** Short, safe reason shown on the badge (`Degraded: <reason>`). */
    readonly reason: string,
  ) {
    super(reason);
  }
}

const RawItem = z.object({
  chapter: z.string(),
  ownerId: z.string(),
  kind: z.enum(['review', 'teach', 'practice']).default('review'),
  title: z.string().min(1).max(200),
  topic: z.string().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMin: z.number().int().min(10).max(480).default(60),
  why: z.string().max(400).optional(),
  page: z.number().int().positive().optional(),
  quote: z.string().max(400).optional(),
});
const RawPlan = z.object({
  rationale: z.string().min(1).max(900),
  items: z.array(RawItem).min(1).max(30),
});

/** USD per million tokens, gemini-2.5-flash class (input, output). Used only for the cost estimate in the docs and logs. */
export const PLANNER_PRICE_PER_MTOK = { input: 0.3, output: 2.5 } as const;
export const estimateCostUsd = (inputTokens = 0, outputTokens = 0): number =>
  (inputTokens * PLANNER_PRICE_PER_MTOK.input + outputTokens * PLANNER_PRICE_PER_MTOK.output) /
  1_000_000;

const PRIVATE_WORDS = /\b(box|boxes|mastery|weak(?:est)?|strong(?:est)?|struggl\w*|busy|calendar|meeting|appointment|therapy)\b/i;

const SYSTEM = `You are the study-plan planner for a student squad. You get the course chapters (with the text of each chapter's first page), due items, items from the students' connected Canvas/Google, and private hints about each member. Write a study plan for the whole squad before the exam.
Return ONLY a JSON object: {"rationale": string, "items": [{"chapter": chapter id, "ownerId": a member id, "kind": "review"|"teach"|"practice", "title": string, "topic": string, "date": "YYYY-MM-DD", "durationMin": number, "why": string, "page": number, "quote": string}]}.
Rules:
- Dates are between tomorrow and the day before the exam. Spread the work; do not stack many items on one day; end with a short group practice item on the last day (kind "practice", chapter "all", ownerId the organizer).
- Give every chapter at least one item. Whoever is strongest in a chapter should lead (teach) it; others review.
- "quote" must be copied word for word (3 to 12 words) from the chapter text you were given and "page" must be that page. Never invent a quote.
- "why" is one plain sentence about the material or the due dates. The "rationale" is 2 to 3 plain sentences about how the plan is organised.
- The hints about members are PRIVATE. Never mention any member's strengths, weaknesses, mastery, calendar, busy days or boxes in "why" or "rationale". Use them only to choose owners and dates.
- No points, streaks or rankings. Plain words.`;

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new PlannerError('the planner did not return a plan');
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    throw new PlannerError('the planner returned malformed JSON');
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

/** What the model sees. Private hints are reduced to chapter ids per member id; nothing else about a member. */
export function plannerPrompt(i: PlannerInput): string {
  const today = ymd(i.now);
  const lines: string[] = [
    `Today: ${today}. Exam: ${i.examDate ? `${i.examLabel} on ${i.examDate}` : 'no date known, plan for the next 14 days'}.`,
    `Course: ${i.courseTitle}.`,
    `Members (id: name): ${i.members.map((m) => `${m.id}: ${m.name}`).join('; ')}. Organizer: ${i.organizerId}.`,
    '',
    'Chapters (id | title | file | first page | text of that page):',
  ];
  for (const c of [...i.chapters].sort((a, b) => a.id.localeCompare(b.id)))
    lines.push(
      `${c.id} | ${c.title} | ${c.file} | p.${c.pageStart} | ${clip((i.pageText(c.file, c.pageStart) ?? '').replace(/\s+/g, ' '), 600)}`,
    );
  if (i.due.length) {
    lines.push('', 'Due items (course-wide):');
    for (const d of i.due.slice(0, 15)) lines.push(`- ${d.title} (${d.kind}) on ${ymd(d.dueAt)}`);
  }
  if (i.context.length) {
    lines.push('', 'Items from connected Canvas/Google:');
    for (const c of i.context.slice(0, 15))
      lines.push(`- ${clip(c.title, 80)} (${c.kind})${c.dueAt ? ` due ${ymd(c.dueAt)}` : ''}`);
  }
  lines.push('', 'PRIVATE hints per member (never repeat them): weak chapters / strong chapters / busy days');
  for (const m of i.members) {
    const box = i.boxes.get(m.id);
    const weak = [...(box ?? [])].filter(([, b]) => b <= 2).map(([c]) => c);
    const strong = [...(box ?? [])].filter(([, b]) => b >= 4).map(([c]) => c);
    const busy = [...(i.busyDays.get(m.id) ?? [])].filter((d) => d > today).sort().slice(0, 14);
    lines.push(
      `${m.id}: weak [${weak.join(',')}] strong [${strong.join(',')}] busy [${busy.join(',')}]`,
    );
  }
  return lines.join('\n');
}

/**
 * Checks what the model wrote against what the hub knows. Owners must be members, chapters must exist, dates stay in
 * the window and off the owner's busy days, quotes must be verbatim on the cited page, private words are stripped
 * from the prose. Returns the items, the verified sources and what was repaired. Throws when too little survives.
 */
export function checkPlannerOutput(
  raw: z.infer<typeof RawPlan>,
  i: PlannerInput,
): Pick<PlannerOutput, 'items' | 'citations' | 'rationale' | 'repaired'> {
  const repaired: string[] = [];
  const today = ymd(i.now);
  const lastDay = i.examDate ? addDays(i.examDate, -1) : addDays(today, 14);
  const firstDay = daysBetween(today, lastDay) >= 1 ? addDays(today, 1) : lastDay;
  const members = new Map(i.members.map((m) => [m.id, m.name]));
  const chapters = new Map(i.chapters.map((c) => [c.id, c]));
  const items: PlanItem[] = [];
  const citations: PlanSource[] = [];
  const seenCite = new Set<string>();
  const freeDay = (owner: string, date: string): string => {
    const busy = i.busyDays.get(owner);
    if (!busy?.has(date)) return date;
    const span = daysBetween(firstDay, lastDay);
    for (let k = 1; k <= span; k++)
      for (const d of [addDays(date, k), addDays(date, -k)])
        if (d >= firstDay && d <= lastDay && !busy.has(d)) return d;
    return date;
  };
  for (const r of raw.items) {
    const group = r.chapter === 'all';
    const chapter = group ? undefined : chapters.get(r.chapter);
    if (!group && !chapter) {
      repaired.push(`dropped item for unknown chapter ${r.chapter}`);
      continue;
    }
    let ownerId = r.ownerId;
    if (!members.has(ownerId)) {
      repaired.push(`owner ${ownerId} is not a member, gave it to the organizer`);
      ownerId = i.organizerId;
    }
    let date = r.date;
    if (date < firstDay || date > lastDay) {
      repaired.push(`date ${date} outside the window, moved`);
      date = date < firstDay ? firstDay : lastDay;
    }
    const free = freeDay(ownerId, date);
    if (free !== date) {
      repaired.push('moved an item off its owner busy day');
      date = free;
    }
    let sources: PlanSource[] = [];
    if (chapter && r.page && r.quote) {
      const text = i.pageText(chapter.file, r.page);
      if (text && quoteOnPage(r.quote, text)) {
        const src: PlanSource = {
          kind: 'material',
          label: `${chapter.file} p.${r.page}`,
          file: chapter.file,
          page: r.page,
          chapter: chapter.id,
        };
        sources = [src];
        if (!seenCite.has(src.label)) {
          seenCite.add(src.label);
          citations.push(src);
        }
      } else repaired.push(`stripped an unverified quote for ${chapter.id}`);
    }
    const why = r.why && !PRIVATE_WORDS.test(r.why) ? r.why : undefined;
    if (r.why && !why) repaired.push('removed a private-sounding rationale from an item');
    items.push({
      id: `it_${i.newId()}`,
      ownerId,
      ownerName: members.get(ownerId) ?? ownerId,
      kind: r.kind,
      title: r.title.slice(0, 120),
      ...(chapter ? { chapter: chapter.id, topic: (r.topic ?? chapter.title).slice(0, 120) } : {}),
      ...(!chapter && r.topic ? { topic: r.topic.slice(0, 120) } : {}),
      date,
      durationMin: r.durationMin,
      status: 'todo',
      rev: 1,
      sources,
      ...(why ? { why } : {}),
    });
  }
  const covered = new Set(items.map((x) => x.chapter).filter(Boolean));
  if (items.length < 2 || covered.size < Math.min(chapters.size, 2))
    throw new PlannerError('the planner plan did not cover the course chapters');
  for (const d of i.due.filter((x) => x.dueAt >= i.now).slice(0, 6))
    citations.push({ kind: 'due', label: `${d.title}: ${ymd(d.dueAt)}` });
  for (const c of i.context.slice(0, 4))
    citations.push({ kind: 'syllabus', label: clip(c.title, 80) });
  const rationale = PRIVATE_WORDS.test(raw.rationale)
    ? 'The plan spreads the chapters over the days before the exam, with a group practice on the last day.'
    : raw.rationale;
  if (rationale !== raw.rationale) repaired.push('replaced a private-sounding plan rationale');
  items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { items, citations, rationale, repaired };
}

export interface LlmPlannerOptions {
  /** Hard cap on the call (the chat skill guards the whole request at 20 s). */
  timeoutMs?: number;
  model?: string;
  /** The concrete model id shown on the plan (the request itself uses the `main` tier unless `model` is set). */
  modelLabel?: string;
}

/** The real planner: one call to the raw model (never the resilient demo fallback), checked in code. */
export function createLlmPlanner(llm: Llm, o: LlmPlannerOptions = {}): PlanPlanner {
  const timeoutMs = o.timeoutMs ?? 15_000;
  return async (input) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await llm.complete({
          model: o.model ?? 'main',
          system: SYSTEM,
          messages: plannerPrompt(input),
          temperature: 0.3,
          maxTokens: 4000,
          thinking: 'low',
          signal: ctl.signal,
        });
      } catch (e) {
        throw new PlannerError(
          ctl.signal.aborted ? 'the planner timed out' : `the model call failed (${(e as Error).name})`,
        );
      }
      const parsed = RawPlan.safeParse(extractJson(res.text));
      if (!parsed.success) throw new PlannerError('the planner plan did not match the expected shape');
      const checked = checkPlannerOutput(parsed.data, input);
      const inTok = res.usage?.inputTokens;
      const outTok = res.usage?.outputTokens;
      return {
        ...checked,
        model: o.modelLabel ?? o.model ?? 'main',
        usage: {
          ...(inTok !== undefined ? { inputTokens: inTok } : {}),
          ...(outTok !== undefined ? { outputTokens: outTok } : {}),
          ...(inTok !== undefined || outTok !== undefined
            ? { costUsd: estimateCostUsd(inTok, outTok) }
            : {}),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
