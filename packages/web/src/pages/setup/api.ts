import { timedFetch } from '../../lib/http';
import { z } from 'zod';

const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    triesLeft: z.number().optional(),
    retryAfterS: z.number().optional(),
  }),
});
const CourseUpload = z.object({ courseId: z.string(), file: z.string(), status: z.string() });
const CourseList = z.array(
  z.object({
    courseId: z.string(),
    file: z.string(),
    status: z.enum(['queued', 'reading', 'ready', 'failed']),
    progress: z.number().min(0).max(1).optional(),
  }),
);
const Calendar = z.object({ busyBlocks: z.number() });

export class HubError extends Error {
  constructor(
    public code: string,
    message?: string,
    public triesLeft?: number,
  ) {
    super(message ?? code);
  }
}
interface Ctx {
  hubUrl: string;
  token: string | null;
}

async function call<T>(
  ctx: Ctx,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await timedFetch(`${ctx.hubUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      },
    });
  } catch {
    throw new HubError('offline', 'Cannot reach the hub.');
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ErrorBody.safeParse(json);
    throw new HubError(
      e.success ? e.data.error.code : `http_${res.status}`,
      e.success ? e.data.error.message : undefined,
      e.success ? e.data.error.triesLeft : undefined,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HubError('bad_response', 'The hub sent something unexpected.');
  return parsed.data;
}

export const uploadCourse = (ctx: Ctx, file: File) => {
  const body = new FormData();
  body.append('file', file);
  return call(ctx, '/v1/squad/courses', CourseUpload, { method: 'POST', body });
};
export const listCourses = (ctx: Ctx) => call(ctx, '/v1/squad/courses', CourseList);
export const calendarForm = (ics: string, name = 'calendar.ics') => {
  const body = new FormData();
  body.append(
    'file',
    new File([ics], name.toLowerCase().endsWith('.ics') ? name : `${name}.ics`, {
      type: 'text/calendar',
    }),
  );
  return body;
};
export const postCalendar = (ctx: Ctx, input: { demo: true } | { ics: string; name?: string }) =>
  call(
    ctx,
    '/v1/squad/calendar',
    Calendar,
    'demo' in input
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }
      : { method: 'POST', body: calendarForm(input.ics, input.name) },
  );

export type PhoneDelivery = 'dev' | 'imessage' | 'unavailable';
const PhoneStart = z.union([
  z.object({
    ok: z.literal(true),
    challengeId: z.string(),
    to: z.string(),
    delivery: z.enum(['dev', 'imessage']),
    deliveryLabel: z.string(),
    devCode: z.string().optional(),
    devCodeLabel: z.string().optional(),
  }),
  z.object({
    ok: z.literal(true),
    alreadyLinked: z.literal(true),
    to: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    delivery: z.literal('unavailable'),
    deliveryLabel: z.string(),
    message: z.string(),
    to: z.string(),
  }),
]);
export type PhoneStartResult = z.infer<typeof PhoneStart>;
const PhoneVerify = z.object({ ok: z.literal(true), verified: z.literal(true), hint: z.string() });
const PhoneLinks = z.object({ links: z.array(z.object({ hint: z.string() })) });
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
/** POST /v1/me/phone/start: attaches a phone to the signed-in account (never swaps the session). */
export const phoneStart = (ctx: Ctx, phone: string) =>
  call(ctx, '/v1/me/phone/start', PhoneStart, json({ phone }));
export const phoneVerify = (ctx: Ctx, challengeId: string, code: string) =>
  call(ctx, '/v1/me/phone/verify', PhoneVerify, json({ challengeId, code }));
/** GET /v1/imessage/link: already-linked handles (masked hints only). */
export const phoneLinks = (ctx: Ctx) => call(ctx, '/v1/imessage/link', PhoneLinks);
