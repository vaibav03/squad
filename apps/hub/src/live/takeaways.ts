// Live takeaways: built after every 2 turns and at the end. Real path = Llm.json (tier fast); demo/tests/fallback = a
// deterministic heuristic. Every item links to the transcript turn it came from; sources come only from verified chips.
import { z } from 'zod';
import {
  LiveTakeawaysSchema,
  type Llm,
  type LiveCitation,
  type LiveTakeaways,
  type LiveTurn,
} from '@squad/core';
import { personaName } from './protocol';

export interface TakeawayInput {
  topic: string;
  turns: readonly LiveTurn[];
}
export interface TakeawayBuilder {
  build(i: TakeawayInput): Promise<LiveTakeaways>;
}

const clip = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
const sentences = (t: string): string[] =>
  (t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
const nameOf = (s: LiveTurn['speaker']): string => (s === 'user' ? 'You' : personaName(s));

export const emptyTakeaways = (topic: string): LiveTakeaways => ({
  whereWeAre: clip(`Starting on ${topic}.`, 240),
  decisions: [],
  disagreements: [],
  nextSteps: [],
  sources: [],
  quiz: [],
  grounding: 'general',
});

function sourcesOf(turns: readonly LiveTurn[]): LiveTakeaways['sources'] {
  const seen = new Set<string>();
  const out: LiveTakeaways['sources'] = [];
  for (const t of turns)
    for (const c of t.citations) {
      const k = `${c.file}#${c.page}`;
      if (seen.has(k) || out.length >= 12) continue;
      seen.add(k);
      out.push({ ...c, turnId: t.id });
    }
  return out;
}

const finish = (t: LiveTakeaways): LiveTakeaways =>
  LiveTakeawaysSchema.parse({ ...t, grounding: t.sources.length > 0 ? 'course' : 'general' });

/** Deterministic: keyed by who said it (Chair decides, Skeptic doubts, Planner plans, Examiner asks). */
export function heuristicTakeaways(i: TakeawayInput): LiveTakeaways {
  const agent = i.turns.filter((t) => t.speaker !== 'user');
  const by = (id: string) => agent.filter((t) => t.speaker === id);
  const seen = new Set<string>();
  const fresh = (x: string): boolean => {
    const k = x
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const tutor = by('tutor')[0];
  const decisions: LiveTakeaways['decisions'] = [];
  const pushD = (text: string, turnId: string) => {
    if (decisions.length < 3 && fresh(text))
      decisions.push({ id: `d${decisions.length + 1}`, text: clip(text, 240), turnId });
  };
  for (const t of by('chair')) {
    const s = sentences(t.text).find((x) => /\b(agree|decid|settle|conclude)/i.test(x));
    if (s) pushD(s, t.id);
  }
  if (tutor) {
    const s = sentences(tutor.text)[0];
    if (s) pushD(s, tutor.id);
  }
  const disagreements: LiveTakeaways['disagreements'] = [];
  const sk = by('skeptic')[0];
  if (sk) {
    const [view, why] = sentences(sk.text);
    disagreements.push({
      id: 'x1',
      topic: clip(i.topic.replace(/[\s.?!…]+$/, ''), 160),
      stances: [
        ...(tutor
          ? [{ who: 'Tutor', view: clip(sentences(tutor.text)[0] ?? tutor.text, 240) }]
          : []),
        { who: 'Skeptic', view: clip(view ?? sk.text, 240) },
      ],
      why: clip(why ?? 'The evidence is not settled yet.', 280),
      turnId: sk.id,
    });
  }
  const nextSteps: LiveTakeaways['nextSteps'] = [];
  for (const t of by('planner')) {
    const s = sentences(t.text).find((x) => /\b(first|then|next|plan|schedule|book)\b/i.test(x));
    if (s && nextSteps.length < 3 && fresh(s))
      nextSteps.push({
        id: `n${nextSteps.length + 1}`,
        text: clip(s, 200),
        owner: 'You',
        turnId: t.id,
      });
  }
  const quiz: LiveTakeaways['quiz'] = [];
  for (const t of by('examiner')) {
    const q = sentences(t.text).find((x) => x.includes('?'));
    if (q && quiz.length < 3 && fresh(q))
      quiz.push({
        id: `q${quiz.length + 1}`,
        question: clip(q.replace(/^A test would ask:\s*/i, ''), 240),
        turnId: t.id,
      });
  }
  const last = agent.at(-1);
  return finish({
    whereWeAre: clip(
      last
        ? `${agent.length} turns in on ${i.topic}. Last word: ${nameOf(last.speaker)}.`
        : `Starting on ${i.topic}.`,
      240,
    ),
    decisions,
    disagreements,
    nextSteps,
    sources: sourcesOf(i.turns),
    quiz,
    grounding: 'general',
  });
}

export const heuristicBuilder: TakeawayBuilder = {
  build: (i) => Promise.resolve(heuristicTakeaways(i)),
};

const T = z.number().int().positive().optional();
const LlmOut = z.object({
  whereWeAre: z.string(),
  decisions: z.array(z.object({ text: z.string(), turn: T })).max(6),
  disagreements: z
    .array(
      z.object({
        topic: z.string(),
        stances: z.array(z.object({ who: z.string(), view: z.string() })).max(5),
        why: z.string(),
        turn: T,
      }),
    )
    .max(4),
  nextSteps: z.array(z.object({ text: z.string(), owner: z.string().optional(), turn: T })).max(6),
  quiz: z.array(z.object({ question: z.string(), turn: T })).max(6),
});

const SYSTEM =
  'You write live study-group notes from a transcript of AI agents discussing a topic with a student. ' +
  'Return JSON: whereWeAre (one line), decisions, disagreements (keep who said what and why), nextSteps, quiz (what to quiz the student on). ' +
  'Each item may carry "turn": the number N of the transcript line (tN) it came from. Use only what was said. No grades or private values.';

/** Real path: one cheap structured call; falls back to the heuristic when it fails. */
export function createLlmTakeaways(llm: Llm): TakeawayBuilder {
  return {
    async build(i) {
      try {
        const ts = i.turns.map((t) => `t${t.n} [${nameOf(t.speaker)}]: ${t.text}`).join('\n');
        const out = await llm.json({
          model: 'fast',
          system: SYSTEM,
          messages: `Topic: ${i.topic}\n\nTranscript:\n${ts}`,
          schema: LlmOut,
          temperature: 0,
        });
        const turnId = (n: number | undefined): { turnId?: string } => {
          const t = n === undefined ? undefined : i.turns.find((x) => x.n === n);
          return t ? { turnId: t.id } : {};
        };
        return finish({
          whereWeAre: clip(out.whereWeAre, 240),
          decisions: out.decisions.map((d, k) => ({
            id: `d${k + 1}`,
            text: clip(d.text, 240),
            ...turnId(d.turn),
          })),
          disagreements: out.disagreements.map((d, k) => ({
            id: `x${k + 1}`,
            topic: clip(d.topic, 160),
            stances: d.stances.map((s) => ({ who: clip(s.who, 40), view: clip(s.view, 240) })),
            why: clip(d.why, 280),
            ...turnId(d.turn),
          })),
          nextSteps: out.nextSteps.map((n, k) => ({
            id: `n${k + 1}`,
            text: clip(n.text, 200),
            ...(n.owner ? { owner: clip(n.owner, 40) } : {}),
            ...turnId(n.turn),
          })),
          quiz: out.quiz.map((q, k) => ({
            id: `q${k + 1}`,
            question: clip(q.question, 240),
            ...turnId(q.turn),
          })),
          sources: sourcesOf(i.turns),
          grounding: 'general',
        });
      } catch {
        return heuristicTakeaways(i);
      }
    },
  };
}

export type { LiveCitation };
