import { z } from 'zod';
import type { Llm } from '@squad/core';
import type { EmitEvent } from '../mastery/types';
import type { KeyVerdict, KeyVerifier, QuestionDraft } from '../quiz/types';
import type { CouncilAgents } from '../agents/factory';
import { createCouncilRun, type CouncilMember } from './council';
import { verifyWithAgents } from './quizkey-agents';
import { normaliseText, pickDissenter } from './pure';

export const QUIZKEY_PROMPT_VERSION = 'quizkey-v1';
export const SOLVERS = ['solver-a', 'solver-b', 'solver-c'] as const;

const SOLVER_SYSTEM = (n: string) =>
  `You are ${n}, an independent solver. Answer the question using ONLY the chapter material. Think briefly, then commit to one answer. You have not seen any answer key.`;

const EquivSchema = z.object({ equivalent: z.array(z.boolean()) });

export interface QuizKeyOptions {
  llm: Llm;
  emit: EmitEvent;
  /** Real agent runtime: three distinct blind solver agents + a Checker. Without it the legacy single-model council runs. */
  agents?: CouncilAgents;
}

/** The blind part of the task: question, choices and chapter. NEVER the key. */
function taskFor(draft: QuestionDraft, chapterContext: string): string {
  const choices =
    draft.kind === 'choice' && draft.choices
      ? `\nChoices:\n${draft.choices.map((c, i) => `${i}: ${c}`).join('\n')}`
      : '';
  return `Chapter material:\n${chapterContext}\n\nQuestion: ${draft.question}${choices}`;
}

/** council:quizkey: 3 blind solves; any disagreement with the key drops the question. */
export function createQuizKeyVerifier(opts: QuizKeyOptions): KeyVerifier {
  return {
    async verify(draft, ctx): Promise<KeyVerdict> {
      if (opts.agents && opts.agents.flag === 'v2') {
        const r = await verifyWithAgents({ agents: opts.agents, emit: opts.emit }, draft, ctx);
        return { ok: r.ok, dissent: r.dissent, ...(r.dissenter ? { dissenter: r.dissenter } : {}) };
      }
      const members: CouncilMember[] = SOLVERS.map((name) => ({
        name,
        system: SOLVER_SYSTEM(name),
      }));
      const keyText =
        draft.kind === 'choice' ? String(draft.key) : normaliseText(String(draft.key));
      const run = createCouncilRun({
        id: 'quizkey',
        members,
        chair: {
          name: 'chair',
          system: 'You compare solver answers. You never reveal an answer key.',
        },
        task: taskFor(draft, ctx.chapterContext),
        answerHint:
          draft.kind === 'choice'
            ? 'the 0-based index of the chosen choice, digits only'
            : 'your final answer, short',
        llm: opts.llm,
        emit: opts.emit,
        promptVersion: QUIZKEY_PROMPT_VERSION,
        decide: async ({ opinions }) => {
          const answers = opinions.map((o) => ({ member: o.member, answer: o.answer.trim() }));
          let matches: boolean[];
          if (draft.kind === 'choice') {
            matches = answers.map((a) => a.answer.replace(/\D+/g, '') === keyText);
          } else {
            matches = answers.map((a) => normaliseText(a.answer) === keyText);
            if (matches.some((m) => !m)) {
              // chair equivalence check for free text; the key is visible only to this step
              const r = await opts.llm.json({
                model: 'chair',
                system:
                  'You judge whether each solver answer is equivalent to the reference. JSON only.',
                messages: `Question: ${draft.question}\nReference: ${String(draft.key)}\nSolver answers in order:\n${answers
                  .map((a, i) => `${i}: ${a.answer}`)
                  .join('\n')}\nReturn {"equivalent": [booleans, one per solver in order]}.`,
                schema: EquivSchema,
                temperature: 0,
              });
              matches = answers.map((_, i) => matches[i] || r.equivalent[i] === true);
            }
          }
          const firstBad = answers.find((_, i) => !matches[i])?.member;
          // An answer that matched counts as equal to the key; encode that for pickDissenter.
          const normalisedAnswers = answers.map((a, i) => ({
            member: a.member,
            answer: matches[i] ? keyText : `${a.answer}\u0000differs`,
          }));
          const dissenter = pickDissenter(normalisedAnswers, keyText, SOLVERS) ?? firstBad;
          return {
            text: dissenter
              ? 'Uncertain: the solvers disagree, so this question is dropped.'
              : 'Verified: all solvers agree.',
            answer: keyText,
            ...(dissenter ? { dissenter } : {}),
          };
        },
      });
      await run.opinions();
      await run.rankings();
      const v = await run.verdict();
      return {
        ok: !v.dissent,
        dissent: v.dissent,
        ...(v.dissenter ? { dissenter: v.dissenter } : {}),
      };
    },
  };
}
