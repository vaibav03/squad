import { z } from 'zod';
import type { Llm, ModelTier } from '@squad/core';
import type { EmitEvent } from '../mastery/types';
import { aggregateRankings, pickDissenter, repairOrder } from './pure';

export interface CouncilMember {
  name: string;
  /** System prompt for this member (persona or solver instructions). */
  system: string;
}

export interface Opinion {
  member: string;
  text: string;
  answer: string;
}
export interface Ranking {
  member: string;
  order: string[];
}
export interface Verdict {
  text: string;
  answer: string;
  dissent: boolean;
  dissenter?: string;
}

/** Lets a council compute its verdict in code (or with its own LLM call) instead of the default chair prompt. */
export type DecideFn = (input: {
  opinions: Opinion[];
  rankings: Ranking[];
  consensusOrder: string[];
}) => Promise<{ text: string; answer: string; dissenter?: string }>;

export interface CouncilConfig {
  /** Short id: events carry `council:<id>`. */
  id: string;
  members: CouncilMember[];
  chair: { name: string; system: string };
  /** The shared task every member sees. */
  task: string;
  /** What the opinion `answer` field should hold (shown to the model). */
  answerHint?: string;
  llm: Llm;
  emit: EmitEvent;
  memberModel?: ModelTier;
  chairModel?: ModelTier;
  decide?: DecideFn;
  /** Prompt version, recorded in system prompts for reviewability. */
  promptVersion?: string;
}

const OpinionSchema = z.object({ text: z.string(), answer: z.string().default('') });
const RankingSchema = z.object({ order: z.array(z.string()) });
const VerdictSchema = z.object({ text: z.string(), answer: z.string().default('') });

export interface CouncilRun {
  /** 'council:quizkey' | 'council:planner' */
  id: string;
  opinions(): Promise<Opinion[]>;
  rankings(): Promise<Ranking[]>;
  verdict(): Promise<Verdict>;
}

/**
 * Three discrete awaited steps: opinions -> rankings -> verdict. Members run in parallel within a
 * phase but events are emitted in member order, so replays are deterministic. Out-of-order calls
 * throw. Each step is memoised.
 */
export function createCouncilRun(cfg: CouncilConfig): CouncilRun {
  const id = `council:${cfg.id}`;
  const names = cfg.members.map((m) => m.name);
  const memberModel = cfg.memberModel ?? 'main';
  const chairModel = cfg.chairModel ?? 'chair';
  const ver = cfg.promptVersion ? `\n[prompt ${cfg.promptVersion}]` : '';
  let opinionsP: Promise<Opinion[]> | undefined;
  let rankingsP: Promise<Ranking[]> | undefined;
  let verdictP: Promise<Verdict> | undefined;
  let consensus: string[] = [];

  const safeEmit = async (e: Parameters<EmitEvent>[0]) => {
    try {
      await cfg.emit(e);
    } catch (err) {
      console.warn(`[${id}] emit failed`, (err as Error).message);
    }
  };

  async function runOpinions(): Promise<Opinion[]> {
    await safeEmit({ t: 'agent.state', agent: id, state: 'studying' });
    const out = await Promise.all(
      cfg.members.map(async (m) => {
        const r = await cfg.llm.json({
          model: memberModel,
          system: `${m.system}${ver}`,
          messages: `${cfg.task}\n\nGive your independent opinion as JSON {"text": short reasoning, "answer": ${cfg.answerHint ?? 'your final answer, short'}}.`,
          schema: OpinionSchema,
          temperature: 0,
        });
        return { member: m.name, text: r.text, answer: r.answer } satisfies Opinion;
      }),
    );
    for (const o of out) {
      await safeEmit({ t: 'council.opinion', councilId: id, member: o.member, text: o.text });
    }
    return out;
  }

  async function runRankings(ops: Opinion[]): Promise<Ranking[]> {
    const out = await Promise.all(
      cfg.members.map(async (m) => {
        const others = ops.filter((o) => o.member !== m.name);
        const r = await cfg.llm.json({
          model: memberModel,
          system: `${m.system}${ver}`,
          messages: `${cfg.task}\n\nRank the other members' opinions, best first, as JSON {"order": [member names]}.\n\n${others
            .map((o) => `${o.member}: ${o.text} (answer: ${o.answer})`)
            .join('\n')}`,
          schema: RankingSchema,
          temperature: 0,
        });
        return {
          member: m.name,
          order: repairOrder(
            r.order,
            names.filter((n) => n !== m.name),
          ),
        } satisfies Ranking;
      }),
    );
    for (const r of out) {
      await safeEmit({ t: 'council.rank', councilId: id, member: r.member, order: r.order });
    }
    consensus = aggregateRankings(out, names);
    return out;
  }

  async function runVerdict(ops: Opinion[], ranks: Ranking[]): Promise<Verdict> {
    const decided: { text: string; answer: string; dissenter?: string } = cfg.decide
      ? await cfg.decide({ opinions: ops, rankings: ranks, consensusOrder: consensus })
      : await cfg.llm
          .json({
            model: chairModel,
            system: `${cfg.chair.system}${ver}`,
            messages: `${cfg.task}\n\nOpinions (consensus ranking, best first: ${consensus.join(', ')}):\n${ops
              .map((o) => `${o.member}: ${o.text} (answer: ${o.answer})`)
              .join('\n')}\n\nGive the verdict as JSON {"text": verdict, "answer": final answer}.`,
            schema: VerdictSchema,
            temperature: 0,
          })
          .then((v) => ({ text: v.text, answer: v.answer }));
    // A custom `decide` owns the dissenter; the default chair path derives it from the answers.
    const dissenter = cfg.decide
      ? decided.dissenter
      : pickDissenter(
          ops.map((o) => ({ member: o.member, answer: o.answer })),
          decided.answer,
          names,
        );
    const verdict: Verdict = {
      text: decided.text,
      answer: decided.answer,
      dissent: dissenter !== undefined,
      ...(dissenter !== undefined ? { dissenter } : {}),
    };
    await safeEmit({
      t: 'council.verdict',
      councilId: id,
      member: cfg.chair.name,
      text: verdict.text,
      dissent: verdict.dissent,
      ...(dissenter !== undefined ? { dissenter } : {}),
    });
    await safeEmit({ t: 'agent.state', agent: id, state: 'idle' });
    return verdict;
  }

  return {
    id,
    opinions() {
      return (opinionsP ??= runOpinions());
    },
    async rankings() {
      if (!opinionsP) throw new Error(`${id}: rankings() called before opinions()`);
      const ops = await opinionsP;
      return (rankingsP ??= runRankings(ops));
    },
    async verdict() {
      if (!opinionsP || !rankingsP) throw new Error(`${id}: verdict() called before rankings()`);
      const [ops, ranks] = await Promise.all([opinionsP, rankingsP]);
      return (verdictP ??= runVerdict(ops, ranks));
    },
  };
}
