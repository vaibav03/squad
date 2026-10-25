import { z } from 'zod';
import { VillageEventSchema } from './events';

/** Replay script, docs/specs/09-game-scenes.md. `at` is ms from start. */
export const ReplayScriptSchema = z
  .strictObject({
    name: z.string().min(1),
    version: z.literal(1),
    loop: z.boolean(),
    cast: z.object({ me: z.string().min(1) }).catchall(z.string()), // `me` = the viewing student
    events: z.array(
      z.strictObject({ at: z.number().int().nonnegative(), event: VillageEventSchema }),
    ),
    checkpoints: z.record(z.string(), z.number().int().nonnegative()), // name -> ms (jump targets)
  })
  .superRefine((s, ctx) => {
    s.events.forEach((e, i) => {
      const prev = s.events[i - 1];
      if (prev && e.at < prev.at) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', i, 'at'],
          message: `events must be ordered by "at" (${e.at} < ${prev.at})`,
        });
      }
    });
    const end = s.events.at(-1)?.at ?? 0;
    for (const [k, ms] of Object.entries(s.checkpoints)) {
      if (ms > end) {
        ctx.addIssue({
          code: 'custom',
          path: ['checkpoints', k],
          message: `checkpoint "${k}" (${ms}ms) is after the last event (${end}ms)`,
        });
      }
    }
  });

export type ReplayScript = z.infer<typeof ReplayScriptSchema>;

export type ReplayValidation = { ok: true; script: ReplayScript } | { ok: false; errors: string[] };

/** Validate unknown JSON (object or string) against the replay schema. Never throws. */
export function validateReplay(input: unknown): ReplayValidation {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
    }
  }
  const r = ReplayScriptSchema.safeParse(data);
  if (r.success) return { ok: true, script: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export function parseReplay(input: unknown): ReplayScript {
  const v = validateReplay(input);
  if (!v.ok) throw new Error(`invalid replay script:\n${v.errors.join('\n')}`);
  return v.script;
}
