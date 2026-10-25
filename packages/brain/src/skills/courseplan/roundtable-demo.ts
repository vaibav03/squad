import { demoCall, demoText, registerDemoScript } from '../../agents/demo-transport';
import type { StepResult } from '../../agents/types';

interface Ctx {
  stage?: 'plan' | 'rank' | 'verdict';
  eligible?: { id: string; credits: number }[];
  targets?: Record<string, number>;
  courses?: string[];
  answer?: string;
  dissenter?: string;
}

const submit = (args: Record<string, unknown>): StepResult => ({
  text: '',
  toolCalls: [demoCall('submit_turn', args)],
});

const LINES: Record<string, string> = {
  chill: 'Keep the load light so there is room to sleep and breathe.',
  grind: 'Fill the term to the cap to finish requirements sooner.',
  advisor: 'Balance requirement progress with a workload that is sustainable.',
};

/** Greedy pick of eligible ids up to the persona's credit target (the checked rules repair anything off). */
function pick(ctx: Ctx, key: string): string[] {
  const goal = ctx.targets?.[key] ?? 12;
  const out: string[] = [];
  let sum = 0;
  for (const c of ctx.eligible ?? []) {
    if (sum + c.credits > goal) continue;
    out.push(c.id);
    sum += c.credits;
  }
  return out;
}

/** Scripted Round Table (demo mode only): the SAME runtime, tools and envelopes; only the model is replaced. */
export function registerRoundtableDemo(): void {
  registerDemoScript('roundtable', (o) => (_input, so, state) => {
    const ctx = (so.context ?? {}) as Ctx;
    const key = o.spec.key;
    if (key === 'chairman') {
      if (ctx.stage === 'plan') {
        if (state.step === 0)
          return {
            text: '',
            toolCalls: o.children.map((c) =>
              demoCall('delegate', {
                to: c,
                question: demoText(`Propose your plan from the ${c}'s angle.`),
                why: demoText(`Get ${c}'s plan.`),
              }),
            ),
          };
        return submit({
          summary: demoText('Asked the three planners for their picks.'),
          stance: 'waiting for plans',
        });
      }
      return submit({
        summary: demoText('The checked plan is announced below.'),
        stance: demoText('Confirm it with your real advisor.'),
        answer: ctx.answer ?? '',
        confidence: 'confident',
        ...(ctx.dissenter
          ? { dissent: { member: ctx.dissenter, why: demoText('Their plan is kept on record.') } }
          : {}),
      });
    }
    if (ctx.stage === 'rank')
      return submit({
        summary: demoText('The better plan fits the limits and the requirements.'),
        stance: 'ranked',
        order: ['A', 'B'],
      });
    return submit({
      summary: demoText(LINES[key] ?? 'Scripted demo plan.'),
      stance: demoText('demo plan'),
      answer: pick(ctx, key).join(', '),
    });
  });
}
