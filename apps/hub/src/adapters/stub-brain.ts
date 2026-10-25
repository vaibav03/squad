import type { BrainPort, CourseStatus } from '../ports';
import { COURSE_ID, STUDENT_IDS } from '../cast';

const CONCEPTS = ['ch2', 'ch3', 'ch6', 'ch12'];
const SCORES: Record<string, number[]> = {
  s_ana: [0.9, 0.7, 0.4, 0.8],
  s_ben: [0.5, 0.6, 0.3, 0.7],
  s_chi: [0.8, 0.9, 0.7, 0.6],
  s_dev: [0.6, 0.4, 0.5, 0.5],
};

export function createStubBrain(): BrainPort {
  const courses = new Map<string, CourseStatus[]>();
  const seeded = (): CourseStatus => ({
    courseId: COURSE_ID,
    title: 'Introductory Statistics (OpenStax excerpt)',
    file: 'intro-stats-excerpt.pdf',
    status: 'ready',
  });
  return {
    async ingestCourse(student, file) {
      const courseId =
        file.name
          .toLowerCase()
          .replace(/\.pdf$/, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'course';
      const list = courses.get(student) ?? [];
      list.push({ courseId, title: file.name, file: file.name, status: 'queued', pct: 0 });
      courses.set(student, list);
      return { courseId };
    },
    async listCourses(student) {
      const own = (courses.get(student) ?? []).map((c): CourseStatus => ({
        ...c,
        status: 'ready',
        pct: 100,
      }));
      return [seeded(), ...own];
    },
    async mastery(student, courseId) {
      if (courseId !== COURSE_ID)
        return { concepts: CONCEPTS, mine: CONCEPTS.map(() => 0), squad: [] };
      return {
        concepts: CONCEPTS,
        mine: [...(SCORES[student] ?? CONCEPTS.map(() => 0))],
        squad: STUDENT_IDS.map((s) => [...(SCORES[s] ?? [])]),
      };
    },
    async loadCalendar(_student, input) {
      if (input.demo) return { busyBlocks: 12 };
      return { busyBlocks: (input.ics?.match(/BEGIN:VEVENT/g) ?? []).length };
    },
  };
}
