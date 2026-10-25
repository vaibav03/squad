import type { StudentId } from '@squad/core';

export type BoxMap = ReadonlyMap<StudentId, ReadonlyMap<string, number>>;

export interface AssignInput {
  students: readonly StudentId[];
  chapters: readonly string[];
  /** student -> chapter -> Leitner box (missing = 1). Read privately; never leaves this function. */
  mastery: BoxMap;
}

/**
 * Snake-draft assignment. Every chapter goes to exactly one student; loads differ by at most 1; each
 * person gets chapters they are strongest in. Works on sorted ids, so it is invariant to input
 * order. Ties: earlier chapter (sorted id), picking in student id order (reversed on odd rounds).
 */
export function assignChapters(input: AssignInput): Map<string, StudentId> {
  const students = [...new Set(input.students)].sort();
  const chapters = [...new Set(input.chapters)].sort();
  const out = new Map<string, StudentId>();
  if (students.length === 0) return out;
  const box = (s: StudentId, c: string) => input.mastery.get(s)?.get(c) ?? 1;
  const remaining = [...chapters];
  // Snake draft: everyone picks once per round, so loads differ by at most 1.
  for (let round = 0; remaining.length > 0; round++) {
    const order = round % 2 === 0 ? students : [...students].reverse();
    for (const s of order) {
      if (remaining.length === 0) break;
      let best = 0;
      for (let i = 1; i < remaining.length; i++) {
        if (box(s, remaining[i]!) > box(s, remaining[best]!)) best = i; // ties keep chapter order
      }
      out.set(remaining.splice(best, 1)[0]!, s);
    }
  }
  return out;
}

export function loadOf(assign: ReadonlyMap<string, StudentId>, students: readonly StudentId[]) {
  const load = new Map(students.map((s) => [s, 0]));
  for (const s of assign.values()) load.set(s, (load.get(s) ?? 0) + 1);
  return load;
}
