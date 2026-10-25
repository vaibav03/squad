import { STEP_ORDER, STEP_TITLE, type StepKey } from './steps';

export const STEPS = STEP_ORDER.map((id) => ({ id, label: STEP_TITLE[id] }));
export type StepId = StepKey;
export const isStepId = (v: string | undefined): v is StepId => STEP_ORDER.includes(v as StepKey);

/** Old links (/squad/setup/phone ...) keep working: they open the step that replaced them. */
export const LEGACY_STEP: Record<string, StepId> = {
  phone: 'messaging',
  courses: 'context',
  calendar: 'availability',
  persona: 'agent',
};

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

export function nextStep(step: StepId): StepId | 'done' {
  const i = STEP_ORDER.indexOf(step);
  return STEP_ORDER[i + 1] ?? 'done';
}
export function prevStep(step: StepId): StepId | null {
  const i = STEP_ORDER.indexOf(step);
  return STEP_ORDER[i - 1] ?? null;
}
