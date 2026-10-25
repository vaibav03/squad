import { z } from 'zod';

/** One link of the integration chain. `blocked` = cannot run here because named env/credentials are missing (never faked). */
export const HealthStatusSchema = z.enum(['pass', 'warn', 'fail', 'blocked']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const HEALTH_GROUPS = ['canvas', 'google', 'chain', 'sendblue', 'platform'] as const;
export const HealthGroupSchema = z.enum(HEALTH_GROUPS);
export type HealthGroup = z.infer<typeof HealthGroupSchema>;

export const HealthCheckSchema = z.strictObject({
  /** Stable id, e.g. `google_connected`, `redirect_origin`, `context_retrievable`. */
  id: z.string().max(60),
  group: HealthGroupSchema,
  label: z.string().max(120),
  status: HealthStatusSchema,
  /** Why, in plain words. Never contains a secret, token, e-mail, phone number or event title. */
  reason: z.string().max(400),
  /** The fix action: a web route to open (`to`) or a hub call the UI may make (`api`). */
  fix: z
    .strictObject({ label: z.string().max(60), to: z.string().max(200).optional(), api: z.string().max(200).optional() })
    .optional(),
  /** For `blocked`: the exact env var names that are missing. */
  missingEnv: z.array(z.string().max(80)).max(10).optional(),
  /** `real` | `fixture` | `extension` | `feed` | `degraded` ... what the check observed (display only). */
  mode: z.string().max(40).optional(),
  /** Small display facts (counts, timestamps). Numbers/short strings only. */
  facts: z.record(z.string(), z.union([z.string().max(120), z.number(), z.boolean(), z.null()])).optional(),
  probedAt: z.number(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const HealthReportSchema = z.strictObject({
  generatedAt: z.number(),
  overall: HealthStatusSchema,
  /** The web origin the hub believes is being served (what OAuth returns to). */
  servedOrigin: z.string().nullable(),
  checks: z.array(HealthCheckSchema),
});
export type HealthReport = z.infer<typeof HealthReportSchema>;

/** `blocked` and `warn` do not fail the whole report; any `fail` does. */
export function overallHealth(checks: readonly { status: HealthStatus }[]): HealthStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn' || c.status === 'blocked')) return 'warn';
  return 'pass';
}
