import { registerDemoScript, demoCall, demoText } from '../agents/demo-transport';
import type { StepResult } from '../agents/types';
import { stanceFor } from './demo';
import { normaliseText } from './pure';

/** Context the Ask orchestrator hands to the (scripted) demo transport. Real transports never see it. */
export interface AskDemoContext {
  stage: 'plan' | 'opinion' | 'rank' | 'verdict';
  question: string;
  /** verdict stage: specialists' committed answers, in roster order, with their rank-consensus position. */
  opinions?: { name: string; answer: string; summary: string }[];
  consensus?: string[];
  peerQuestion?: string;
}

const MEMBER = { skeptic: 'Skeptic', teacher: 'Teacher', practitioner: 'Practitioner' } as const;

const submit = (args: Record<string, unknown>): StepResult => ({
  text: '',
  toolCalls: [demoCall('submit_turn', args)],
});

/**
 * Scripted Ask council (demo mode only). It drives the SAME runtime, tools and envelopes as a live run so the
 * board and tests exercise the real code paths; only the model is replaced, and every text goes through demoText().
 */
export function registerAskDemo(): void {
  registerDemoScript('ask', (o) => (input, so, state) => {
    const ctx = (so.context ?? { stage: 'opinion', question: '' }) as AskDemoContext;
    const key = o.spec.key;
    if (key === 'chair') {
      if (ctx.stage === 'plan') {
        if (state.step === 0)
          return {
            text: '',
            toolCalls: o.children.map((c) =>
              demoCall('delegate', {
                to: c,
                question: ctx.question,
                why: demoText(`Get the ${c}'s independent view.`),
              }),
            ),
          };
        return submit({
          summary: demoText('Asked the three specialists to answer independently.'),
          stance: 'waiting for answers',
        });
      }
      const ops = ctx.opinions ?? [];
      const tally = new Map<string, { n: number; answer: string }>();
      for (const op of ops) {
        const k = normaliseText(op.answer);
        tally.set(k, { n: (tally.get(k)?.n ?? 0) + 1, answer: op.answer });
      }
      const top = [...tally.values()].sort((a, b) => b.n - a.n)[0];
      const answer = top?.answer ?? 'Check assumptions first';
      const against = ops.find((op) => normaliseText(op.answer) !== normaliseText(answer));
      return submit({
        summary: demoText(`The council leans toward: ${answer}.`),
        stance: demoText('Try it on a small example yourself to check.'),
        answer,
        confidence: against ? 'fairly_sure' : 'confident',
        ...(against
          ? { dissent: { member: against.name, why: demoText('Their view is kept on record.') } }
          : {}),
      });
    }
    const name = MEMBER[key as keyof typeof MEMBER] ?? key;
    if (ctx.peerQuestion)
      return submit({
        summary: demoText('Short answer: yes, as long as the stated assumption holds.'),
        stance: 'answered a colleague',
      });
    if (ctx.stage === 'rank')
      return submit({
        summary: demoText('The better reasoning states its assumptions before choosing.'),
        stance: 'ranked',
        order: ['A', 'B'],
      });
    // opinion: the skeptic consults the teacher once, to show the peer path
    if (key === 'skeptic' && state.step === 0 && o.children.includes('teacher'))
      return {
        text: '',
        toolCalls: [
          demoCall('ask_peer', { to: 'teacher', question: demoText('Does step 2 assume a fixed value?') }),
        ],
      };
    const s = stanceFor(name as 'Skeptic' | 'Teacher' | 'Practitioner', ctx.question);
    return submit({
      summary: demoText(s.position),
      stance: demoText(s.answer),
      answer: s.answer,
    });
  });
}
