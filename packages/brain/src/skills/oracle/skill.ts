import { z } from 'zod';
import {
  scripted,
  type AgentMode,
  type Ctx,
  type InboundMessage,
  type Llm,
  type OutboundMessage,
  type Skill,
} from '@squad/core';
import { fallbackMode, modeLabel, startMode, worse, type ModeDeps } from '../mode-util';
import { loadPrompt } from '../../experts/prompts';
import type { CourseStore } from '../../ingest/types';
import type { EmitEvent, MasteryStore } from '../../mastery/types';
import {
  buildOracleOutcome,
  clip,
  privateDetail,
  stateWords,
  oracleWorkloadWords,
} from './outcome';
import { examWeights, isExamChapter, isExamPage, rankChapters, type RankedChapter } from './rank';

export const ORACLE_PROMPT_VERSION = 'oracle.question-v1';
export const ORACLE_AGENT = 'expert:oracle';
export const ORACLE_COUNCIL = 'council:oracle';
const MAX_QUESTION = 300;
const CONTEXT_CHARS = 3500;
const NOTE = 'This is a suggestion, never a grade.';

/** Anchored on purpose: banter about exams must never trigger it. */
export const ORACLE_TRIGGERS: readonly RegExp[] = [
  /\bexam\s+oracle\b/i,
  /\bwhat\s+should\s+i\s+study\s+next\b/i,
  /\bpredict\s+(?:my|the)\s+exam\b/i,
];
export const isOracleRequest = (text: string): boolean => ORACLE_TRIGGERS.some((r) => r.test(text));

export interface OracleSkillDeps extends ModeDeps {
  store: CourseStore;
  mastery: MasteryStore;
  emit: EmitEvent;
  /** Falls back to `ctx.llm`. */
  llm?: Llm;
  courseIdFor?: (m: InboundMessage, ctx: Ctx) => string;
  now?: () => number;
}

const QuestionSchema = z.object({ question: z.string(), why: z.string().optional() });

export const oracleFallbackQuestion = (title: string): string =>
  `In your own words: what is the main idea of ${title}, and where does it show up in an exam?`;

/** Non-empty, short, and not an answer key. */
export function validQuestion(q: string): boolean {
  const t = q.trim();
  if (!t || t.length > MAX_QUESTION) return false;
  if (/^(?:answer|key|solution|correct\s+answer)\b\s*[:-]/i.test(t)) return false;
  if (/\b(?:answer\s*key|correct\s+answer|the\s+answer\s+is)\b/i.test(t)) return false;
  return true;
}

const plainWhy = (s: string): boolean =>
  !!s.trim() && s.length <= 200 && !/\d+\s*%|\bgrade|\bscore|\d+\s*\/\s*\d+/i.test(s);

export function defaultWhy(r: RankedChapter): string {
  const bits: string[] = [];
  if (!r.practised) bits.push('you have not practised it yet');
  else if (r.due) bits.push('it is due for review');
  else if (r.box <= 2) bits.push('it still needs review');
  if (r.weight >= 0.5) bits.push('past exams lean on it heavily');
  else if (r.weight > 0) bits.push('it appears in past exams');
  if (!bits.length) bits.push('it is your best next review');
  return clip(`${r.title}: ${bits.join(' and ')}.`, 220);
}

export interface OracleTopic {
  chapter: string;
  title: string;
  why: string;
  question: string;
  usedFallback: boolean;
  /** `live` unless this topic's text is scripted (then `demo:*` / `degraded:*`). */
  mode: AgentMode;
}

export interface OracleRun {
  /** Worst mode of the run, decided once at the start and only worsened. */
  mode: AgentMode;
  ranked: RankedChapter[];
  topics: OracleTopic[];
  replyText: string;
}

/** Collects past-exam / syllabus text for the weights. */
function examTexts(store: CourseStore, courseId: string): string[] {
  const texts = store
    .getPages(courseId)
    .filter(isExamPage)
    .map((p) => p.text);
  const policy = store.getCourse(courseId)?.policy;
  if (policy) {
    const lines = policy.split(/\n+/).filter((l) => /exam|midterm|final|topic|cover/i.test(l));
    if (lines.length) texts.push(lines.join('\n'));
  }
  return texts;
}

async function askQuestion(
  llm: Llm,
  store: CourseStore,
  courseId: string,
  r: RankedChapter,
  why: string,
): Promise<{ question: string; why: string } | undefined> {
  const context = clip(store.chapterContext(courseId, r.chapter), CONTEXT_CHARS);
  const res = await llm.json({
    model: 'fast',
    temperature: 0.2,
    system: loadPrompt(import.meta.url, 'oracle.question.md'),
    messages: `Chapter: ${r.title}\nWhy it matters now: ${why}\n\nChapter text:\n${context}`,
    schema: QuestionSchema,
  });
  if (!validQuestion(res.question)) return undefined;
  return {
    question: res.question.trim(),
    why: res.why && plainWhy(res.why) ? res.why.trim() : why,
  };
}

export async function runOracle(
  deps: OracleSkillDeps & { llm: Llm },
  input: { student: string; courseId: string; chatId: string; group?: boolean },
): Promise<OracleRun | undefined> {
  const { store, mastery, emit, llm } = deps;
  const now = deps.now?.() ?? Date.now();
  const { courseId, student } = input;
  const chapters = store.listChapters(courseId).filter((c) => !isExamChapter(c));
  if (!chapters.length) return undefined;

  await emit({ t: 'agent.state', agent: ORACLE_AGENT, state: 'studying' });
  const rows = mastery.forStudent(student, courseId);
  const ranked = rankChapters(
    chapters,
    rows,
    examWeights(chapters, examTexts(store, courseId)),
    now,
  );

  const start = startMode(deps); // decided ONCE
  let runMode: AgentMode = start;
  let llmOk = true;
  let lastErr: unknown;
  const topics: OracleTopic[] = [];
  for (const r of ranked.slice(0, 3)) {
    const fb = fallbackMode(start, lastErr);
    // code-derived explanation: branded as scripted wherever it stands in for the model
    let why = scripted(defaultWhy(r), fb).text;
    let question = scripted(oracleFallbackQuestion(r.title), fb).text;
    let usedFallback = true;
    if (llmOk) {
      try {
        const got = await askQuestion(llm, store, courseId, r, why);
        if (got) {
          question = got.question;
          why = clip(got.why, 220);
          usedFallback = false;
        }
      } catch (e) {
        lastErr = e;
        llmOk = false; // no retries, no further calls after a failure (e.g. HTTP 402)
      }
    }
    const topicMode: AgentMode = usedFallback ? fallbackMode(start, lastErr) : start;
    runMode = worse(runMode, topicMode);
    topics.push({
      chapter: r.chapter,
      title: r.title,
      why,
      question: clip(question, 600),
      usedFallback,
      mode: topicMode,
    });
  }

  const pageCount = (id: string): number => {
    const c = chapters.find((x) => x.id === id);
    return c ? Math.max(1, c.pageEnd - c.pageStart + 1) : 1;
  };
  const pages = topics.reduce((n, t) => n + pageCount(t.chapter), 0);
  const outcome = buildOracleOutcome({ ranked, topics, pages });

  for (const [i, t] of topics.entries())
    await emit({
      t: 'quiz.question',
      quizId: `oracle:${i + 1}-${t.chapter}`,
      chapter: `oracle:${t.chapter}`,
      student,
      target: student,
      text: t.question,
      mode: runMode,
    });
  for (const t of topics)
    await emit({
      t: 'council.opinion',
      councilId: ORACLE_COUNCIL,
      member: 'oracle',
      text: t.why,
      mode: runMode,
    });
  await emit({
    t: 'council.verdict',
    councilId: ORACLE_COUNCIL,
    member: 'oracle',
    text: clip(
      `Start with ${topics[0]!.title}, then ${
        topics
          .slice(1)
          .map((t) => t.title)
          .join(' and ') || 'review the rest'
      }.`,
      220,
    ),
    outcome,
    mode: runMode,
  });
  await emit({ t: 'agent.state', agent: ORACLE_AGENT, state: 'idle' });

  const byCh = new Map(rows.map((r) => [r.chapter, r.nextDue]));
  const lines = [
    `${modeLabel(runMode)}Exam Oracle: what to study next`,
    '',
    'Ranked chapters:',
    ...ranked.map(
      (r, i) =>
        `${i + 1}. ${r.chapter} ${r.title} (${input.group ? stateWords(r) : privateDetail(r, byCh.get(r.chapter), now)})`,
    ),
    '',
    'Top topics with a mock question each:',
    ...topics.flatMap((t, i) => [`${i + 1}. ${t.title}`, `   Q: ${t.question}`]),
    '',
    `Workload: ${oracleWorkloadWords(pages)}.`,
    NOTE,
  ];
  return { mode: runMode, ranked, topics, replyText: lines.join('\n') };
}

export function createOracleSkill(deps: OracleSkillDeps): Skill {
  return {
    name: 'oracle',
    async match(m: InboundMessage) {
      return m.mentionsBot && isOracleRequest(m.text) ? 0.95 : 0;
    },
    async handle(m: InboundMessage, ctx: Ctx): Promise<OutboundMessage[]> {
      const courseId = deps.courseIdFor?.(m, ctx) ?? 'default';
      const res = await runOracle(
        { ...deps, llm: deps.llm ?? ctx.llm },
        { student: m.from, courseId, chatId: m.chatId, group: m.isGroup },
      );
      if (!res)
        return [
          {
            chatId: m.chatId,
            text: 'I have no chapters for this course yet, so there is nothing to rank. Ingest the course materials and ask again.',
          },
        ];
      return [{ chatId: m.chatId, text: res.replyText }];
    },
  };
}
