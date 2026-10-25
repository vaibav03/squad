import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrivateProfile } from '@squad/mesh';
import { z } from 'zod';

const Iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/);

/** The agent's private fixture. Never leaves this process except as PSI blinds and secret shares. */
export const ProfileSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/),
  name: z.string().min(1).max(64),
  venmo: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
  tz: z.string(),
  workHours: z.strictObject({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  }),
  calendar: z.array(z.strictObject({ start: Iso, end: Iso, title: z.string() })),
  hourCost: z.record(z.string(), z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])),
  budget: z.number().nonnegative(),
  tripExtrasPerDay: z.number().nonnegative().optional(),
  hardNos: z.array(z.strictObject({ optionId: z.string(), reason: z.string() })),
  tripRanking: z.array(z.string()),
  topics: z.strictObject({ canTeach: z.array(z.string()), weak: z.array(z.string()) }),
});

export function parseProfile(raw: unknown): PrivateProfile {
  return ProfileSchema.parse(raw) as PrivateProfile;
}

export function loadProfile(id: string, dir: string): PrivateProfile {
  const p = parseProfile(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')));
  if (p.id !== id) throw new Error(`fixture ${id}.json has id ${p.id}`);
  return p;
}
