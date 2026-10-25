import type { BusyBlock } from './ics';

export const STEPS = [
  { id: 'phone', label: 'Phone' },
  { id: 'courses', label: 'Courses' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'persona', label: 'Study buddy' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];
export const isStepId = (v: string | undefined): v is StepId => STEPS.some((s) => s.id === v);

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** Formats US numbers as (555) 010-0101 while typing. Keeps digits only, max 10. */
export function formatPhone(raw: string): string {
  const d = raw
    .replace(/\D/g, '')
    .replace(/^1(?=\d{10})/, '')
    .slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
export const phoneDigits = (s: string) => s.replace(/\D/g, '');
export function validatePhone(s: string): string | null {
  const d = phoneDigits(s);
  if (d.length === 0) return 'Enter your phone number.';
  if (d.length < 10) return 'That looks short. US numbers have 10 digits.';
  if (/^[01]/.test(d)) return 'US numbers do not start with 0 or 1.';
  return null;
}
export function validateCode(s: string): string | null {
  const d = s.replace(/\D/g, '');
  if (d.length < 6) return 'Enter all 6 digits.';
  return null;
}
export function validateFile(f: { name: string; size: number; type: string }): string | null {
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  if (!isPdf) return `${f.name} is not a PDF.`;
  if (f.size > MAX_PDF_BYTES) return `${f.name} is larger than 50 MB.`;
  if (f.size === 0) return `${f.name} is empty.`;
  return null;
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type CourseStatus = 'queued' | 'reading' | 'ready' | 'failed';
export interface CourseFile {
  id: string;
  name: string;
  size: number;
  status: CourseStatus;
  progress: number;
}

export interface SetupState {
  phone: { number: string; codeSent: boolean; verified: boolean };
  courses: CourseFile[];
  calendar: { status: 'none' | 'ready'; blocks: BusyBlock[]; source?: 'ics' | 'demo' };
  persona: string | null;
  skipped: StepId[];
}

export const initialState: SetupState = {
  phone: { number: '', codeSent: false, verified: false },
  courses: [],
  calendar: { status: 'none', blocks: [] },
  persona: null,
  skipped: [],
};

export type Action =
  | { type: 'phone/number'; number: string }
  | { type: 'phone/sent' }
  | { type: 'phone/verified' }
  | { type: 'phone/edit' }
  | { type: 'courses/add'; files: CourseFile[] }
  | { type: 'courses/progress'; id: string; progress: number; status?: CourseStatus }
  | { type: 'courses/remove'; id: string }
  | { type: 'courses/retry'; id: string }
  | { type: 'calendar/set'; blocks: BusyBlock[]; source: 'ics' | 'demo' }
  | { type: 'calendar/clear' }
  | { type: 'persona/pick'; id: string }
  | { type: 'skip'; step: StepId };

export function reducer(s: SetupState, a: Action): SetupState {
  switch (a.type) {
    case 'phone/number':
      return { ...s, phone: { ...s.phone, number: formatPhone(a.number) } };
    case 'phone/sent':
      return { ...s, phone: { ...s.phone, codeSent: true } };
    case 'phone/verified':
      return { ...s, phone: { ...s.phone, verified: true } };
    case 'phone/edit':
      return { ...s, phone: { ...s.phone, codeSent: false, verified: false } };
    case 'courses/add':
      return { ...s, courses: [...s.courses, ...a.files] };
    case 'courses/progress':
      return {
        ...s,
        courses: s.courses.map((c) =>
          c.id === a.id
            ? {
                ...c,
                progress: Math.max(c.progress, Math.min(1, a.progress)),
                status: a.status ?? (a.progress >= 1 ? 'ready' : 'reading'),
              }
            : c,
        ),
      };
    case 'courses/remove':
      return { ...s, courses: s.courses.filter((c) => c.id !== a.id) };
    case 'courses/retry':
      return {
        ...s,
        courses: s.courses.map((c) =>
          c.id === a.id ? { ...c, status: 'queued', progress: 0 } : c,
        ),
      };
    case 'calendar/set':
      return {
        ...s,
        calendar: { status: 'ready', blocks: a.blocks, source: a.source },
        skipped: s.skipped.filter((x) => x !== 'calendar'),
      };
    case 'calendar/clear':
      return { ...s, calendar: { status: 'none', blocks: [] } };
    case 'persona/pick':
      return { ...s, persona: a.id, skipped: s.skipped.filter((x) => x !== 'persona') };
    case 'skip':
      return { ...s, skipped: s.skipped.includes(a.step) ? s.skipped : [...s.skipped, a.step] };
  }
}

export function completedSteps(s: SetupState): StepId[] {
  const done: StepId[] = [];
  if (s.phone.verified) done.push('phone');
  if (s.courses.some((c) => c.status === 'ready')) done.push('courses');
  if (s.calendar.status === 'ready') done.push('calendar');
  if (s.persona) done.push('persona');
  return done;
}
export function nextStep(step: StepId): StepId | 'done' {
  const i = STEPS.findIndex((x) => x.id === step);
  return STEPS[i + 1]?.id ?? 'done';
}
export function prevStep(step: StepId): StepId | null {
  const i = STEPS.findIndex((x) => x.id === step);
  return STEPS[i - 1]?.id ?? null;
}
