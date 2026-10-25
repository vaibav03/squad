import { z } from 'zod';

const Id = z.string().regex(/^[a-z][a-z0-9_]*$/);
const Handle = z
  .string()
  .regex(
    /^(\+1555\d{7}|[a-z0-9._-]+@example\.(com|org))$/,
    'handle must be a fake +1555 number or an example.com email',
  );

export const PrivateStudentSchema = z.strictObject({
  budget: z
    .strictObject({
      comfortableUsd: z.number().int().positive(),
      hardCapUsd: z.number().int().positive(),
      note: z.string().min(1),
    })
    .refine(
      (b) => b.hardCapUsd <= b.comfortableUsd,
      'hard cap cannot exceed the comfortable figure',
    ),
  hardNos: z.array(z.strictObject({ topic: z.string().min(1), reason: z.string().min(1) })),
  weakTopics: z.array(z.string().min(1)).min(1),
});

export const SeedStudentSchema = z.strictObject({
  id: z.string().regex(/^s_[a-z]+$/),
  name: z.string().min(1),
  handle: Handle,
  personaId: Id,
  calendar: z.string().regex(/^calendars\/[a-z_]+\.ics$/),
  private: PrivateStudentSchema,
});

export const StudentsFileSchema = z
  .strictObject({
    squadId: Id,
    chatId: Id,
    students: z.array(SeedStudentSchema).min(3).max(4),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    const budgets = new Set<number>();
    const handles = new Set<string>();
    f.students.forEach((s, i) => {
      if (ids.has(s.id))
        ctx.addIssue({
          code: 'custom',
          path: ['students', i, 'id'],
          message: `duplicate id ${s.id}`,
        });
      if (handles.has(s.handle))
        ctx.addIssue({
          code: 'custom',
          path: ['students', i, 'handle'],
          message: 'duplicate handle',
        });
      if (budgets.has(s.private.budget.hardCapUsd))
        ctx.addIssue({
          code: 'custom',
          path: ['students', i, 'private', 'budget'],
          message: 'budgets must be distinct',
        });
      ids.add(s.id);
      handles.add(s.handle);
      budgets.add(s.private.budget.hardCapUsd);
    });
  });

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const LodgingFileSchema = z.strictObject({
  trip: z.strictObject({
    tripId: Id,
    taskId: Id,
    name: z.string().min(1),
    from: IsoDate,
    to: IsoDate,
    nights: z.number().int().positive(),
    origin: z.string().min(1),
  }),
  options: z
    .array(
      z.strictObject({
        id: Id,
        label: z.string().min(1),
        place: z.string().min(1),
        kind: z.enum(['cabin', 'rental', 'glamping', 'hotel']),
        perPersonUsd: z.number().int().positive(),
        demoOutcome: z.enum(['chosen', 'runner_up', 'dropped_budget', 'dropped_veto']),
        notes: z.string(),
      }),
    )
    .min(2),
});

export const CourseFileSchema = z.strictObject({
  courseId: Id,
  title: z.string().min(1),
  groupName: z.string().min(1),
  packRef: z.string().min(1),
  license: z.strictObject({ name: z.string().min(1), url: z.url() }),
  attribution: z.string().includes('OpenStax').includes('CC BY 4.0'),
  chapters: z.array(z.strictObject({ id: Id, title: z.string().min(1) })).min(1),
  exam: z.strictObject({ name: z.string(), at: IsoLocal, tz: z.string() }),
  studyWindow: z.strictObject({
    from: IsoLocal,
    to: IsoLocal,
    dayStartHour: z.number().int().min(0).max(23),
    dayEndHour: z.number().int().min(1).max(24),
    durationHours: z.number().int().positive(),
  }),
});

export const PersonaSchema = z.strictObject({
  id: Id,
  name: z.string().min(1),
  role: z.string().min(1),
  emoji: z.string().optional(),
  portrait: z.string().optional(),
  voiceId: z.string().optional(),
  avatarUrl: z.string().optional(),
  spriteSheet: z.string().optional(),
  systemPrompt: z.string().min(1),
});
export const PersonasFileSchema = z.array(PersonaSchema).min(1);

export type SeedStudent = z.infer<typeof SeedStudentSchema>;
export type StudentsFile = z.infer<typeof StudentsFileSchema>;
export type LodgingFile = z.infer<typeof LodgingFileSchema>;
export type CourseFile = z.infer<typeof CourseFileSchema>;
export type PersonaSeed = z.infer<typeof PersonaSchema>;
