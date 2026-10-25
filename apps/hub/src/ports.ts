// Ports: how brain and media plug into the hub. Stub adapters live in ./adapters. See docs/hub-api.md section 11.
import type { AgentId, Citation, Persona, StudentId } from '@squad/core';

export interface QuizPayload {
  quizId: string;
  chapter: string;
  question: string;
  choices?: { id: string; text: string }[];
}
export interface QuizAnswerResult {
  recorded: boolean;
  correct?: boolean;
  explanation?: string;
  chapter: string;
}
export interface QuizPort {
  get(quizId: string, viewer: StudentId): Promise<QuizPayload | null>;
  answer(
    quizId: string,
    viewer: StudentId,
    a: { choice?: string; text?: string },
  ): Promise<QuizAnswerResult | null>;
  listOpen(viewer: StudentId): Promise<{ quizId: string; chapter: string; target?: StudentId }[]>;
}

export type CallTurn = {
  text: string;
  cite?: Citation;
  audio?: { mime: string; data: Uint8Array };
};
export interface CallSession {
  greeting(): AsyncIterable<CallTurn>;
  reply(userText: string): AsyncIterable<CallTurn>;
  audio?(chunk: Uint8Array): void;
  close(): Promise<void>;
}
export interface CallPort {
  /** null = unknown agent */
  open(args: { callId: string; agent: AgentId; student: StudentId }): Promise<CallSession | null>;
}

export interface CourseStatus {
  courseId: string;
  title: string;
  file: string;
  status: 'queued' | 'parsing' | 'embedding' | 'ready' | 'failed';
  pct?: number;
}
export interface BrainPort {
  ingestCourse(
    student: StudentId,
    file: { name: string; bytes: Uint8Array },
  ): Promise<{ courseId: string }>;
  listCourses(student: StudentId): Promise<CourseStatus[]>;
  /** `squad` holds every member's per-concept scores; the hub decides whether an average may be shown. */
  mastery(
    student: StudentId,
    courseId: string,
  ): Promise<{ concepts: string[]; mine: number[]; squad: number[][] }>;
  loadCalendar(
    student: StudentId,
    input: { ics?: string; demo?: boolean },
  ): Promise<{ busyBlocks: number }>;
}

export interface MediaPort {
  personas(): Promise<Persona[]>;
  updatePersona(
    id: string,
    patch: { voiceId?: string; avatarUrl?: string },
  ): Promise<Persona | null>;
  voices(): Promise<{ id: string; name: string; label?: string }[]>;
  preview(voiceId: string, text: string): Promise<{ mime: string; data: Uint8Array } | null>;
}

export interface Ports {
  quiz: QuizPort;
  call: CallPort;
  brain: BrainPort;
  media: MediaPort;
}
