import { normaliseText } from '../councils/pure';

export { normaliseText as normaliseAnswer };

/** Choice grading is exact index equality. */
export const gradeChoice = (choice: number, key: number): boolean => choice === key;

/** Cheap deterministic shortcut for free text before asking the model. */
export const gradeFreeExact = (text: string, key: string): boolean => {
  const a = normaliseText(text);
  return a.length > 0 && a === normaliseText(key);
};

export const FEEDBACK = {
  right: 'Right.',
  wrong: 'Not quite.',
  ungraded: 'Could not grade that one just now. Send your answer again.',
} as const;
