import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Db, Skill, VillageEvent } from '@squad/core';
import { createTestBot, TEST_ROSTER, type TestBot } from '../testing';
import type { Decision, EventPublisher, Roster } from '../types';
import { STUB_SKILLS } from './stub-skills';

const Step = z.union([
  z.strictObject({
    as: z.string(),
    chat: z.string().describe("'group:<name>' or 'dm'"),
    say: z.string(),
    advance: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('virtual ms to advance BEFORE this step'),
  }),
  z.strictObject({ wait: z.number().int().nonnegative() }),
]);

export const SessionScriptSchema = z.strictObject({
  name: z.string().min(1),
  cast: z.record(z.string(), z.string()).optional(),
  students: z
    .array(z.strictObject({ id: z.string(), name: z.string(), handle: z.string().optional() }))
    .optional(),
  groups: z.array(z.strictObject({ id: z.string(), members: z.array(z.string()) })).optional(),
  stubSkills: z.array(z.string()).optional(),
  steps: z.array(Step).min(1),
});
export type SessionScript = z.infer<typeof SessionScriptSchema>;

export function loadScript(file: string): SessionScript {
  return SessionScriptSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface ScriptResult {
  sent: TestBot['sent'];
  events: VillageEvent[];
  decisions: Decision[];
  /** steps whose handler was still waiting (e.g. an unanswered confirm) when the script ended */
  unresolved: number;
}

const settle = () => new Promise((r) => setTimeout(r, 5));

/** Drive a Bot through a session on a virtual clock (no real sleeping). */
export async function runScript(
  script: SessionScript,
  opts: { skills?: Skill[]; tap?: EventPublisher; chat?: boolean; db?: Db; drainMs?: number } = {},
): Promise<ScriptResult & { bot: TestBot }> {
  const stubs = (script.stubSkills ?? []).map((n) => {
    const s = STUB_SKILLS[n];
    if (!s) throw new Error(`unknown stub skill "${n}"`);
    return s;
  });
  const roster: Roster = script.students
    ? {
        students: script.students.map((s, i) => ({
          id: s.id,
          name: s.name,
          handle: s.handle ?? `+1555000020${i}`,
        })),
        chats: (script.groups ?? []).map((g) => ({ id: g.id, name: g.id, members: g.members })),
      }
    : TEST_ROSTER;
  const bot = createTestBot({
    skills: [...stubs, ...(opts.skills ?? [])],
    roster,
    tap: opts.tap,
    chat: opts.chat,
    db: opts.db,
  });
  const pending: Promise<unknown>[] = [];
  for (const step of script.steps) {
    if ('wait' in step) {
      bot.advance(step.wait);
      continue;
    }
    if (step.advance) bot.advance(step.advance);
    pending.push(bot.say(step.as, step.chat, step.say));
    await settle();
  }
  let done = 0;
  await Promise.race([
    Promise.all(pending.map((p) => p.then(() => done++))),
    new Promise((r) => setTimeout(r, opts.drainMs ?? 100)),
  ]);
  return {
    bot,
    sent: bot.sent,
    events: bot.events,
    decisions: bot.decisions().map((d) => d.decision),
    unresolved: pending.length - done,
  };
}
